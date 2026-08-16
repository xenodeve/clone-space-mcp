import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureHar } from "../../src/capture/record.ts";
import { replayArchive } from "../../src/replay/replay.ts";

/**
 * #187 — the fixture that reproduces **measure-and-freeze against an async resource** on demand.
 *
 * These tests cover the *instrument*, not replay's correctness. `/measure-and-freeze.html` measures
 * an element and writes the result into an inline style without ordering that measurement against
 * the image the element's size depends on; the live origin delays that image and a HAR does not,
 * so a deferred measurement reads a different number offline. That is the class of defect behind
 * #187, reduced to something with a knob.
 *
 * **Why an instrument needs its own tests.** `a-fixture-edit-can-delete-a-corpus-entry-silently`
 * is the note: a mechanism has dependencies it does not declare, and an unrelated edit to the
 * fixture server can quietly remove the only case a check could fail on. Nothing else in the suite
 * loads this route, so without these two tests the reproducer can stop reproducing and the next
 * session grades a candidate fix against a fixture that agrees with everything.
 *
 * **Three tests, and the first two are the controls for the third.** `module` shows the fixture can
 * report agreement, `t100` without `restoreTiming` shows it reproduces the defect, and `t100` with
 * it shows the fix removes it. Any one alone is worth little: the third candidate on #187 measured
 * 15/15 at the live value and was reverted because its control, run afterwards, was also clean.
 * Here the control runs in the same file, on the same archive shape, every time.
 */

/** The image lands at ≈ 310 ms live and ≈ 10 ms in replay; the frozen spacer is read well after
 *  both, so what is compared is the frozen value and not a page still settling. */
const SETTLE_MS = 700;
const REPLAYS = 3;

let browser: Browser;
let tempDir: string;

before(async () => {
  browser = await chromium.launch();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-height-race-"));
});

after(async () => {
  await browser?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

interface Measured {
  live: number;
  replays: number[];
}

/**
 * Reads the live height and an archive's replay heights for one `?at=` value.
 *
 * The fixture origin is **shut down before any replay**, so a divergence cannot be the live server
 * answering something the archive was missing — the same reason `replay.browser.ts` takes it down.
 */
async function liveAndReplays(at: string, restoreTiming = false): Promise<Measured> {
  const servers: FixtureServers = await startFixtureServers();
  const outDir = join(tempDir, `archive-${at}-${restoreTiming}`);
  const url = new URL(`/measure-and-freeze.html?at=${at}`, servers.primary.url).href;
  let live: number;
  try {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);
      live = await page.evaluate(() => document.documentElement.scrollHeight);
    } finally {
      await page.close();
    }
    // Loopback is exactly what `captureHar` refuses to publish by default (#162); a fixture is the
    // one case where the origin is known, so the flag is stated rather than the guard weakened.
    await captureHar({ allowPrivateNetwork: true, browser: browser as never, url, outDir });
  } finally {
    await servers.stop();
  }

  const replays: number[] = [];
  for (let i = 0; i < REPLAYS; i += 1) {
    const handle = await replayArchive({ archive: outDir, browser: browser as never, restoreTiming });
    try {
      const page = handle.page as unknown as {
        waitForTimeout(ms: number): Promise<void>;
        evaluate<Result>(fn: () => Result): Promise<Result>;
      };
      await page.waitForTimeout(SETTLE_MS);
      replays.push(await page.evaluate(() => document.documentElement.scrollHeight));
    } finally {
      await handle.close();
    }
  }
  return { live, replays };
}

test("measuring at end of parse, replay lays out to the live height — the fixture can show a fix", async () => {
  const { live, replays } = await liveAndReplays("module");
  assert.deepEqual(
    replays,
    Array.from({ length: REPLAYS }, () => live),
    `expected every replay to match the live height ${live}, got ${replays.join(" ")}`,
  );
});

test("measuring after the replay's own arrival, every replay lays out to a height live never produced", async () => {
  const { live, replays } = await liveAndReplays("t100");
  const matching = replays.filter((height) => height === live);
  assert.equal(
    matching.length,
    0,
    `expected every replay to diverge from the live height ${live}, got ${replays.join(" ")}`,
  );
  // Not just "different". The mechanism predicts a **direction**: replay measures after the image
  // has arrived, so it freezes a larger spacer and the document ends up taller. A replay that
  // differed for some other reason would satisfy a bare inequality and prove nothing. Measured
  // 2026-08-16 on this machine — live 720, every replay 1000.
  assert.equal(
    new Set(replays).size,
    1,
    `expected a deterministic replay height, got ${replays.join(" ")}`,
  );
  assert.ok(
    replays[0]! > live,
    `expected replay to be taller than live ${live} because it froze a measurement taken after the image arrived, got ${replays[0]}`,
  );
});

test("restoreTiming holds each response until the archive says it arrived, and the divergence goes", async () => {
  const { live, replays } = await liveAndReplays("t100", true);
  assert.deepEqual(
    replays,
    Array.from({ length: REPLAYS }, () => live),
    `expected every replay to match the live height ${live} once the recorded schedule is restored, got ${replays.join(" ")}`,
  );
});
