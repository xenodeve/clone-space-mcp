import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { capturePage } from "../../src/serve/tools/capture-page.ts";
import { extractBehaviourFromArchive } from "../../src/serve/tools/extract-behaviour.ts";
import type { BehaviourNode } from "../../src/extract/behaviour.ts";

let browser: Browser;
let tempDir: string;
let nodes: BehaviourNode[];

/**
 * #215. The definition of done ends with an agent answering *"what makes the hero move?"* citing
 * file and line. The graph already said *what* moves; these assertions are about *where it was
 * written*, checked against the fixture's own source lines rather than against whatever the
 * extractor happens to report.
 */
before(async () => {
  browser = await chromium.launch();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-animation-source-"));
  // The tools own their browser's lifetime and close it when done; this suite shares one.
  const launcher = {
    launch: async () =>
      ({
        newContext: (o: unknown) => (browser as never as { newContext(o: unknown): unknown }).newContext(o),
        version: () => browser.version(),
        newBrowserCDPSession: () => (browser as never as { newBrowserCDPSession(): unknown }).newBrowserCDPSession(),
        close: async () => {},
      }) as never,
  };
  const servers: FixtureServers = await startFixtureServers();
  let archive: string;
  try {
    archive = (
      await capturePage(
        { url: servers.primary.url, outDir: join(tempDir, "archive"), allowPrivateNetwork: true },
        launcher as never,
      )
    ).archive;
  } finally {
    await servers.stop();
  }
  // Extracted after the fixture is gone: the replay has to answer from the archive alone.
  nodes = (await extractBehaviourFromArchive({ archive }, launcher as never)).nodes;
});

after(async () => {
  await browser?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

function cited(node: BehaviourNode): string {
  const at = node.source?.generated;
  return at === undefined ? "<no source>" : `${new URL(at.url).pathname}:${at.line}`;
}

test("the hero's tweens cite the lines of gsap-scene.js that created them", () => {
  const hero = nodes.filter((node) => node.target === "[data-fixture-id='gsap-hero']");
  // The three tweens of the hero timeline, by easing — which is what tells them apart — against
  // the line each one is written on in test/fixtures/motion-site/gsap-scene.js.
  const byEase = Object.fromEntries(hero.map((node) => [node.easing, cited(node)]));
  assert.deepEqual(byEase, {
    "power3.out": "/gsap-scene.js:19",
    "sine.inOut": "/gsap-scene.js:20",
    none: "/gsap-scene.js:21",
  });
  // No map was published for gsap-scene.js, so the strongest honest claim is the generated file.
  for (const node of hero) assert.equal(node.source?.provenance, "generated-source");
});

test("a tween nested in a timeline cites its own line, not the timeline's", () => {
  const nested = nodes.filter((node) => node.target === "[data-fixture-id='gsap-nested-only']");
  assert.deepEqual(nested.map(cited), ["/gsap-scene.js:31"]);
});

test("a ScrollTrigger cites the gsap.to that created the tween it drives", () => {
  const triggers = nodes.filter((node) => node.mechanism === "gsap-scrolltrigger");
  assert.deepEqual(triggers.map(cited), ["/gsap-scene.js:33"]);
});

test("a WAAPI animation cites the element.animate call in motion.js", () => {
  const waapi = nodes.filter((node) => node.mechanism === "waapi");
  assert.deepEqual(waapi.map(cited), ["/motion.js:11"]);
});

test("a CSS animation cites its @keyframes rule in the archived stylesheet", () => {
  const css = nodes.filter((node) => node.mechanism === "css-keyframes");
  assert.deepEqual(css.map(cited), ["/style.css:49"]);
  assert.equal(css[0]?.source?.provenance, "generated-source");
});

/**
 * The page runs after the provenance script and shares its global object, so it can overwrite the
 * registry — by accident, with a global of the same name. That must cost the citations at most,
 * never the extraction: a graph with no `source` is honest, an `extract_behaviour` that throws is
 * a page the tool cannot describe at all.
 */
test("a page that clobbers the provenance registry still extracts", async () => {
  const { replayArchive } = await import("../../src/replay/replay.ts");
  const { extractBehaviour } = await import("../../src/extract/behaviour.ts");
  const { indexArchiveSources } = await import("../../src/extract/archive-sources.ts");
  const archive = join(tempDir, "archive");
  const replay = await replayArchive({ archive, browser: browser as never, instrument: true });
  try {
    await replay.page.evaluate(() => {
      (globalThis as { __wap?: unknown }).__wap = { stacks: 1, libraries: 2 };
    });
    const graph = await extractBehaviour(replay, await indexArchiveSources(archive));
    assert.ok(graph.nodes.some((node) => node.target === "[data-fixture-id='gsap-hero']"));
  } finally {
    await replay.close();
  }
});

/**
 * The `original-source` half, end to end: an animation started from inside the fixture's minified
 * module, whose map the capture archived. The runtime reports a column on line 1 of the bundle;
 * the citation has to land on the line in `instrumented.ts` that wrote the call.
 */
test("an animation created inside a mapped bundle cites the original source line", async () => {
  const { readFileSync } = await import("node:fs");
  const launcher = {
    launch: async () =>
      ({
        newContext: (o: unknown) => (browser as never as { newContext(o: unknown): unknown }).newContext(o),
        version: () => browser.version(),
        newBrowserCDPSession: () => (browser as never as { newBrowserCDPSession(): unknown }).newBrowserCDPSession(),
        close: async () => {},
      }) as never,
  };
  const servers: FixtureServers = await startFixtureServers();
  let archive: string;
  try {
    archive = (
      await capturePage(
        {
          url: new URL("/instrumented-case.html", servers.primary.url).href,
          outDir: join(tempDir, "mapped"),
          allowPrivateNetwork: true,
        },
        launcher as never,
      )
    ).archive;
  } finally {
    await servers.stop();
  }
  const graph = await extractBehaviourFromArchive({ archive }, launcher as never);

  // Ground truth from the fixture's own source, not from anything the extractor produced.
  const lines = readFileSync(new URL("../fixtures/motion-site/src/instrumented.ts", import.meta.url), "utf8").split("\n");
  const expected = lines.findIndex((line) => line.includes("marker.animate(")) + 1;
  assert.ok(expected > 0, "the fixture no longer starts an animation from instrumented.ts");

  const waapi = graph.nodes.filter((node) => node.mechanism === "waapi");
  assert.equal(waapi.length, 1, `expected one WAAPI node, got ${JSON.stringify(waapi)}`);
  const source = waapi[0]!.source;
  assert.equal(source?.provenance, "original-source");
  assert.match(new URL(source!.generated.url).pathname, /\/build\/instrumented\.js$/);
  assert.match(source!.original!.source, /instrumented\.ts$/);
  assert.equal(source!.original!.line, expected);
  assert.match(source!.original!.excerpt.find((line) => line.line === expected)?.text ?? "", /marker\.animate\(/);
});

/**
 * A trigger with no tween has nothing to inherit a citation from, so it is cited at its own
 * `ScrollTrigger.create()` — the only way `labs.chaingpt.org` made its eight triggers, every one of
 * which reported no source before this.
 */
test("a ScrollTrigger made with ScrollTrigger.create() or batch() cites that call", async () => {
  const { readFileSync } = await import("node:fs");
  const launcher = {
    launch: async () =>
      ({
        newContext: (o: unknown) => (browser as never as { newContext(o: unknown): unknown }).newContext(o),
        version: () => browser.version(),
        newBrowserCDPSession: () => (browser as never as { newBrowserCDPSession(): unknown }).newBrowserCDPSession(),
        close: async () => {},
      }) as never,
  };
  const servers: FixtureServers = await startFixtureServers();
  let archive: string;
  const url = new URL("/scrolltrigger-create.html", servers.primary.url).href;
  try {
    archive = (
      await capturePage({ url, outDir: join(tempDir, "st-create"), allowPrivateNetwork: true }, launcher as never)
    ).archive;
  } finally {
    await servers.stop();
  }
  const graph = await extractBehaviourFromArchive({ archive }, launcher as never);

  // Ground truth: the line of the archived document that holds the call.
  const har = JSON.parse(readFileSync(join(archive, "network.har"), "utf8")) as {
    log: { entries: { request: { url: string }; response: { content: { text?: string; _file?: string } } }[] };
  };
  const doc = har.log.entries.find((entry) => entry.request.url === url)!.response.content;
  const body = doc.text ?? readFileSync(join(archive, doc._file!), "utf8");
  const lines = body.split("\n");
  const created = lines.findIndex((line) => line.includes("ScrollTrigger.create(")) + 1;
  // `batch()` calls `create()` from inside ScrollTrigger's own file, so without that file skipped as
  // a library the citation would land in `ScrollTrigger.min.js` — confidently, and wrongly.
  const batched = lines.findIndex((line) => line.includes("ScrollTrigger.batch(")) + 1;
  assert.ok(created > 0 && batched > 0);

  const triggers = graph.nodes.filter((node) => node.mechanism === "gsap-scrolltrigger");
  assert.deepEqual(
    triggers.map(cited).sort(),
    [`/scrolltrigger-create.html:${created}`, `/scrolltrigger-create.html:${batched}`].sort(),
  );
});

/**
 * #219. A transition is in `getAnimations()` only while it runs, so a node for it would exist or
 * not depending on when extraction landed. It is counted under `unrepresented`, never reported as a
 * script calling `element.animate()`, which is what `waapi` asserts.
 */
test("a running CSS transition is not reported as a WAAPI animation", async () => {
  const { replayArchive } = await import("../../src/replay/replay.ts");
  const { extractBehaviour } = await import("../../src/extract/behaviour.ts");
  const servers: FixtureServers = await startFixtureServers();
  let archive: string;
  try {
    archive = (
      await capturePage(
        {
          url: new URL("/running-transition.html", servers.primary.url).href,
          outDir: join(tempDir, "transition"),
          allowPrivateNetwork: true,
        },
        {
          launch: async () =>
            ({
              newContext: (o: unknown) => (browser as never as { newContext(o: unknown): unknown }).newContext(o),
              version: () => browser.version(),
              newBrowserCDPSession: () => (browser as never as { newBrowserCDPSession(): unknown }).newBrowserCDPSession(),
              close: async () => {},
            }) as never,
        } as never,
      )
    ).archive;
  } finally {
    await servers.stop();
  }
  const replay = await replayArchive({ archive, browser: browser as never });
  try {
    // The precondition, checked rather than assumed: the transition really is running. The page
    // starts it two animation frames after load, and under a loaded suite a single read raced that
    // and saw nothing — measured — so wait for the state, bounded, before reading it.
    let running: string[] = [];
    for (let attempt = 0; attempt < 50 && !running.includes("CSSTransition"); attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 200));
      running = await replay.page.evaluate(() =>
        document.getAnimations().map((animation) => animation.constructor.name),
      );
    }
    assert.ok(running.includes("CSSTransition"), `no transition was running: ${JSON.stringify(running)}`);

    const graph = await extractBehaviour(replay);
    assert.deepEqual(graph.nodes.filter((node) => node.mechanism === "waapi"), []);
    assert.ok(graph.unrepresented.cssTransitionElements >= 1);
  } finally {
    await replay.close();
  }
});
