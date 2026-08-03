import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateStagedArchive } from "../../src/capture/checkpoints.ts";

function makeStagingRoot(): string {
  return mkdtempSync(join(tmpdir(), "clone-space-staged-archive-"));
}

function writeJson(root: string, name: string, value: unknown): void {
  writeFileSync(join(root, name), `${JSON.stringify(value, null, 2)}\n`);
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
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:11112222333344445555666677778888" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:11112222333344445555666677778888",
        openedAt: 42.5,
      },
    });

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
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:6666777788889999AAAABBBBCCCCDDDD" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:777788889999AAAABBBBCCCCDDDDEEEE",
        openedAt: 42.5,
      },
    });

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
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:3333444455556666777788889999AAAA" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:3333444455556666777788889999AAAA",
        openedAt: 42.5,
      },
    });

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
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:444455556666777788889999AAAABBBB" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
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
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:444455556666777788889999AAAABBBB" },
          openedAt: 42.5,
          artifacts: [],
        },
      ],
    });
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:99",
        documentEpoch: "epoch:444455556666777788889999AAAABBBB",
        openedAt: 42.5,
      },
    });

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});

// The "unknown checkpointId" case above names a checkpointId that is absent entirely, which several
// guards all catch, so it cannot prove any single one is needed. ADR 0005 lists the conditions
// separately, and this isolates the final-checkpoint identity guard: two checkpoints sharing an
// epoch and a timestamp, differing only in checkpointId, with the binding naming the one that is not last.
// Equal timestamps are legal — the monotonic rule forbids decreasing, not repeating — so this is
// reachable, and it is the only case that fails when that guard is removed.
test("refuses when the binding names a real checkpoint that is not the final one", async () => {
  const stagingRoot = makeStagingRoot();
  try {
    writeJson(stagingRoot, "checkpoints.json", {
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
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
    writeJson(stagingRoot, "environment.json", {
      schemaVersion: 1,
      checkpoint: {
        checkpointId: "cp:0",
        documentEpoch: "epoch:55556666777788889999AAAABBBBCCCC",
        openedAt: 10,
      },
    });

    const result = await validateStagedArchive(stagingRoot);

    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
});
