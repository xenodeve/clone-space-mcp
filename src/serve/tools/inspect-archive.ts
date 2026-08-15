/**
 * The `inspect_archive` tool (#124), under #8's layering constraint: this is a plain function of
 * its parameters. Nothing here knows what MCP is, and `src/serve/mcp.ts` may not add behaviour on
 * top of it — otherwise the only way to test that behaviour is through an agent.
 *
 * The question it answers is the one #8 says has to be answerable before an agent ever reads an
 * archive: **is this capture complete?** "The extractor found 12 animations" is not an answer
 * without something to compare against, and neither is an archive that merely exists.
 */

import { resolve, sep } from "node:path";
import { readArchive, type ContractCoverage } from "../../archive/read.ts";

export interface InspectArchiveParams {
  /** Absolute or relative path to a published archive directory. */
  path: string;
  /**
   * Directories the tool may read archives from. **Omitted means no restriction**, which is the
   * documented default and the residual risk ADR 0009 states.
   *
   * This is the mechanism, not a value: which roots a deployment permits is its own call, and a
   * tool that offers no way to restrict leaves an operator with nothing to set even when they know
   * exactly what they want. Defaulting to a restriction instead would make the reader unable to
   * open an archive the user stored anywhere but one place — a different failure, and a worse one
   * for a local tool.
   */
  allowedRoots?: readonly string[];
}

export interface InspectArchiveResult {
  root: string;
  /**
   * Whether this archive can be trusted as a whole: it is **intact** *and* the capture that wrote
   * it **terminated complete**. Both components are returned separately, so a caller that reads
   * `false` can tell which half failed.
   *
   * The two are different claims and both are needed (#159). `integrity` says every file still
   * hashes to what `commit.json` recorded — the bytes on disk are the bytes that were validated.
   * `termination.outcome` says whether capture actually got everything it went for. An archive can
   * be perfectly intact and still be missing the GSAP plugins the page needs, and that is not a
   * hypothetical: measured on labs.chaingpt.org, www.chaingpt.org and firecrawl.dev, all three
   * reported `complete: true` next to `outcome: "incomplete"`.
   *
   * It still deliberately does **not** fold in `contracts`. A missing artifact already fails the
   * commit, so that clause could never fail on its own, and a guard that cannot fail alone is
   * indistinguishable from one that works. `termination` is different — it fails alone, which is
   * what earns it a place here. What `contracts` answers is *what does this archive contain*, and
   * the caller reads it directly.
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

function isWithin(root: string, candidate: string): boolean {
  const base = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(base);
}

export async function inspectArchive(params: InspectArchiveParams): Promise<InspectArchiveResult> {
  if (params.allowedRoots !== undefined) {
    const wanted = resolve(params.path);
    if (!params.allowedRoots.some((root) => isWithin(resolve(root), wanted))) {
      throw new Error(`inspect_archive: ${wanted} is outside the allowed roots`);
    }
  }
  const archive = await readArchive(params.path);
  // An archive without a commit marker was never published: `commit.json` is written last, after
  // validation, so its absence means the capture aborted or the path is simply something else.
  if (archive.documents.commit === undefined) {
    throw new Error(`inspect_archive: ${params.path} is not an archive — no commit.json`);
  }

  const termination = terminationOf(archive.documents.termination);
  return {
    root: archive.root,
    complete: archive.integrity.ok && termination.outcome === "complete",
    integrity: archive.integrity,
    contracts: archive.contracts,
    documents: archive.contracts.filter((c) => c.status === "present").map((c) => c.artifact!),
    termination,
  };
}
