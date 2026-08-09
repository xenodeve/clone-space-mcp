/**
 * §6.8 transactional integrity (plan §6.8): a commit marker hashing every published artifact so
 * a reader can verify the archive's bytes independently of the producer, and a crash mid-capture
 * never leaves something that reads as complete.
 *
 * `commit.json` is written last — after `validateStagedArchive` passes and every other artifact is
 * present — so it covers the exact bytes that were validated. The validator recomputes hashes from
 * the files, never trusting the manifest alone.
 *
 * Limit: the commit marker is self-referential (it hashes every file but itself), so it detects
 * corruption and accidental tampering, not a motivated writer who recomputes every hash. There is
 * no external root of trust — no key, no separate store. §6.8's "independently of the producer"
 * means a reader verifies bytes without trusting the producer's claims, not that an attacker who
 * rewrites both the archive and the commit is caught.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import pkg from "../../package.json" with { type: "json" };

export const COMMIT_SCHEMA_VERSION = 1;
export const COMMIT_FILE_NAME = "commit.json";
export const PRODUCER_NAME = "clone-space-mcp";
const PRODUCER_VERSION = pkg.version;

export type CommitArtifact = { path: string; sha256: string };

export type CommitV1 = {
  schemaVersion: 1;
  producer: { name: string; version: string };
  createdAt: number;
  artifacts: CommitArtifact[];
  checkpointId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

async function listFiles(root: string, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await listFiles(root, rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    } else {
      throw new Error(`commit: unexpected non-file/non-directory entry: ${rel}`);
    }
  }
  return out;
}

function sha256Of(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Walk the archive root and produce the commit document: every regular file with its sha256,
 * relative to the root. The commit marker itself is not included (it cannot reference itself).
 */
export async function buildCommit(root: string, checkpointId: string): Promise<CommitV1> {
  const files = (await listFiles(root, "")).filter((rel) => rel !== COMMIT_FILE_NAME);
  const artifacts: CommitArtifact[] = [];
  for (const rel of files.sort()) {
    artifacts.push({ path: rel, sha256: sha256Of(await readFile(join(root, rel))) });
  }
  return {
    schemaVersion: COMMIT_SCHEMA_VERSION,
    producer: { name: PRODUCER_NAME, version: PRODUCER_VERSION },
    createdAt: Date.now(),
    artifacts,
    checkpointId,
  };
}

function isArtifact(value: unknown): value is CommitArtifact {
  if (!isRecord(value)) return false;
  if (typeof value.path !== "string" || value.path.length === 0) return false;
  if (value.path.startsWith("/") || value.path.includes("\\") || /^[A-Za-z]:/.test(value.path)) {
    return false;
  }
  if (value.path.split("/").includes("..")) return false;
  return typeof value.sha256 === "string" && SHA256_PATTERN.test(value.sha256);
}

function isStrictlyWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel.length > 0 &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

/**
 * Verify a commit against the actual archive bytes. Rejects a malformed commit, a wrong
 * producer, an unsupported schema version, a missing or extra artifact, or any artifact whose
 * bytes do not hash to the recorded value. The path containment check mirrors the staged
 * archive validator so a commit cannot name a file outside the root.
 */
export function validateCommit(
  value: unknown,
  root: string,
): Promise<{ ok: true } | { ok: false }> {
  const commit = isRecord(value) ? value : {};
  if (commit.schemaVersion !== COMMIT_SCHEMA_VERSION) return Promise.resolve({ ok: false });
  if (!isRecord(commit.producer)) return Promise.resolve({ ok: false });
  if (commit.producer.name !== PRODUCER_NAME) return Promise.resolve({ ok: false });
  if (commit.producer.version !== PRODUCER_VERSION) return Promise.resolve({ ok: false });
  if (typeof commit.checkpointId !== "string" || commit.checkpointId.length === 0) {
    return Promise.resolve({ ok: false });
  }
  if (!Array.isArray(commit.artifacts)) return Promise.resolve({ ok: false });
  if (!commit.artifacts.every(isArtifact)) return Promise.resolve({ ok: false });

  return (async () => {
    const artifacts = commit.artifacts as CommitArtifact[];
    const seen = new Set<string>();
    for (const artifact of artifacts) {
      if (seen.has(artifact.path)) return { ok: false };
      seen.add(artifact.path);
      const full = join(root, artifact.path);
      if (!isStrictlyWithin(root, full)) return { ok: false };
      let buffer: Buffer;
      try {
        buffer = await readFile(full);
      } catch {
        return { ok: false };
      }
      if (sha256Of(buffer) !== artifact.sha256) return { ok: false };
    }

    // Every file under the root (except the commit marker itself) must be listed.
    let files: string[];
    try {
      files = (await listFiles(root, "")).filter((rel) => rel !== COMMIT_FILE_NAME);
    } catch {
      return { ok: false };
    }
    if (files.some((rel) => !seen.has(rel))) return { ok: false };

    return { ok: true };
  })();
}
