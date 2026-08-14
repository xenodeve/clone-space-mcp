/**
 * clone-space-mcp — archive a live web page so it replays offline with real motion,
 * and an AI agent can read how it is built.
 *
 * The pipeline is four stages; each lands in its own phase (see
 * `docs/OPEN-WORK-LEDGER.md`).
 */
export const STAGES = ["capture", "replay", "extract", "serve"] as const;

export type Stage = (typeof STAGES)[number];

/**
 * Element identity — the contract every other stage references. An id names an element
 * within one run; recognising the same element across capture and replay is what
 * `reconcile` does, and what it refuses to guess at.
 */
export {
  reconcile,
  IDENTITY_SCHEMA_VERSION,
  type ElementFingerprint,
  type IdentitySnapshot,
  type Match,
  type Unresolved,
  type UnresolvedReason,
  type ReconcileResult,
} from "./identity/reconcile.ts";
export { fingerprintKey } from "./identity/fingerprint.ts";
/**
 * The two remaining cross-stage contracts. They are exported for the same reason `reconcile` is:
 * extract and replay have to name the same element and the same target as capture did, and a
 * contract only one stage can import is not a contract.
 */
export { captureIdentity, IDENTITY_INIT_SCRIPT } from "./identity/inject.ts";
export { validateTargetRef, TARGET_REF_SCHEMA_VERSION, type TargetRefV1 } from "./capture/target-ref.ts";

/**
 * Capture — archive a live page. Takes its browser rather than launching one, so a caller decides
 * the runtime and a test can hand it a fake.
 */
export { captureHar, type CaptureHarOptions } from "./capture/record.ts";

/** Archive — read a published archive into plain data. No MCP, no transport, no interpretation. */
export {
  readArchive,
  ARCHIVE_CONTRACTS,
  ARCHIVE_DOCUMENTS,
  type ArchiveRead,
  type ArchiveDocumentName,
  type ContractCoverage,
  type ContractStatus,
} from "./archive/read.ts";

/**
 * Serve — the tools, and the thin layer that registers them.
 *
 * `capture_page` is deliberately not here. It launches Chromium through Playwright, whose client
 * does not complete its handshake under Bun (ADR 0001), so importing it from this Bun-reachable
 * module would fail at import time and take every consumer with it. The Node entry point
 * (`src/serve/node-tools.ts`) adds it, and `scripts/mcp-server.ts` is what an agent connects to.
 */
export { createServer, SERVER_INFO } from "./serve/mcp.ts";
export { BROWSERLESS_TOOLS, findTool, type ToolDefinition } from "./serve/tools/index.ts";
export {
  inspectArchive,
  type InspectArchiveParams,
  type InspectArchiveResult,
} from "./serve/tools/inspect-archive.ts";
