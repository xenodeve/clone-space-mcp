import { describe, expect, test } from "bun:test";
import {
  assembleChunk,
  containerRef,
  droppedAfterOverflow,
  TRANSCRIPT_SCHEMA_VERSION,
  validateTranscript,
  type TranscriptEvent,
  type ContainerNode,
} from "../../src/capture/transcript.ts";

function ev(seq: number, type = "scroll" as const, target = "window"): TranscriptEvent {
  return { seq, ts: seq * 10, type, target, detail: {} };
}

describe("assembleChunk", () => {
  test("produces a chunk with gap-free global seq from a running seq", () => {
    const { chunk } = assembleChunk([ev(11), ev(12)], 3, 10);
    expect(chunk).toEqual({
      chunkSeq: 3,
      events: [
        { seq: 11, ts: 110, type: "scroll", target: "window", detail: {} },
        { seq: 12, ts: 120, type: "scroll", target: "window", detail: {} },
      ],
    });
  });

  test("returns the running seq advanced by the event count", () => {
    const result = assembleChunk([ev(5), ev(6), ev(7)], 1, 4);
    expect(result.runningSeq).toBe(7);
  });

  test("throws when the first event seq is not contiguous with runningSeq + 1", () => {
    expect(() => assembleChunk([ev(20)], 1, 10)).toThrow(/contiguous/);
  });

  test("throws on an internal gap within the chunk", () => {
    expect(() => assembleChunk([ev(11), ev(13)], 1, 10)).toThrow(/contiguous/);
  });
});

describe("droppedAfterOverflow", () => {
  test("keeps events under the cap and reports zero dropped", () => {
    const result = droppedAfterOverflow([ev(1), ev(2), ev(3)], 5, 1000, 0);
    expect(result.kept.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(result.droppedEvents).toBe(0);
  });

  test("drops the OLDEST events when the count cap is exceeded", () => {
    const result = droppedAfterOverflow([ev(1), ev(2), ev(3), ev(4), ev(5), ev(6)], 4, 1000, 0);
    expect(result.kept.map((e) => e.seq)).toEqual([3, 4, 5, 6]);
    expect(result.droppedEvents).toBe(2);
  });

  test("drops the oldest when the byte cap is exceeded", () => {
    const result = droppedAfterOverflow([ev(1), ev(2)], 10, 40, 0);
    // Each event serializes to ~50 bytes, so two exceed 40; the oldest goes.
    expect(result.kept.length).toBeLessThan(2);
    expect(result.droppedEvents).toBeGreaterThanOrEqual(1);
  });

  test("adds to a pre-existing dropped count", () => {
    const result = droppedAfterOverflow([ev(1), ev(2), ev(3)], 2, 1000, 5);
    expect(result.droppedEvents).toBe(6);
  });

  test("does not mutate the input array", () => {
    const input = [ev(1), ev(2)];
    droppedAfterOverflow(input, 1, 1000, 0);
    expect(input.length).toBe(2);
  });
});

describe("containerRef", () => {
  test("returns the wa: id when present", () => {
    const node: ContainerNode = { wa: "wa:div|0:12", tag: "DIV", index: 2 };
    expect(containerRef(node)).toBe("wa:div|0:12");
  });

  test("builds a tag[n] chain from the body when no wa: id", () => {
    const node: ContainerNode = {
      tag: "DIV",
      index: 1,
      parent: { tag: "MAIN", index: 0, parent: { tag: "BODY", index: 0 } },
    };
    expect(containerRef(node)).toBe("BODY[0] > MAIN[0] > DIV[1]");
  });

  test("stops at the body root", () => {
    const node: ContainerNode = { tag: "BODY", index: 0 };
    expect(containerRef(node)).toBe("BODY[0]");
  });
});

describe("validateTranscript", () => {
  const validDoc = {
    schemaVersion: 1,
    droppedEvents: 0,
    chunks: [
      { chunkSeq: 1, events: [ev(1), ev(2)] },
      { chunkSeq: 2, events: [ev(3)] },
    ],
  };

  test("accepts a well-formed transcript", () => {
    expect(validateTranscript(validDoc)).toEqual({ ok: true });
  });

  test("rejects an unsupported schema version", () => {
    expect(validateTranscript({ ...validDoc, schemaVersion: 2 })).toEqual({ ok: false });
  });

  test("rejects a negative droppedEvents", () => {
    expect(validateTranscript({ ...validDoc, droppedEvents: -1 })).toEqual({ ok: false });
  });

  test("allows a cross-chunk seq gap when droppedEvents explains it", () => {
    const gapped = {
      schemaVersion: 1,
      droppedEvents: 1,
      chunks: [
        { chunkSeq: 1, events: [ev(1), ev(2)] },
        { chunkSeq: 2, events: [ev(4)] }, // seq 3 was dropped by the in-page cap
      ],
    };
    expect(validateTranscript(gapped)).toEqual({ ok: true });
  });

  test("rejects an internal gap within a single chunk (a harness bug, not a drop)", () => {
    const internalGap = {
      schemaVersion: 1,
      droppedEvents: 0,
      chunks: [{ chunkSeq: 1, events: [ev(1), ev(3)] }],
    };
    expect(validateTranscript(internalGap)).toEqual({ ok: false });
  });

  test("rejects an empty or unknown event type", () => {
    const badType = { ...validDoc, chunks: [{ chunkSeq: 1, events: [{ ...ev(1), type: "unknown" }] }] };
    expect(validateTranscript(badType)).toEqual({ ok: false });
  });

  test("rejects an empty target", () => {
    const badTarget = { ...validDoc, chunks: [{ chunkSeq: 1, events: [{ ...ev(1), target: "" }] }] };
    expect(validateTranscript(badTarget)).toEqual({ ok: false });
  });

  test("rejects a non-array chunks value", () => {
    expect(validateTranscript({ ...validDoc, chunks: "x" })).toEqual({ ok: false });
  });

  test("exports the schema version", () => {
    expect(TRANSCRIPT_SCHEMA_VERSION).toBe(1);
  });
});
