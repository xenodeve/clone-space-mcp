/**
 * Read a published archive into plain data (#123, under the #8 layering constraint).
 *
 * This module owns no MCP, no transport and no interpretation. It resolves the files `captureHar`
 * publishes, parses the JSON ones, and hands back what is there — so a tool, a test, a CLI harness
 * and an inspector can all reach the same data without an agent in the loop.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { validateCommit, type CommitArtifact, type CommitV1 } from "../capture/commit.ts";

/** The JSON documents an archive publishes, keyed the way `checkpoints.json` associates them. */
export const ARCHIVE_DOCUMENTS = {
  checkpoints: "checkpoints.json",
  environment: "environment.json",
  capabilities: "capabilities.json",
  requestNormalization: "request-normalization.json",
  targets: "targets.json",
  termination: "termination.json",
  commit: "commit.json",
} as const;

export type ArchiveDocumentName = keyof typeof ARCHIVE_DOCUMENTS;

export const HAR_FILE_NAME = "network.har";

/**
 * The eleven §6.x archive contracts, and the artifact each one lands in.
 *
 * `artifact: null` means **this version of capture publishes nothing for it** — §6.6 is a type
 * only, and §6.7/§6.11 have their schema but no capture wiring. That is a different fact from an
 * archive being *missing* a file it should have, and collapsing the two is how a reader reports a
 * complete archive as broken, or an incomplete one as fine.
 */
export const ARCHIVE_CONTRACTS: readonly { section: string; name: string; artifact: string | null }[] =
  [
    { section: "§6.1", name: "credential redaction", artifact: HAR_FILE_NAME },
    { section: "§6.2", name: "environment", artifact: "environment.json" },
    { section: "§6.3", name: "checkpoint coherence", artifact: "checkpoints.json" },
    { section: "§6.4", name: "capabilities", artifact: "capabilities.json" },
    { section: "§6.5", name: "request normalization", artifact: "request-normalization.json" },
    { section: "§6.6", name: "target reference schema", artifact: null },
    { section: "§6.7", name: "interaction transcript", artifact: null },
    { section: "§6.8", name: "transactional integrity", artifact: "commit.json" },
    { section: "§6.9", name: "target inventory", artifact: "targets.json" },
    { section: "§6.10", name: "termination budget", artifact: "termination.json" },
    { section: "§6.11", name: "scroll-container transcript", artifact: null },
  ];

export type ContractStatus = "present" | "missing" | "not-produced";

export interface ContractCoverage {
  section: string;
  name: string;
  artifact: string | null;
  status: ContractStatus;
}

export interface ArchiveRead {
  /** The absolute archive root, as resolved. */
  root: string;
  /** Every JSON document that is present, parsed. A document that is absent is simply not a key. */
  documents: Partial<Record<ArchiveDocumentName, unknown>>;
  /** Documents the archive does not carry. Absence is data, not an error — the caller decides. */
  missing: ArchiveDocumentName[];
  /** The HAR is reported by path: it is not JSON this module should hold in memory. */
  harPath: string;
  /**
   * The `commit.json` verdict, as data. `validateCommit` is a fail-closed gate and stops at
   * ok/not-ok; a reader is a diagnostic, so it also names the artifacts whose bytes no longer hash
   * to what the commit recorded. `mismatched` is empty when the verdict is ok, and can also be
   * empty on a failure the hash walk cannot explain — a missing commit, a wrong producer, an
   * unlisted file — which is itself the signal that the failure is structural rather than a
   * corrupted artifact.
   */
  integrity: { ok: boolean; mismatched: string[] };
  /** One row per §6.x contract, so "is this capture complete?" is answerable without an agent. */
  contracts: ContractCoverage[];
}

/** Is `candidate` strictly inside `root`? Used before reading anything an archive names. */
function isStrictlyWithin(root: string, candidate: string): boolean {
  const base = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate !== root && candidate.startsWith(base);
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Parse a document, or fail with a message about *this reader* rather than about the runtime.
 *
 * The caller supplied the path, so naming it discloses nothing. What a raw error adds is the
 * parser's own account of the bytes and, on a permission failure, the runtime's phrasing of what
 * exists where — detail the caller did not ask for, cannot act on, and which travels back over MCP
 * to whoever is driving the tool.
 */
async function readJson(path: string, fileName: string, root: string): Promise<unknown | undefined> {
  let raw: string | undefined;
  try {
    raw = await readFileOrUndefined(path);
  } catch {
    throw new Error(`inspect_archive: ${fileName} in ${root} could not be read`);
  }
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    void error;
    throw new Error(`inspect_archive: ${fileName} in ${root} is not readable as JSON`);
  }
}

export async function readArchive(root: string): Promise<ArchiveRead> {
  const archiveRoot = resolve(root);
  const documents: Partial<Record<ArchiveDocumentName, unknown>> = {};
  const missing: ArchiveDocumentName[] = [];
  const present = new Set<string>();

  for (const [name, fileName] of Object.entries(ARCHIVE_DOCUMENTS) as [
    ArchiveDocumentName,
    string,
  ][]) {
    const parsed = await readJson(resolve(archiveRoot, fileName), fileName, archiveRoot);
    if (parsed === undefined) {
      missing.push(name);
      continue;
    }
    documents[name] = parsed;
    present.add(fileName);
  }
  if ((await readFileOrUndefined(resolve(archiveRoot, HAR_FILE_NAME))) !== undefined) {
    present.add(HAR_FILE_NAME);
  }

  return {
    root: archiveRoot,
    documents,
    missing,
    harPath: resolveAssociation(archiveRoot, documents.checkpoints, "har", HAR_FILE_NAME),
    integrity: await verifyIntegrity(archiveRoot, documents.commit),
    contracts: ARCHIVE_CONTRACTS.map((contract) => ({
      ...contract,
      status:
        contract.artifact === null
          ? "not-produced"
          : present.has(contract.artifact)
            ? "present"
            : "missing",
    })),
  };
}

async function verifyIntegrity(
  root: string,
  commit: unknown,
): Promise<{ ok: boolean; mismatched: string[] }> {
  const verdict = await validateCommit(commit, root);
  if (verdict.ok) return { ok: true, mismatched: [] };

  const artifacts =
    typeof commit === "object" && commit !== null && Array.isArray((commit as CommitV1).artifacts)
      ? ((commit as CommitV1).artifacts as CommitArtifact[])
      : [];
  const mismatched: string[] = [];
  for (const artifact of artifacts) {
    if (typeof artifact?.path !== "string" || typeof artifact?.sha256 !== "string") continue;
    const full = resolve(join(root, artifact.path));
    if (!isStrictlyWithin(root, full)) {
      mismatched.push(artifact.path);
      continue;
    }
    let actual: string;
    try {
      actual = createHash("sha256").update(await readFile(full)).digest("hex");
    } catch {
      mismatched.push(artifact.path);
      continue;
    }
    if (actual !== artifact.sha256) mismatched.push(artifact.path);
  }
  return { ok: false, mismatched };
}

/**
 * Resolve a path an archive names for itself, and refuse one that escapes the root.
 *
 * The fixed filenames above cannot escape — they are constants in this file. `checkpoints.json`
 * is different: it is *data*, it names the other artifacts, and it arrived with the archive. A
 * reader that resolves an association without this check reopens the containment hole publication
 * already closed, on every read, for every archive it is ever handed.
 */
function resolveAssociation(
  root: string,
  checkpoints: unknown,
  key: string,
  fallbackFileName: string,
): string {
  const association =
    typeof checkpoints === "object" && checkpoints !== null
      ? (checkpoints as Record<string, unknown>)[key]
      : undefined;
  const named =
    typeof association === "object" && association !== null
      ? (association as { path?: unknown }).path
      : undefined;
  const path = resolve(root, typeof named === "string" ? named : fallbackFileName);
  if (!isStrictlyWithin(root, path)) {
    throw new Error(`archive: the ${key} association resolves outside the archive root`);
  }
  return path;
}
