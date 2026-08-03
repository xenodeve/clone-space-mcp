import { expect, test } from "bun:test";
import { validateCheckpoints } from "../../src/capture/checkpoints.ts";

// The three rejection cases below are only meaningful next to this one. Without it, a validator
// that returns { ok: false } for every input — refusing valid archives as well as invalid ones —
// passes the whole suite.
test("accepts a well-formed document with non-decreasing timestamps", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:A1B2C3D4E5F60718293A4B5C6D7E8F90" },
        openedAt: 0,
        artifacts: [],
      },
      {
        checkpointId: "cp:1",
        primaryTarget: { documentEpoch: "epoch:B2C3D4E5F60718293A4B5C6D7E8F901A" },
        openedAt: 120,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: true });
});

test("rejects a document missing the run-level HAR association", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:C3D4E5F60718293A4B5C6D7E8F901A2B" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a document whose HAR scope is not run", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "checkpoint" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:D4E5F60718293A4B5C6D7E8F901A2B3C" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a document whose HAR path is empty", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:E5F60718293A4B5C6D7E8F901A2B3C4D" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a document whose schemaVersion is not the supported major", () => {
  const result = validateCheckpoints({
    schemaVersion: 2,
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:F60718293A4B5C6D7E8F901A2B3C4D5E" },
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
        primaryTarget: { documentEpoch: "epoch:0718293A4B5C6D7E8F901A2B3C4D5E6F" },
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
        primaryTarget: { documentEpoch: "epoch:18293A4B5C6D7E8F901A2B3C4D5E6F70" },
        openedAt: 100,
        artifacts: [],
      },
      {
        checkpointId: "cp:1",
        primaryTarget: { documentEpoch: "epoch:293A4B5C6D7E8F901A2B3C4D5E6F7018" },
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
        primaryTarget: { documentEpoch: "epoch:3A4B5C6D7E8F901A2B3C4D5E6F701829" },
        openedAt: 0,
        artifacts: [],
      },
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:4B5C6D7E8F901A2B3C4D5E6F7018293A" },
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
        primaryTarget: { documentEpoch: "epoch:5C6D7E8F901A2B3C4D5E6F7018293A4B" },
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
        primaryTarget: { documentEpoch: "epoch:6D7E8F901A2B3C4D5E6F7018293A4B5C" },
        openedAt: -1,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects an infinite openedAt parsed from JSON", () => {
  const document = JSON.parse(
    '{"schemaVersion":1,"checkpoints":[{"checkpointId":"cp:0","primaryTarget":{"documentEpoch":"epoch:7E8F901A2B3C4D5E6F7018293A4B5C6D"},"openedAt":1e309,"artifacts":[]}]}'
  );
  const result = validateCheckpoints(document);

  expect(result).toEqual({ ok: false });
});

test("rejects an empty documentEpoch", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

// The epoch is the field that has leaked twice. `checkpoints.json` never passes through
// `redactHarArchive`, so an epoch carrying the page URL publishes whatever the query string held.
test("rejects a documentEpoch that carries the captured page URL", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:https://example.com/?token=FAKE_QUERY_SENTINEL" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a documentEpoch too short to be an opaque document token", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
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

// Paired with the two refusals above: without it, a validator that rejects every epoch passes them.
test("accepts an opaque document token as the epoch", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:9CE8D5D986A871E1ACF720B27A801696" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: true });
});

test("rejects a document with no checkpoints", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    checkpoints: [],
  });

  expect(result).toEqual({ ok: false });
});
