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

/**
 * #155. Playwright writes a request it recorded but never got a response for as a HAR entry with
 * `response.status: -1`. `routeFromHAR` matches such an entry by URL — so it never reaches the
 * `notFound: "abort"` path — and then has nothing to fulfil with, leaving the request pending
 * forever. Measured on `https://labs.chaingpt.org/`: five of 114 entries, all `<script>`, and
 * neither `DOMContentLoaded` nor `load` ever fired.
 *
 * The entry is rewritten here rather than produced by a stalling fixture route, because this is a
 * claim about **replay** and a fixture that never answers would make the test a capture test with
 * a timing dependency. Capture publishing them at all is #156.
 */
test("does not stall on a HAR entry the archive has no response for", async () => {
  const archive = await captureThenTakeTheOriginDown();
  const harPath = join(archive, "network.har");
  const har = JSON.parse(readFileSync(harPath, "utf8")) as {
    log: { entries: { request: { url: string }; response: Record<string, unknown> }[] };
  };

  // A blocking classic `<script>` in the document: with no response and no abort, DOMContentLoaded
  // never fires, which is what makes this fatal rather than cosmetic.
  const stalled = har.log.entries.find((entry) => entry.request.url.endsWith("/gsap-scene.js"));
  assert.ok(stalled !== undefined, "fixture no longer loads /gsap-scene.js");
  stalled.response = {
    ...stalled.response,
    status: -1,
    statusText: "",
    httpVersion: "",
    headers: [],
    content: { size: -1, mimeType: "x-unknown" },
  };
  writeFileSync(harPath, JSON.stringify(har));

  const replay = await replayArchive({ archive, browser: browser as never });
  try {
    // Aborted, not pending: a request the archive cannot answer has to fail loudly. That is the
    // same contract `notFound: "abort"` already carries, applied to an entry that matched.
    assert.ok(
      replay.aborted.some((url) => url.endsWith("/gsap-scene.js")),
      `the entry with no response was not aborted. aborted=${JSON.stringify(replay.aborted)}`,
    );
    assert.equal(replay.unservable, 1, "the count of entries the archive cannot serve is wrong");
  } finally {
    await replay.close();
  }

  // The published archive is the record of what capture observed, including that this never
  // completed. Replay filters a copy; it does not rewrite the evidence.
  const after = JSON.parse(readFileSync(harPath, "utf8")) as { log: { entries: unknown[] } };
  assert.equal(after.log.entries.length, har.log.entries.length, "replay rewrote the published HAR");
});

/**
 * #155, the case a URL-keyed refusal gets wrong. A HAR can hold two entries for one URL — a
 * `GET` that succeeded and a `POST` that was still open at teardown, or a second fetch of the
 * same asset. Refusing every URL that appears in *any* entry with no response would then abort a
 * request the archive can answer perfectly well, which is a worse failure than the one being
 * fixed: it removes a working asset from a replay that used to serve it.
 */
test("still serves a URL the archive has a good entry for, alongside a bad one", async () => {
  const archive = await captureThenTakeTheOriginDown();
  const harPath = join(archive, "network.har");
  const har = JSON.parse(readFileSync(harPath, "utf8")) as {
    log: { entries: { request: { url: string; method?: string }; response: Record<string, unknown> }[] };
  };

  const good = har.log.entries.find((entry) => entry.request.url.endsWith("/gsap-scene.js"));
  assert.ok(good !== undefined, "fixture no longer loads /gsap-scene.js");
  har.log.entries.push({
    ...good,
    request: { ...good.request, method: "POST" },
    response: { status: -1, statusText: "", httpVersion: "", headers: [], content: { size: -1, mimeType: "x-unknown" } },
  });
  writeFileSync(harPath, JSON.stringify(har));

  const replay = await replayArchive({ archive, browser: browser as never });
  try {
    assert.ok(
      !replay.aborted.some((url) => url.endsWith("/gsap-scene.js")),
      "a URL the archive can serve was refused because another entry for it had no response",
    );
    // Served is not enough — the script has to have run, which is the fidelity this protects.
    const tweens = await replay.page.evaluate(() => {
      const win = globalThis as unknown as { gsap?: { globalTimeline: { getChildren(): unknown[] } } };
      return win.gsap?.globalTimeline.getChildren().length ?? 0;
    });
    assert.ok(tweens > 0, "the scene script was served but never executed");
    assert.equal(replay.unservable, 0, "a URL with a good entry counted as unservable");
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

/**
 * #155. The test above proves the no-live-network guarantee on the path where **no** entry is
 * unservable — and on that path `replayArchive` never registers its route at all, so it exercises
 * the code as it was before this change. Every other request now passes through `route.fallback()`
 * instead of reaching `routeFromHAR` directly, and if `fallback()` ever stopped deferring, the
 * request would leak to the internet with nothing watching. This installs the handler and repeats
 * the measurement, with the origin **up**.
 */
test("still refuses a live origin when the unservable handler is installed", async () => {
  const servers: FixtureServers = await startFixtureServers();
  const archive = join(tempDir, `archive-${(archiveCounter += 1)}`);
  try {
    await captureHar({ browser: browser as never, url: servers.primary.url, outDir: archive });

    const harPath = join(archive, "network.har");
    const har = JSON.parse(readFileSync(harPath, "utf8")) as {
      log: { entries: { request: { url: string }; response: Record<string, unknown> }[] };
    };
    // One same-origin asset kept, with no response — that is what installs the handler. Everything
    // else the page asks for is dropped, so it can only come from the archive or the live server.
    const asset = har.log.entries.find((entry) => /\.(css|js)(\?|$)/.test(entry.request.url));
    assert.ok(asset !== undefined, "the fixture capture recorded no css or js asset");
    asset.response = {
      status: -1,
      statusText: "",
      httpVersion: "",
      headers: [],
      content: { size: -1, mimeType: "x-unknown" },
    };
    har.log.entries = [har.log.entries[0]!, asset];
    writeFileSync(harPath, JSON.stringify(har));

    const replay = await replayArchive({ archive, browser: browser as never });
    try {
      assert.equal(replay.unservable, 1, "the handler was not installed, so this proves nothing");
      // The handler's own path: an asset the live server would serve, refused.
      assert.ok(
        replay.aborted.includes(asset.request.url),
        `the unservable asset was not refused. aborted=${JSON.stringify(replay.aborted)}`,
      );
      // The fallback path: a different same-origin asset, dropped from the HAR entirely, must also
      // be refused. If `fallback()` stopped deferring to the HAR router, this one would be fetched
      // from the origin that is still listening, and nothing else in the suite would notice.
      const origin = new URL(servers.primary.url).origin;
      const otherRefused = replay.aborted.find(
        (candidate) =>
          candidate !== asset.request.url &&
          candidate.startsWith(origin) &&
          /\.(css|js|png|svg)(\?|$)/.test(candidate),
      );
      assert.ok(
        otherRefused !== undefined,
        `fallback reached the live server instead of the archive. aborted=${JSON.stringify(replay.aborted)}`,
      );
    } finally {
      await replay.close();
    }
  } finally {
    await servers.stop();
  }
});
