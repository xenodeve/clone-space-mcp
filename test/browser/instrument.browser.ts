import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import {
  drainedObservations,
  parseStackFrames,
  validateInstrumentation,
  INSTRUMENT_DRAIN_SCRIPT,
  INSTRUMENT_INIT_SCRIPT,
  INSTRUMENT_SCHEMA_VERSION,
} from "../../src/capture/instrument.ts";

let browser: Browser;
let servers: FixtureServers;

before(async () => {
  browser = await chromium.launch();
  servers = await startFixtureServers();
});

after(async () => {
  await browser?.close();
  await servers?.stop();
});

/**
 * #173. The hooks have only ever been exercised against real sites, which makes those numbers
 * evidence and not a test. This is the fixture case: one page that compiles a shader, asks for a
 * WebGL context and registers a listener, so all three observation types have ground truth.
 */
test("observes a shader, a canvas context and a listener, each carrying a stack", async () => {
  const context = await browser.newContext();
  try {
    await context.addInitScript({ content: INSTRUMENT_INIT_SCRIPT });
    const page = await context.newPage();
    await page.goto(new URL("/instrumented-case.html", servers.primary.url).href, {
      waitUntil: "load",
    });

    const drained = drainedObservations(
      await page.evaluate(new Function(`return ${INSTRUMENT_DRAIN_SCRIPT}`) as () => unknown),
    );

    const types = new Set(drained.observations.map((o) => o.type));
    assert.ok(types.has("shader"), `no shader observed. types=${[...types].join(",")}`);
    assert.ok(types.has("canvas-context"), "no canvas context observed");
    assert.ok(types.has("listener"), "no listener registration observed");

    // The GLSL is assembled at runtime from an array join, so it exists in no file the archive
    // could hold — recovering it is the whole reason this layer hooks the API rather than reading.
    const shader = drained.observations.find((o) => o.type === "shader")!;
    assert.match(String(shader.detail.source), /gl_Position/);

    // The stack is in the schema from the first version, and it has to resolve to a real
    // coordinate or slice 6 has nothing to work with.
    const frames = parseStackFrames(shader.stack);
    assert.ok(frames.length > 0, `the shader observation carried no readable frame: ${shader.stack}`);
    assert.ok(frames[0]!.url.startsWith(servers.primary.url.replace(/\/$/, "")), "the innermost frame is not the page");

    assert.deepEqual(
      validateInstrumentation({
        schemaVersion: INSTRUMENT_SCHEMA_VERSION,
        droppedObservations: drained.dropped,
        observations: drained.observations,
      }),
      { ok: true },
    );
  } finally {
    await context.close();
  }
});

/** A second drain returns what happened since the first — the buffer is handed over, not copied. */
test("draining twice does not return the same observations again", async () => {
  const context = await browser.newContext();
  try {
    await context.addInitScript({ content: INSTRUMENT_INIT_SCRIPT });
    const page = await context.newPage();
    await page.goto(new URL("/instrumented-case.html", servers.primary.url).href, {
      waitUntil: "load",
    });
    const drain = () =>
      page.evaluate(new Function(`return ${INSTRUMENT_DRAIN_SCRIPT}`) as () => unknown);

    const first = drainedObservations(await drain());
    const second = drainedObservations(await drain());
    assert.ok(first.observations.length > 0, "the first drain returned nothing");
    assert.equal(second.observations.length, 0, "the second drain repeated the first");
  } finally {
    await context.close();
  }
});

/**
 * #173, the half that makes the layer exist in the product rather than in a probe.
 *
 * An agent connected to this server can call `extract_behaviour` and learn what moves. Until this
 * wiring it could not learn what the page *does* — no shader, no canvas realm, no interaction
 * surface — because nothing installed the hooks outside a probe script.
 */
test("replay installs the observation layer when asked, and hands its observations back", async () => {
  const { captureHar } = await import("../../src/capture/record.ts");
  const { replayArchive } = await import("../../src/replay/replay.ts");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "clone-space-instrument-"));
  try {
    const outDir = join(dir, "archive");
    await captureHar({
      browser: browser as never,
      url: new URL("/instrumented-case.html", servers.primary.url).href,
      outDir,
    });

    const replay = await replayArchive({ archive: outDir, browser: browser as never, instrument: true });
    try {
      const drained = await replay.drainObservations();
      const types = new Set(drained.observations.map((o) => o.type));
      assert.ok(types.has("shader"), `replay observed no shader. types=${[...types].join(",")}`);
      assert.ok(types.has("canvas-context"), "replay observed no canvas context");
      assert.ok(types.has("listener"), "replay observed no listener");

      // The point of doing this on the replay rather than live: the GLSL is recovered from an
      // archive, with the network unplugged.
      const shader = drained.observations.find((o) => o.type === "shader")!;
      assert.match(String(shader.detail.source), /gl_Position/);
      assert.ok(parseStackFrames(shader.stack).length > 0, "the observation carried no readable frame");
    } finally {
      await replay.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Off by default: a caller that did not ask for hooks gets a page that carries none. */
test("replay installs nothing unless asked", async () => {
  const { captureHar } = await import("../../src/capture/record.ts");
  const { replayArchive } = await import("../../src/replay/replay.ts");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "clone-space-instrument-off-"));
  try {
    const outDir = join(dir, "archive");
    await captureHar({
      browser: browser as never,
      url: new URL("/instrumented-case.html", servers.primary.url).href,
      outDir,
    });
    const replay = await replayArchive({ archive: outDir, browser: browser as never });
    try {
      const drained = await replay.drainObservations();
      assert.deepEqual(drained, { observations: [], dropped: 0 });
    } finally {
      await replay.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The product surface. An agent connected to this server calls `extract_behaviour` and, until now,
 * learned only what moves. The effect and 3D half of the goal — what the page *does* — was
 * reachable by probe only.
 */
test("extract_behaviour returns the observation summary an agent can act on", async () => {
  const { capturePage } = await import("../../src/serve/tools/capture-page.ts");
  const { extractBehaviourFromArchive } = await import("../../src/serve/tools/extract-behaviour.ts");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "clone-space-tool-"));
  try {
    // The tools own their browser's lifetime and close it when done. This suite shares one, so
    // the launcher hands over a wrapper whose close is a no-op rather than the browser itself.
    // The tools own their browser's lifetime and close it when done. This suite shares one, so
    // the launcher hands over a delegate whose close is a no-op rather than the browser itself.
    // Spreading a Playwright Browser drops its prototype methods, hence explicit delegation.
    const launcher = {
      launch: async () =>
        ({
          newContext: (o: unknown) => (browser as never as { newContext(o: unknown): unknown }).newContext(o),
          version: () => browser.version(),
          newBrowserCDPSession: () => (browser as never as { newBrowserCDPSession(): unknown }).newBrowserCDPSession(),
          close: async () => {},
        }) as never,
    };
    const captured = await capturePage(
      {
        url: new URL("/instrumented-case.html", servers.primary.url).href,
        outDir: join(dir, "archive"),
        allowPrivateNetwork: true,
      },
      launcher as never,
    );

    const graph = await extractBehaviourFromArchive({ archive: captured.archive }, launcher as never);

    assert.ok(graph.observed !== undefined, "extract_behaviour returned no observation summary");
    assert.equal(graph.observed.shaders.length, 1, "the compiled shader is not reported");
    assert.match(graph.observed.shaders[0]!.source, /gl_Position/);
    // A shader without its origin is the half of the goal that says "which line", missing.
    assert.ok(graph.observed.shaders[0]!.origin !== undefined, "the shader carries no origin frame");

    // The whole chain, end to end, through the product surface an agent actually calls (#178).
    // The shader is compiled inside a minified module, so `origin` names a position no reader can
    // use; `original` is that same point carried back through a sourcemap the capture archived.
    assert.ok(
      graph.observed.mappedScripts.some((url) => url.endsWith("/build/instrumented.js")),
      `no usable sourcemap was indexed: ${JSON.stringify(graph.observed.mappedScripts)}`,
    );
    const cited = graph.observed.shaders[0]!.original;
    assert.ok(cited !== undefined, "the shader's origin was never resolved to a source line");
    assert.match(cited.source, /instrumented\.ts$/);
    // The cited line, read out of the archived map's own sourcesContent, is the shaderSource call.
    const centre = cited.excerpt.find((line) => line.line === cited.line);
    assert.match(
      centre?.text ?? "",
      /gl\.shaderSource|compileFixtureShader|gl_Position/,
      `cited ${cited.source}:${cited.line} but the line reads ${JSON.stringify(centre?.text)}`,
    );
    assert.deepEqual(graph.observed.canvasContexts, { webgl: 1 });
    assert.ok(
      (graph.observed.listeners.pointerdown ?? 0) >= 1,
      `the listener surface is missing pointerdown: ${JSON.stringify(graph.observed.listeners)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
