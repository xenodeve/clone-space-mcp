import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateStagedArchive } from "../../src/capture/checkpoints.ts";

function makeStagingRoot(): string {
  return mkdtempSync(join(tmpdir(), "clone-space-staged-archive-"));
}

function writeJson(root: string, name: string, value: unknown): void {
  writeFileSync(join(root, name), `${JSON.stringify(value, null, 2)}\n`);
}

function writeValidCapabilities(root: string): void {
  writeJson(root, "capabilities.json", {
    schemaVersion: 1,
    flags: {
      serviceWorkerDependent: false,
      webSocketDependent: false,
      closedShadowRootPresent: false,
      sourcemapDeclared: false,
    },
  });
}

function writeValidRequestNormalization(root: string): void {
  writeJson(root, "request-normalization.json", {
    schemaVersion: 1,
    query: { volatileKeys: [], keyMatch: "case-insensitive-exact" },
  });
}

function writeValidTermination(root: string): void {
  writeJson(root, "termination.json", {
    schemaVersion: 1,
    outcome: "complete",
    budgets: { wallClockMs: 30000, maxBytes: 67108864, maxNodes: 100000, maxHeight: 200000, maxEvents: 20000 },
    stats: { sweepCheckpoints: 3, scrolls: 4, wallClockMs: 1200, bytes: 100, nodes: 500, height: 2400 },
  });
}

function writeCoherentStaging(root: string, capabilities: unknown = {
  schemaVersion: 1,
  flags: {
    serviceWorkerDependent: false,
    webSocketDependent: false,
    closedShadowRootPresent: false,
    sourcemapDeclared: false,
  },
}): void {
  writeJson(root, "checkpoints.json", {
    schemaVersion: 1,
    har: { path: "network.har", scope: "run" },
    capabilities: { path: "capabilities.json", scope: "run" },
    requestNormalization: { path: "request-normalization.json", scope: "run" },
    commit: { path: "commit.json", scope: "run" },
    termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
    checkpoints: [
      {
        checkpointId: "cp:0",
        primaryTarget: { documentEpoch: "epoch:11112222333344445555666677778888" },
        openedAt: 42.5,
        artifacts: [],
      },
    ],
  });
  writeFileSync(join(root, "network.har"), `${JSON.stringify({ log: { entries: [] } })}\n`);
  writeJson(root, "request-normalization.json", {
    schemaVersion: 1,
    query: { volatileKeys: [], keyMatch: "case-insensitive-exact" },
  });
  writeValidTermination(root);
  writeValidTargets(root);
  writeJson(root, "environment.json", {
    schemaVersion: 1,
    checkpoint: {
      checkpointId: "cp:0",
      documentEpoch: "epoch:11112222333344445555666677778888",
      openedAt: 42.5,
    },
  });
  writeJson(root, "capabilities.json", capabilities);
}

// The four refusal cases below are only meaningful next to this one. Without it, a validator
// that returns { ok: false } for every input — refusing valid archives as well as invalid ones —
// passes the whole suite and would block every real capture.
test("accepts a coherent staging directory", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:11112222333344445555666677778888" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeFileSync(join(stagingRoot, "network.har"), `${JSON.stringify({ log: { entries: [] } })}\n`);
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:11112222333344445555666677778888",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: true });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

// Found by mutation: deleting the epoch half of the binding check left the whole suite green,
// because every fixture that exercised a mismatched binding mismatched on the checkpointId
// alone. A binding that names the right checkpoint but the wrong document is the incoherence
// §6.3 exists to catch — the environment would describe a document the checkpoint never saw.
test("refuses when the binding names the final checkpoint but a different document epoch", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:6666777788889999AAAABBBBCCCCDDDD" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeFileSync(join(stagingRoot, "network.har"), `${JSON.stringify({ log: { entries: [] } })}\n`);
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:777788889999AAAABBBBCCCCDDDDEEEE",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the binding names the final checkpoint but a different openedAt", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:6666777788889999AAAABBBBCCCCDDDD" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeFileSync(join(stagingRoot, "network.har"), `${JSON.stringify({ log: { entries: [] } })}\n`);
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:6666777788889999AAAABBBBCCCCDDDD",
        openedAt: 43,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when checkpoints.json is missing", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:22223333444455556666777788889999",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when checkpoints.json fails schema validation", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 2,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:3333444455556666777788889999AAAA" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeFileSync(join(stagingRoot, "network.har"), `${JSON.stringify({ log: { entries: [] } })}\n`);
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:3333444455556666777788889999AAAA",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when environment.json has no coherent final-checkpoint binding", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:444455556666777788889999AAAABBBB" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeFileSync(join(stagingRoot, "network.har"), `${JSON.stringify({ log: { entries: [] } })}\n`);
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
    });

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when a binding names a checkpointId that is not present in checkpoints.json", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:444455556666777788889999AAAABBBB" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeFileSync(join(stagingRoot, "network.har"), `${JSON.stringify({ log: { entries: [] } })}\n`);
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:99",
        documentEpoch: "epoch:444455556666777788889999AAAABBBB",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

// The final-checkpoint identity comparison is the guard under test here. ADR 0005 lists the
// conditions separately, and this isolates it: two checkpoints sharing an
// epoch and a timestamp, differing only in checkpointId, with the binding naming the one that is not last.
// Equal timestamps are legal — the monotonic rule forbids decreasing, not repeating — so this is
// reachable, and it is the only case that fails when that guard is removed.
test("refuses when the binding names a real checkpoint that is not the final one", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:55556666777788889999AAAABBBBCCCC" },
          openedAt: 10,
          artifacts: [],
        },
        {
          checkpointId: "cp:1",
          primaryTarget: { documentEpoch: "epoch:55556666777788889999AAAABBBBCCCC" },
          openedAt: 10,
          artifacts: [],
        },
      ],
    });
    writeFileSync(join(stagingRoot, "network.har"), `${JSON.stringify({ log: { entries: [] } })}\n`);
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:55556666777788889999AAAABBBBCCCC",
        openedAt: 10,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the HAR named by the association is not present", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:0123456789ABCDEF0123456789ABCDEF" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:0123456789ABCDEF0123456789ABCDEF",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("accepts a coherent staging directory whose HAR is present", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:123456789ABCDEF0123456789ABCDEF0" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeFileSync(join(stagingRoot, "network.har"), `${JSON.stringify({ log: { entries: [] } })}\n`);
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:123456789ABCDEF0123456789ABCDEF0",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: true });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the HAR association names the staging root itself", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: ".", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:ABCDEF0123456789ABCDEF0123456789" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:ABCDEF0123456789ABCDEF0123456789",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the HAR association names a directory", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:1234ABCD5678EF901234ABCD5678EF90" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    mkdirSync(join(stagingRoot, "network.har"));
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:1234ABCD5678EF901234ABCD5678EF90",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the HAR association resolves outside the staging root", async () => {
  const stagingRoot = makeStagingRoot();
  const outsideDir = mkdtempSync(join(tmpdir(), "clone-space-outside-"));
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "link/outside.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:DEADBEEFCAFEBABEDEADBEEFCAFEBABE" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeFileSync(join(outsideDir, "outside.har"), "");
    symlinkSync(outsideDir, join(stagingRoot, "link"), "junction");
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:DEADBEEFCAFEBABEDEADBEEFCAFEBABE",
        openedAt: 42.5,
      },
    });
    writeValidCapabilities(stagingRoot);
    writeValidRequestNormalization(stagingRoot);
    writeValidTermination(stagingRoot);
    writeValidTargets(stagingRoot);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("accepts a coherent staging directory with true and undetermined capability outcomes", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot, {
      schemaVersion: 1,
      flags: {
        serviceWorkerDependent: true,
        webSocketDependent: "undetermined",
        closedShadowRootPresent: false,
        sourcemapDeclared: true,
      },
    });

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: true });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the capabilities association is missing", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    const checkpoints = JSON.parse(readFileSync(join(stagingRoot, "checkpoints.json"), "utf8"));
    delete checkpoints.capabilities;
    writeJson(stagingRoot, "checkpoints.json", checkpoints);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the capabilities association is not run-scoped", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    const checkpoints = JSON.parse(readFileSync(join(stagingRoot, "checkpoints.json"), "utf8"));
    checkpoints.capabilities.scope = "checkpoint";
    writeJson(stagingRoot, "checkpoints.json", checkpoints);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when capabilities.json is missing", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    rmSync(join(stagingRoot, "capabilities.json"));

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when capabilities.json is not a regular file", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    rmSync(join(stagingRoot, "capabilities.json"));
    mkdirSync(join(stagingRoot, "capabilities.json"));

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when capabilities.json resolves outside the staging root", async () => {
  const stagingRoot = makeStagingRoot();
  const outsideDir = mkdtempSync(join(tmpdir(), "clone-space-capabilities-outside-"));
  try {
    writeCoherentStaging(stagingRoot);
    rmSync(join(stagingRoot, "capabilities.json"));
    writeJson(outsideDir, "capabilities.json", {
      schemaVersion: 1,
      flags: {
        serviceWorkerDependent: false,
        webSocketDependent: false,
        closedShadowRootPresent: false,
        sourcemapDeclared: false,
      },
    });
    symlinkSync(outsideDir, join(stagingRoot, "capabilities-link"), "junction");
    const checkpoints = JSON.parse(readFileSync(join(stagingRoot, "checkpoints.json"), "utf8"));
    checkpoints.capabilities.path = "capabilities-link/capabilities.json";
    writeJson(stagingRoot, "checkpoints.json", checkpoints);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("refuses when capabilities.json is invalid JSON", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    writeFileSync(join(stagingRoot, "capabilities.json"), "{");

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when capabilities.json has an unsupported schema version", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot, {
      schemaVersion: 2,
      flags: {
        serviceWorkerDependent: false,
        webSocketDependent: false,
        closedShadowRootPresent: false,
        sourcemapDeclared: false,
      },
    });

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when capabilities.json omits a required flag", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot, {
      schemaVersion: 1,
      flags: {
        serviceWorkerDependent: false,
        webSocketDependent: false,
        closedShadowRootPresent: false,
      },
    });

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when capabilities.json contains an invalid flag value", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot, {
      schemaVersion: 1,
      flags: {
        serviceWorkerDependent: "yes",
        webSocketDependent: false,
        closedShadowRootPresent: false,
        sourcemapDeclared: false,
      },
    });

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the request-normalization association is missing", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    const doc = JSON.parse(readFileSync(join(stagingRoot, "checkpoints.json"), "utf8")) as Record<string, unknown>;
    delete doc.requestNormalization;
    writeJson(stagingRoot, "checkpoints.json", doc);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the request-normalization association is not run-scoped", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    const doc = JSON.parse(readFileSync(join(stagingRoot, "checkpoints.json"), "utf8")) as {
      requestNormalization: { path: string; scope: string };
    };
    doc.requestNormalization = { ...doc.requestNormalization, scope: "checkpoint" };
    writeJson(stagingRoot, "checkpoints.json", doc);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when request-normalization.json is missing", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    rmSync(join(stagingRoot, "request-normalization.json"));

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when request-normalization.json is not a regular file", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    rmSync(join(stagingRoot, "request-normalization.json"));
    mkdirSync(join(stagingRoot, "request-normalization.json"));

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when request-normalization.json resolves outside the staging root", async () => {
  const stagingRoot = makeStagingRoot();
  const outsideDir = mkdtempSync(join(tmpdir(), "clone-space-policy-outside-"));
  try {
    writeCoherentStaging(stagingRoot);
    rmSync(join(stagingRoot, "request-normalization.json"));
    // The escaped file is a *valid* policy — only the containment check may refuse it.
    writeFileSync(
      join(outsideDir, "policy.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          query: { volatileKeys: [], keyMatch: "case-insensitive-exact" },
        },
        null,
        2,
      )}\n`,
    );
    symlinkSync(outsideDir, join(stagingRoot, "policy-link"), "junction");
    const doc = JSON.parse(readFileSync(join(stagingRoot, "checkpoints.json"), "utf8")) as {
      requestNormalization: { path: string; scope: string };
    };
    doc.requestNormalization = { path: "policy-link/policy.json", scope: "run" };
    writeJson(stagingRoot, "checkpoints.json", doc);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("refuses when request-normalization.json is invalid JSON", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    writeFileSync(join(stagingRoot, "request-normalization.json"), "{ not json\n");

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when request-normalization.json has an unsupported schema version", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    writeJson(stagingRoot, "request-normalization.json", {
      schemaVersion: 2,
      query: { volatileKeys: [], keyMatch: "case-insensitive-exact" },
    });

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when the policy collapses distinct archived requests (ambiguity)", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    // Two distinct raw URLs differ only in the allowlisted key.
    writeFileSync(
      join(stagingRoot, "network.har"),
      `${JSON.stringify({
        log: {
          entries: [
            { request: { url: "https://example.com/dup?_t=aaa", method: "GET" } },
            { request: { url: "https://example.com/dup?_t=bbb", method: "GET" } },
          ],
        },
      })}\n`,
    );
    writeJson(stagingRoot, "request-normalization.json", {
      schemaVersion: 1,
      query: { volatileKeys: ["_t"], keyMatch: "case-insensitive-exact" },
    });

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when termination.json is missing", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    rmSync(join(stagingRoot, "termination.json"));

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when termination.json is not a regular file", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    rmSync(join(stagingRoot, "termination.json"));
    mkdirSync(join(stagingRoot, "termination.json"));

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when termination.json resolves outside the staging root", async () => {
  const stagingRoot = makeStagingRoot();
  const outsideDir = mkdtempSync(join(tmpdir(), "clone-space-termination-outside-"));
  try {
    writeCoherentStaging(stagingRoot);
    rmSync(join(stagingRoot, "termination.json"));
    writeFileSync(join(outsideDir, "termination.json"), "{}");
    symlinkSync(outsideDir, join(stagingRoot, "termination-link"), "junction");
    const doc = JSON.parse(readFileSync(join(stagingRoot, "checkpoints.json"), "utf8")) as {
      termination: { path: string; scope: string };
    };
    doc.termination = { path: "termination-link/termination.json", scope: "run" };
    writeJson(stagingRoot, "checkpoints.json", doc);

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

function writeValidTargets(root: string): void {
  writeJson(root, "targets.json", {
    schemaVersion: 1,
    targets: [{ targetId: "OOPIF-1", type: "iframe", openedAt: 10, closedAt: 20 }],
  });
}

/**
 * §6.9. The inventory is supplemental evidence, but a published archive that claims to carry it
 * and does not — or carries one that says a target closed before it opened — is describing a
 * browser state that never existed. Publication refuses rather than shipping it.
 */
test("refuses when the targets association is missing", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    writeValidTargets(stagingRoot);
    const doc = JSON.parse(readFileSync(join(stagingRoot, "checkpoints.json"), "utf8"));
    delete doc.targets;
    writeJson(stagingRoot, "checkpoints.json", doc);

    expect(await validateStagedArchive(stagingRoot)).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses when targets.json is malformed", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    writeJson(stagingRoot, "targets.json", { schemaVersion: 1, targets: "not-an-array" });

    expect(await validateStagedArchive(stagingRoot)).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test("refuses a target that closed before it opened", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    writeJson(stagingRoot, "targets.json", {
      schemaVersion: 1,
      targets: [{ targetId: "OOPIF-1", type: "iframe", openedAt: 20, closedAt: 10 }],
    });

    expect(await validateStagedArchive(stagingRoot)).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

/**
 * The containment half of the association check, and the only case the inventory validation below
 * it cannot cover: a path that escapes the staging root would otherwise be read and — if it
 * happened to be a well-formed inventory — accepted as this run's evidence.
 */
test("refuses when the targets association resolves outside the staging root", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeCoherentStaging(stagingRoot);
    writeJson(dirname(stagingRoot), "outside-targets.json", { schemaVersion: 1, targets: [] });
    const doc = JSON.parse(readFileSync(join(stagingRoot, "checkpoints.json"), "utf8"));
    doc.targets = { path: "../outside-targets.json", scope: "run" };
    writeJson(stagingRoot, "checkpoints.json", doc);

    expect(await validateStagedArchive(stagingRoot)).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});
