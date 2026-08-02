import { expect, test } from "bun:test";
import { validateCheckpoints } from "../../src/capture/checkpoints.ts";

// The three rejection cases below are only meaningful next to this one. Without it, a validator
// that returns { ok: false } for every input — refusing valid archives as well as invalid ones —
// passes the whole suite.
test("accepts a well-formed document with non-decreasing timestamps", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:0" },
        openedAt: 0,
        artifacts: [],
      },
      {
        checkpointId: "cp:1",
        primaryTarget: { documentEpoch: "epoch:1" },
        openedAt: 120,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: true });
});

test("rejects a document whose schemaVersion is not the supported major", () => {
  const result = validateCheckpoints({
    schemaVersion: 2,
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:0" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a document missing a required field", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    checkpoints: [
      {
        primaryTarget: { documentEpoch: "epoch:0" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a run whose monotonic timestamps decrease between two checkpoints", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:0" },
        openedAt: 100,
        artifacts: [],
      },
      {
        checkpointId: "cp:1",
        primaryTarget: { documentEpoch: "epoch:1" },
        openedAt: 50,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects duplicate checkpointId values within one run", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:0" },
        openedAt: 0,
        artifacts: [],
      },
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:1" },
        openedAt: 120,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects an empty checkpointId", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    checkpoints: [
      {
        checkpointId: "",
        primaryTarget: { documentEpoch: "epoch:0" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a negative openedAt", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:0" },
        openedAt: -1,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects an infinite openedAt parsed from JSON", () => {
  const document = JSON.parse(
    '{"schemaVersion":1,"checkpoints":[{"checkpointId":"cp:0","primaryTarget":{"documentEpoch":"epoch:0"},"openedAt":1e309,"artifacts":[]}]}'
  );
  const result = validateCheckpoints(document);

  expect(result).toEqual({ ok: false });
});
