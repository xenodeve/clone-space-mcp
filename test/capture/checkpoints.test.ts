import { expect, test } from "bun:test";
import { validateCapabilities, validateCheckpoints } from "../../src/capture/checkpoints.ts";

// The three rejection cases below are only meaningful next to this one. Without it, a validator
// that returns { ok: false } for every input — refusing valid archives as well as invalid ones —
// passes the whole suite.
test("accepts a well-formed document with non-decreasing timestamps", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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

test("rejects a checkpoint whose artifacts is not an array", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:6D7E8F901A2B3C4D5E6F7018293A4B5C" },
        openedAt: 0,
        artifacts: 42,
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a negative openedAt", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    '{"schemaVersion":1,"har":{"path":"network.har","scope":"run"},"capabilities":{"path":"capabilities.json","scope":"run"},"requestNormalization":{"path":"request-normalization.json","scope":"run"},"checkpoints":[{"checkpointId":"cp:0","primaryTarget":{"documentEpoch":"epoch:7E8F901A2B3C4D5E6F7018293A4B5C6D"},"openedAt":1e309,"artifacts":[]}]}'
  );
  const result = validateCheckpoints(document);

  expect(result).toEqual({ ok: false });
});

test("rejects an empty documentEpoch", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
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

test("rejects a har.path that escapes the archive", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "../outside.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:A0B1C2D3E4F5061728394A5B6C7D8E9F" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects an absolute har.path", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "/etc/passwd", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:B1C2D3E4F5061728394A5B6C7D8E9F0A" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a har.path with an interior parent segment", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "net/../../outside.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:C2D3E4F5061728394A5B6C7D8E9F0A1B" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("accepts a har.path in a subdirectory of the archive", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "net/network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:D3E4F5061728394A5B6C7D8E9F0A1B2C" },
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
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [],
  });

  expect(result).toEqual({ ok: false });
});

test("accepts a run-scoped capabilities association", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:0123456789ABCDEF0123456789ABCDEF" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: true });
});

test("rejects a document missing the run-level capabilities association", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:123456789ABCDEF0123456789ABCDEF0" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a document whose capabilities scope is not run", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "checkpoint" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:23456789ABCDEF0123456789ABCDEF01" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a capabilities association with an archive escape", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "../capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:3456789ABCDEF0123456789ABCDEF012" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("accepts capabilities with the four tri-state flags", () => {
  const result = validateCapabilities({
    schemaVersion: 1,
    flags: {
      serviceWorkerDependent: true,
      webSocketDependent: false,
      closedShadowRootPresent: "undetermined",
      sourcemapDeclared: false,
    },
  });

  expect(result).toEqual({ ok: true });
});

test("rejects capabilities with an unsupported schema version", () => {
  const result = validateCapabilities({
    schemaVersion: 2,
    flags: {
      serviceWorkerDependent: false,
      webSocketDependent: false,
      closedShadowRootPresent: false,
      sourcemapDeclared: false,
    },
  });

  expect(result).toEqual({ ok: false });
});

test("rejects capabilities missing one of the four flags", () => {
  const result = validateCapabilities({
    schemaVersion: 1,
    flags: {
      serviceWorkerDependent: false,
      webSocketDependent: false,
      closedShadowRootPresent: false,
    },
  });

  expect(result).toEqual({ ok: false });
});

test("rejects capabilities with a value outside the tri-state contract", () => {
  const result = validateCapabilities({
    schemaVersion: 1,
    flags: {
      serviceWorkerDependent: "yes",
      webSocketDependent: false,
      closedShadowRootPresent: false,
      sourcemapDeclared: false,
    },
  });

  expect(result).toEqual({ ok: false });
});

test("accepts a run-scoped request-normalization association", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:0123456789ABCDEF0123456789ABCDEF" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: true });
});

test("rejects a document missing the run-level request-normalization association", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:123456789ABCDEF0123456789ABCDEF0" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a document whose request-normalization scope is not run", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "checkpoint" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:23456789ABCDEF0123456789ABCDEF01" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});

test("rejects a request-normalization association with an archive escape", () => {
  const result = validateCheckpoints({
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "../request-normalization.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:3456789ABCDEF0123456789ABCDEF012" },
        openedAt: 0,
        artifacts: [],
      },
    ],
  });

  expect(result).toEqual({ ok: false });
});
