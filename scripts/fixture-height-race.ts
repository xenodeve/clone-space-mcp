/**
 * #187 — does the measure-and-freeze race reproduce **on demand**, on the fixture? **Node only**
 * (ADR 0001).
 *
 *     node scripts/fixture-height-race.ts [archives] [replaysEach] [at] [restore]
 *
 * `scripts/replay-height-race.ts` is the same experiment against a live site, and it is the reason
 * this file exists: that rate moved from three-in-nine to zero-in-twenty across one day, so a live
 * site cannot grade a candidate fix. Three candidates were built against it and one came within a
 * single command of looking proven because its control was never run in the same hour.
 *
 * What this measures, for `/measure-and-freeze.html`:
 *
 *   - the **live** height, N times — expected stable, because the image is delayed server-side and
 *     the page therefore always measures an empty frame;
 *   - the **replay** height, M times per archive — the split, because the HAR serves the image
 *     with the recorded latency discarded.
 *
 * It prints the distribution rather than a pass/fail. **The rate is a baseline metric, not an
 * assertion** — a run that happens to draw all-one-value at a genuine 1-in-3 is unremarkable, and
 * reporting a metric as an assertion is what manufactures false confidence in both directions.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { captureHar } from "../src/capture/record.ts";
import { replayArchive } from "../src/replay/replay.ts";
import { startFixtureServers } from "./fixture-client.ts";

const archives = Number(process.argv[2] ?? 3);
const replaysEach = Number(process.argv[3] ?? 8);
/** `?at=` on the fixture — see the route in `test/fixtures/serve.ts` for what each value shows. */
const at = process.argv[4] ?? "t30";
/**
 * Pass `restore` to replay with `restoreTiming: true` (#187's candidate fix). **Run the control in
 * the same session, not from memory of an earlier one** — the third candidate on this issue
 * measured 15/15 and was reverted because its control, run afterwards, was also clean.
 */
const restoreTiming = process.argv[5] === "restore";
/** Long enough that the image has certainly arrived on both sides — the frozen spacer is what is
 *  being read, not a page still settling. */
const SETTLE_MS = 1500;

const read = () => ({
  height: document.documentElement.scrollHeight,
  measured: document.documentElement.dataset.measured ?? "?",
});

function tally(values: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([height, n]) => `${height}×${n}`)
    .join("  ");
}

const servers = await startFixtureServers();
const browser = await chromium.launch();
const dir = mkdtempSync(join(tmpdir(), "probe-187-fixture-"));
const url = new URL(`/measure-and-freeze.html?at=${at}`, servers.primary.url).href;

try {
  const liveHeights: number[] = [];
  for (let i = 0; i < replaysEach; i += 1) {
    const context = await browser.newContext({});
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(SETTLE_MS);
    const seen = await page.evaluate(read);
    liveHeights.push(seen.height);
    await context.close();
  }
    console.log(`live      ${tally(liveHeights)}`);
  console.log(`replaying at=${at} restoreTiming=${restoreTiming}`);

  let split = 0;
  const allReplays: number[] = [];
  for (let a = 0; a < archives; a += 1) {
    const archive = join(dir, `archive-${a}`);
    // The fixture origins are loopback, which `captureHar` refuses to publish by default (#162).
    // The flag is the sanctioned way to say so, and saying it here is not a weakening: the whole
    // point of a fixture is that its origin is known.
    await captureHar({ browser: browser as never, url, outDir: archive, allowPrivateNetwork: true });
    const heights: number[] = [];
    for (let r = 0; r < replaysEach; r += 1) {
      const handle = await replayArchive({ archive, browser: browser as never, restoreTiming });
      try {
        const page = handle.page as unknown as {
          waitForTimeout(ms: number): Promise<void>;
          evaluate<Result>(fn: () => Result): Promise<Result>;
        };
        await page.waitForTimeout(SETTLE_MS);
        heights.push((await page.evaluate(read)).height);
      } finally {
        await handle.close();
      }
    }
    allReplays.push(...heights);
    const distinct = new Set(heights);
    if (distinct.size > 1) split += 1;
    console.log(
      `archive ${a}  ${tally(heights)}  ` +
        (distinct.size === 1 ? "AGREED within the archive" : "SPLIT within the archive"),
    );
  }

  const live = new Set(liveHeights);
  const defect = allReplays.filter((h) => !live.has(h)).length;
  console.log(
    `\n${split}/${archives} archives split; ${defect}/${allReplays.length} replays laid out to a height the live page never produced`,
  );
} finally {
  await browser.close();
  await servers.stop();
  rmSync(dir, { recursive: true, force: true });
}
