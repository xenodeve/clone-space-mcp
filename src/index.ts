/**
 * clone-space — archive a live web page so it replays offline with real motion,
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
