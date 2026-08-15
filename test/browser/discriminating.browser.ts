import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureHar } from "../../src/capture/record.ts";
import { replayArchive } from "../../src/replay/replay.ts";
import { extractBehaviour } from "../../src/extract/behaviour.ts";

let browser: Browser;
let servers: FixtureServers;
let tempDir: string;
let counter = 0;

before(async () => {
  browser = await chromium.launch();
  servers = await startFixtureServers();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-discriminating-"));
});

after(async () => {
  await browser?.close();
  await servers?.stop();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

async function graphOfFixtureCase() {
  const outDir = join(tempDir, `archive-${(counter += 1)}`);
  await captureHar({
    browser: browser as never,
    url: new URL("/discriminating-case.html", servers.primary.url).href,
    outDir,
  });
  const replay = await replayArchive({ archive: outDir, browser: browser as never });
  try {
    return { graph: await extractBehaviour(replay), replay };
  } finally {
    await replay.close();
  }
}

/**
 * #168. Measured on `https://labs.chaingpt.org/`: 154 of 203 gsap-timeline nodes — 76% — reported
 * `target: "div"`. They are 154 different elements, so a caller cannot tell them apart, cannot
 * locate any of them, and cannot ask a follow-up about one. That is the whole use the graph exists
 * for.
 *
 * The fixture reproduces the shape that causes it: class-less siblings animated together, which is
 * what a text-splitting plugin produces one node per line.
 */
test("a class-less element gets a selector that resolves to exactly one element", async () => {
  const { graph } = await graphOfFixtureCase();
  const tweens = graph.nodes.filter((node) => node.mechanism === "gsap-timeline");
  assert.ok(tweens.length >= 3, `expected the three siblings, got ${tweens.length}`);

  const bare = tweens.filter((node) => /^[a-z]+$/.test(node.target));
  assert.deepEqual(bare, [], `nodes fell back to a bare tag name: ${JSON.stringify(bare.map((n) => n.target))}`);

  // `<non-element>` is excluded deliberately, and it is not a weakening: GSAP tweens plain objects
  // as happily as elements, so several nodes legitimately share that marker. The claim under test
  // is about selectors — a selector that names two elements names neither.
  const targets = tweens.map((node) => node.target).filter((t) => t !== "<non-element>");
  assert.equal(new Set(targets).size, targets.length, `two nodes share a selector: ${JSON.stringify(targets)}`);
});

/** The claim the field makes, checked against the replayed document rather than assumed. */
test("every target resolves to exactly one element in the replayed page", async () => {
  const outDir = join(tempDir, `archive-${(counter += 1)}`);
  await captureHar({
    browser: browser as never,
    url: new URL("/discriminating-case.html", servers.primary.url).href,
    outDir,
  });
  const replay = await replayArchive({ archive: outDir, browser: browser as never });
  try {
    const graph = await extractBehaviour(replay);
    const selectors = graph.nodes.map((node) => node.target).filter((t) => t !== "<non-element>" && t !== "");
    const counts = await replay.page.evaluate(
      new Function(
        "return " +
          JSON.stringify(selectors) +
          ".map(s => { try { return document.querySelectorAll(s).length } catch { return -1 } })",
      ) as () => number[],
    );
    const bad = selectors.filter((_, i) => counts[i] !== 1);
    assert.deepEqual(bad, [], `selectors that do not resolve to exactly one element: ${JSON.stringify(bad)}`);
  } finally {
    await replay.close();
  }
});

/**
 * #167. All eight ScrollTrigger nodes on a real page reported `dur null · delay null · ease null`
 * and nothing else — the fields that could say what the trigger *does* did not exist. "There is a
 * ScrollTrigger on this h2" is the same class of answer as "the page loads gsap.min.js".
 */
test("a ScrollTrigger node carries the configuration that explains it", async () => {
  const { graph } = await graphOfFixtureCase();
  const trigger = graph.nodes.find((node) => node.mechanism === "gsap-scrolltrigger");
  assert.ok(trigger !== undefined, "the fixture's ScrollTrigger produced no node");
  assert.ok(trigger.scrollTrigger !== undefined, "the node carries no scrollTrigger configuration");
  assert.equal(trigger.scrollTrigger.start, "top 80%");
  assert.equal(trigger.scrollTrigger.end, "bottom 20%");
  assert.equal(trigger.scrollTrigger.scrub, true);
  assert.equal(trigger.scrollTrigger.pin, false);
  assert.equal(trigger.scrollTrigger.toggleActions, "play none none reverse");
});
