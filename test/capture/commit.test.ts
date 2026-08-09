import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMIT_SCHEMA_VERSION,
  buildCommit,
  validateCommit,
} from "../../src/capture/commit.ts";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "clone-space-commit-"));
}

function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("buildCommit", () => {
  test("lists every file with a correct sha256 and relative path", async () => {
    const root = makeRoot();
    try {
      write(root, "network.har", '{"log":{}}');
      write(root, "checkpoints.json", '{"schemaVersion":1}');
      const commit = await buildCommit(root, "cp:0");

      expect(commit.schemaVersion).toBe(COMMIT_SCHEMA_VERSION);
      expect(commit.producer.name).toBe("clone-space-mcp");
      expect(commit.checkpointId).toBe("cp:0");
      expect(commit.artifacts).toHaveLength(2);
      const harEntry = commit.artifacts.find((a) => a.path === "network.har");
      expect(harEntry?.sha256).toBe(
        "7f959f83ac84e60f296a95caeab65b3f9c65c33b48fed012ef357acd741cadef",
      );
      // path must be relative, not absolute
      expect(harEntry?.path.startsWith("/") || /^[A-Za-z]:/.test(harEntry!.path)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("walks nested directories", async () => {
    const root = makeRoot();
    try {
      write(root, "attachments/body.txt", "hello");
      write(root, "network.har", "{}");
      const commit = await buildCommit(root, "cp:0");
      expect(commit.artifacts.map((a) => a.path).sort()).toEqual(["attachments/body.txt", "network.har"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("validateCommit", () => {
  test("accepts a commit that matches the bytes", async () => {
    const root = makeRoot();
    try {
      write(root, "network.har", '{"log":{}}');
      const commit = await buildCommit(root, "cp:0");
      expect(await validateCommit(commit, root)).toEqual({ ok: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("detects a tampered artifact (byte modified after commit)", async () => {
    const root = makeRoot();
    try {
      write(root, "network.har", '{"log":{}}');
      const commit = await buildCommit(root, "cp:0");
      write(root, "network.har", '{"log":{"tampered":true}}');
      expect(await validateCommit(commit, root)).toEqual({ ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a missing artifact", async () => {
    const root = makeRoot();
    try {
      write(root, "network.har", "{}");
      const commit = await buildCommit(root, "cp:0");
      rmSync(join(root, "network.har"));
      expect(await validateCommit(commit, root)).toEqual({ ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects an artifact not listed in the commit (extra file)", async () => {
    const root = makeRoot();
    try {
      write(root, "network.har", "{}");
      const commit = await buildCommit(root, "cp:0");
      write(root, "sneaky.txt", "extra");
      expect(await validateCommit(commit, root)).toEqual({ ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a wrong producer name", async () => {
    const root = makeRoot();
    try {
      write(root, "network.har", "{}");
      const commit = await buildCommit(root, "cp:0");
      commit.producer = { name: "other", version: "1.0.0" };
      expect(await validateCommit(commit, root)).toEqual({ ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a wrong producer version", async () => {
    const root = makeRoot();
    try {
      write(root, "network.har", "{}");
      const commit = await buildCommit(root, "cp:0");
      commit.producer = { ...commit.producer, version: "9.9.9" };
      expect(await validateCommit(commit, root)).toEqual({ ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects an unsupported schema version", async () => {
    const root = makeRoot();
    try {
      write(root, "network.har", "{}");
      const commit = await buildCommit(root, "cp:0");
      (commit as { schemaVersion: number }).schemaVersion = 2;
      expect(await validateCommit(commit, root)).toEqual({ ok: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a non-record commit", async () => {
    for (const doc of [null, 1, "x", [], true]) {
      expect(await validateCommit(doc, makeRoot())).toEqual({ ok: false });
    }
  });
});
