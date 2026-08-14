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
