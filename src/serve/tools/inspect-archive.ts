/**
 * The `inspect_archive` tool (#124), under #8's layering constraint: this is a plain function of
 * its parameters. Nothing here knows what MCP is, and `src/serve/mcp.ts` may not add behaviour on
 * top of it — otherwise the only way to test that behaviour is through an agent.
 *
 * The question it answers is the one #8 says has to be answerable before an agent ever reads an
 * archive: **is this capture complete?** "The extractor found 12 animations" is not an answer
 * without something to compare against, and neither is an archive that merely exists.
 */

import { readArchive, type ContractCoverage } from "../../archive/read.ts";

export interface InspectArchiveParams {
  /** Absolute or relative path to a published archive directory. */
  path: string;
}

export interface InspectArchiveResult {
  root: string;
  /**
   * Whether the archive is intact: `commit.json` lists every file under the root and every one
   * still hashes to what was recorded. That is the completeness question, because the commit
   * marker is written last, after validation — an aborted capture has no commit at all.
   *
   * It deliberately does **not** fold in `contracts`. A missing artifact already fails the commit,
   * so a second clause here could never fail on its own, and a guard that cannot fail alone is
   * indistinguishable from one that works. What `contracts` answers is a different question —
   * *what does this archive contain* — and the caller reads it directly.
   */
  complete: boolean;
  integrity: { ok: boolean; mismatched: string[] };
  contracts: ContractCoverage[];
  /** Present documents, by artifact name, so a caller can see what it may ask for next. */
  documents: string[];
  /** §6.10: how the sweep ended. `reason` is absent on a clean quiet-window termination. */
  termination: { outcome: string; reason?: string };
}

function terminationOf(document: unknown): { outcome: string; reason?: string } {
  if (typeof document !== "object" || document === null) return { outcome: "unknown" };
  const record = document as { outcome?: unknown; reason?: unknown };
  const outcome = typeof record.outcome === "string" ? record.outcome : "unknown";
  return typeof record.reason === "string" ? { outcome, reason: record.reason } : { outcome };
}

export async function inspectArchive(params: InspectArchiveParams): Promise<InspectArchiveResult> {
  const archive = await readArchive(params.path);
  // An archive without a commit marker was never published: `commit.json` is written last, after
  // validation, so its absence means the capture aborted or the path is simply something else.
  if (archive.documents.commit === undefined) {
    throw new Error(`inspect_archive: ${params.path} is not an archive — no commit.json`);
  }

  return {
    root: archive.root,
    complete: archive.integrity.ok,
    integrity: archive.integrity,
    contracts: archive.contracts,
    documents: archive.contracts.filter((c) => c.status === "present").map((c) => c.artifact!),
    termination: terminationOf(archive.documents.termination),
  };
}
