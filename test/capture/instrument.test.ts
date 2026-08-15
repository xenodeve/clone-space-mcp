import { describe, expect, test } from "bun:test";
import {
  drainedObservations,
  parseStackFrames,
  validateInstrumentation,
  INSTRUMENT_SCHEMA_VERSION,
} from "../../src/capture/instrument.ts";

/**
 * #173, slice 1 of #169. The pure half of the observation layer.
 *
 * What is tested here is not the hooking — that needs a browser and is covered there — but the
 * rules that decide whether an observation can be trusted afterwards: a lost event is countable, a
 * stack frame is read or reported missing rather than guessed, and a document that claims a schema
 * it does not have is refused.
 */

describe("parseStackFrames", () => {
  test("reads url, line and column from a V8 stack", () => {
    const stack = [
      "Error",
      "    at shaderSource (https://x.test/bundle.js:12:326662)",
      "    at compile (https://x.test/chunk-a.js:1:40)",
    ].join("\n");
    expect(parseStackFrames(stack)).toEqual([
      { url: "https://x.test/bundle.js", line: 12, column: 326662 },
      { url: "https://x.test/chunk-a.js", line: 1, column: 40 },
    ]);
  });

  test("reads a frame with no function name", () => {
    expect(parseStackFrames("Error\n    at https://x.test/a.js:5:6")).toEqual([
      { url: "https://x.test/a.js", line: 5, column: 6 },
    ]);
  });

  /**
   * A frame this cannot read names no coordinate, and inventing one would be a fabricated
   * citation — the thing the pipeline plan refuses by name. Dropping it is the honest answer.
   */
  test("drops a frame it cannot read rather than guessing", () => {
    const stack = ["Error", "    at <anonymous>", "    at eval (eval at foo)", "    at Object.<anonymous> (node:internal/x:1:1)"].join("\n");
    expect(parseStackFrames(stack)).toEqual([]);
  });

  test("returns nothing for a stack that is absent or not a string", () => {
    expect(parseStackFrames(undefined)).toEqual([]);
    expect(parseStackFrames("")).toEqual([]);
    expect(parseStackFrames(42 as unknown as string)).toEqual([]);
  });

  test("keeps frame order, so the first is the innermost call", () => {
    const stack = "Error\n    at a (https://x.test/1.js:1:1)\n    at b (https://x.test/2.js:2:2)";
    expect(parseStackFrames(stack).map((f) => f.url)).toEqual([
      "https://x.test/1.js",
      "https://x.test/2.js",
    ]);
  });
});

describe("drainedObservations", () => {
  test("returns the observations and the drop count the page reported", () => {
    const drained = drainedObservations({
      dropped: 3,
      observations: [{ seq: 1, ts: 10, type: "shader", detail: {}, stack: "" }],
    });
    expect(drained.dropped).toBe(3);
    expect(drained.observations).toHaveLength(1);
  });

  test("a page that reported nothing is empty rather than an error", () => {
    expect(drainedObservations(undefined)).toEqual({ observations: [], dropped: 0 });
    expect(drainedObservations({})).toEqual({ observations: [], dropped: 0 });
  });

  test("an observation missing its sequence number is not an observation", () => {
    const drained = drainedObservations({
      dropped: 0,
      observations: [{ ts: 1, type: "shader", detail: {}, stack: "" }, { seq: 2, ts: 2, type: "listener", detail: {}, stack: "" }],
    });
    expect(drained.observations.map((o) => o.seq)).toEqual([2]);
  });
});

describe("validateInstrumentation", () => {
  const doc = () => ({
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    droppedObservations: 0,
    observations: [{ seq: 1, ts: 0, type: "shader" as const, detail: {}, stack: "" }],
  });

  test("accepts a well-formed document", () => {
    expect(validateInstrumentation(doc())).toEqual({ ok: true });
  });

  test("refuses a schema version it does not implement", () => {
    expect(validateInstrumentation({ ...doc(), schemaVersion: 2 })).toEqual({ ok: false });
  });

  // A gap in seq is a detectable loss. Accepting a document whose drop counter disagrees with its
  // own sequence would make the loss silent, which is the property the counter exists to prevent.
  test("refuses a document whose sequence gap is not accounted for by its drop counter", () => {
    expect(
      validateInstrumentation({
        schemaVersion: INSTRUMENT_SCHEMA_VERSION,
        droppedObservations: 0,
        observations: [
          { seq: 1, ts: 0, type: "shader", detail: {}, stack: "" },
          { seq: 5, ts: 1, type: "shader", detail: {}, stack: "" },
        ],
      }),
    ).toEqual({ ok: false });
  });

  test("accepts the same gap when the drop counter accounts for it", () => {
    expect(
      validateInstrumentation({
        schemaVersion: INSTRUMENT_SCHEMA_VERSION,
        droppedObservations: 3,
        observations: [
          { seq: 1, ts: 0, type: "shader", detail: {}, stack: "" },
          { seq: 5, ts: 1, type: "shader", detail: {}, stack: "" },
        ],
      }),
    ).toEqual({ ok: true });
  });
});
