import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureHar } from "../../src/capture/record.ts";
import { replayArchive } from "../../src/replay/replay.ts";

const fixtureManifest = JSON.parse(
  readFileSync(new URL("../fixtures/motion-site/fixture-manifest.json", import.meta.url), "utf8"),
) as { declares: { id: string; mechanism: string; selector: string }[] };

let browser: Browser;
let tempDir: string;
let archiveCounter = 0;

before(async () => {
  browser = await chromium.launch();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-replay-"));
});

after(async () => {
  await browser?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Capture the motion fixture and then **shut its origin down**, so replay has nothing to fall back
 * to. Leaving the fixture running is not a smaller version of this test, it is a different one: a
 * live origin serves whatever the archive is missing, so `notFound: "abort"` cannot be observed to
 * matter. Measured — with the origin up, replacing "abort" with "fallback" survived the corpus.
 */
async function captureThenTakeTheOriginDown(): Promise<string> {
  const servers: FixtureServers = await startFixtureServers();
  const outDir = join(tempDir, `archive-${(archiveCounter += 1)}`);
  try {
    await captureHar({ browser: browser as never, url: servers.primary.url, outDir });
  } finally {
    await servers.stop();
  }
  return outDir;
}

/**
 * P3's exit criterion, and the reason this project exists: the archive replays with the network
 * unplugged and the motion still runs. Anything less is a page that loaded, not a page that works.
 */
test("replays the motion fixture offline with every declared mechanism live", async () => {
  const archive = await captureThenTakeTheOriginDown();
  const replay = await replayArchive({ archive, browser: browser as never });

  try {
    // `notFound: 'abort'` is what makes this evidence rather than optimism: a request the archive
    // cannot serve fails loudly instead of quietly reaching the live network.
    assert.deepEqual(replay.aborted, [], `replay could not serve ${replay.aborted.length} requests`);

    const declared = new Set(fixtureManifest.declares.map((entry) => entry.mechanism));
    const observed = await replay.page.evaluate(() => {
      const win = globalThis as unknown as {
        gsap?: { globalTimeline: { getChildren(): unknown[] } };
        ScrollTrigger?: { getAll(): unknown[] };
        document: Document;
      };
      const animations = win.document.getAnimations();
      return {
        cssKeyframes: animations.filter((a) => a.constructor.name === "CSSAnimation").length,
        waapi: animations.filter((a) => a.constructor.name === "Animation").length,
        gsapTweens: win.gsap?.globalTimeline.getChildren().length ?? 0,
        scrollTriggers: win.ScrollTrigger?.getAll().length ?? 0,
      };
    });

    // The fixture manifest is the ground truth: a mechanism removed from the page fails here
    // rather than silently shrinking what "motion runs" is taken to mean.
    if (declared.has("css-keyframes")) assert.ok(observed.cssKeyframes > 0, "no CSS animation ran");
    if (declared.has("waapi")) assert.ok(observed.waapi > 0, "no WAAPI animation ran");
    if (declared.has("gsap-timeline")) assert.ok(observed.gsapTweens > 0, "GSAP did not execute");
    if (declared.has("gsap-scrolltrigger")) {
      assert.ok(observed.scrollTriggers > 0, "ScrollTrigger did not register");
    }
  } finally {
    await replay.close();
  }
});

test("refuses to reach a live origin for what the archive is missing", async () => {
  // The origin stays **up** here, and that is the whole point. With it down, `abort` and
  // `fallback` are indistinguishable — both leave the request failed — and the corpus measured
  // exactly that: `replay-falls-through-to-the-live-network` SURVIVED against an offline variant
  // of this test. Only a reachable origin separates "served from the archive" from "served by the
  // internet", which is the property the archive's whole value rests on.
  const servers: FixtureServers = await startFixtureServers();
  const archive = join(tempDir, `archive-${(archiveCounter += 1)}`);
  try {
    await captureHar({ browser: browser as never, url: servers.primary.url, outDir: archive });

    // Truncate to the document entry alone. Everything the page then asks for is something the
    // archive cannot answer but the live origin still can.
    const harPath = join(archive, "network.har");
    const har = JSON.parse(readFileSync(harPath, "utf8")) as { log: { entries: unknown[] } };
    har.log.entries = har.log.entries.slice(0, 1);
    writeFileSync(harPath, JSON.stringify(har));

    const replay = await replayArchive({ archive, browser: browser as never });
    try {
      // Not "something failed" — that holds under `fallback` too, because some of this fixture's
      // requests fail either way. The discriminating fact is that a **same-origin asset the live
      // server would happily serve** was refused, which only `abort` produces.
      const origin = new URL(servers.primary.url).origin;
      const refusedAsset = replay.aborted.find(
        (candidate) => candidate.startsWith(origin) && /\.(css|js|png|svg)(\?|$)/.test(candidate),
      );
      assert.ok(
        refusedAsset !== undefined,
        `no same-origin asset was refused; replay reached the live server. aborted=${JSON.stringify(replay.aborted)}`,
      );
    } finally {
      await replay.close();
    }
  } finally {
    await servers.stop();
  }
});
