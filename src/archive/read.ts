/**
 * Read a published archive into plain data (#123, under the #8 layering constraint).
 *
 * This module owns no MCP, no transport and no interpretation. It resolves the files `captureHar`
 * publishes, parses the JSON ones, and hands back what is there — so a tool, a test, a CLI harness
 * and an inspector can all reach the same data without an agent in the loop.
 */

import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

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

export interface ArchiveRead {
  /** The absolute archive root, as resolved. */
  root: string;
  /** Every JSON document that is present, parsed. A document that is absent is simply not a key. */
  documents: Partial<Record<ArchiveDocumentName, unknown>>;
  /** Documents the archive does not carry. Absence is data, not an error — the caller decides. */
  missing: ArchiveDocumentName[];
  /** The HAR is reported by path: it is not JSON this module should hold in memory. */
  harPath: string;
}

/** Is `candidate` strictly inside `root`? Used before reading anything an archive names. */
function isStrictlyWithin(root: string, candidate: string): boolean {
  const base = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate !== root && candidate.startsWith(base);
}

async function readJson(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(raw) as unknown;
}

export async function readArchive(root: string): Promise<ArchiveRead> {
  const archiveRoot = resolve(root);
  const documents: Partial<Record<ArchiveDocumentName, unknown>> = {};
  const missing: ArchiveDocumentName[] = [];

  for (const [name, fileName] of Object.entries(ARCHIVE_DOCUMENTS) as [
    ArchiveDocumentName,
    string,
  ][]) {
    const parsed = await readJson(resolve(archiveRoot, fileName));
    if (parsed === undefined) {
      missing.push(name);
      continue;
    }
    documents[name] = parsed;
  }

  return {
    root: archiveRoot,
    documents,
    missing,
    harPath: resolveAssociation(archiveRoot, documents.checkpoints, "har", HAR_FILE_NAME),
  };
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
