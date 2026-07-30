import { fingerprintKey, type ElementFingerprint } from "./fingerprint.ts";

export type { ElementFingerprint };

/** Bumped only when the fingerprint shape changes in a way that invalidates old archives. */
export const IDENTITY_SCHEMA_VERSION = 1;

export interface IdentitySnapshot {
  schemaVersion: typeof IDENTITY_SCHEMA_VERSION;
  /** Optional; present in archives, absent in tests. */
  capturedAt?: string;
  elements: ElementFingerprint[];
}

export interface Match {
  captureId: string;
  replayId: string;
}

export type UnresolvedReason =
  /** Replay produced nothing that could be this element. */
  | "missing"
  /** Replay produced more than one element that this could equally be. */
  | "ambiguous";

export interface Unresolved {
  captureId: string;
  reason: UnresolvedReason;
  /** The replay ids that tied. Empty for `missing`. Kept so a later pass can adjudicate. */
  candidates: string[];
}

export interface ReconcileResult {
  matched: Match[];
  unresolved: Unresolved[];
  /** Replay elements no capture element claimed — a fidelity signal, not noise. */
  replayOnly: string[];
}

/**
 * Depth of an element, so parents are always resolved before their children.
 *
 * A snapshot from a preorder walk already has that order, but relying on it would make the
 * reconciler silently wrong the day a snapshot is merged, filtered, or re-serialised.
 * Broken and cyclic parent chains resolve to a finite depth rather than hanging.
 */
function depthOf(el: ElementFingerprint, byId: Map<string, ElementFingerprint>): number {
  let depth = 0;
  let seen = new Set<string>([el.id]);
  let current = el.parentId;

  while (current !== null && !seen.has(current)) {
    const parent = byId.get(current);
    if (!parent) break;
    seen.add(current);
    depth++;
    current = parent.parentId;
  }
  return depth;
}

/**
 * Decides which replay element is which capture element.
 *
 * The design constraint that shapes everything here: **an element that cannot be identified
 * is reported, never guessed.** A reconciler that always produces an answer produces a wrong
 * one for the delete-and-reinsert case, and a wrong answer becomes mis-attributed animation
 * data several phases downstream with nothing left to signal it. `identity-unresolved` is
 * the feature, not the failure.
 *
 * Top-down: match a parent, then use that match to narrow its children's candidates. This is
 * what lets three visually identical `<li>` resolve, and what lets two elements with the same
 * shape under different parents resolve without depending on emission order.
 */
export function reconcile(capture: IdentitySnapshot, replay: IdentitySnapshot): ReconcileResult {
  if (capture.schemaVersion !== replay.schemaVersion) {
    throw new Error(
      `identity: refusing to reconcile across schema version ${capture.schemaVersion} and ${replay.schemaVersion}. ` +
        `Re-capture with the current injector rather than comparing incompatible fingerprints.`,
    );
  }

  const replayById = new Map(replay.elements.map((e) => [e.id, e]));
  const replayByKey = new Map<string, ElementFingerprint[]>();
  for (const e of replay.elements) {
    const key = fingerprintKey(e);
    const bucket = replayByKey.get(key);
    if (bucket) bucket.push(e);
    else replayByKey.set(key, [e]);
  }

  const captureById = new Map(capture.elements.map((e) => [e.id, e]));
  const ordered = [...capture.elements].sort(
    (a, b) => depthOf(a, captureById) - depthOf(b, captureById),
  );

  const matchByCaptureId = new Map<string, string>();
  const unresolvedByCaptureId = new Map<string, Unresolved>();
  const claimed = new Set<string>();

  for (const el of ordered) {
    const pool = (replayByKey.get(fingerprintKey(el)) ?? []).filter((c) => !claimed.has(c.id));

    // Narrow by parentage — but only when the parent itself resolved. An unresolved parent
    // must not be allowed to force a child's answer; that is how one uncertainty becomes a
    // chain of confident wrong ones.
    const resolvedParent = el.parentId === null ? null : matchByCaptureId.get(el.parentId);
    const candidates =
      resolvedParent === undefined
        ? pool
        : pool.filter((c) => c.parentId === resolvedParent);

    if (candidates.length === 1) {
      const winner = candidates[0]!;
      matchByCaptureId.set(el.id, winner.id);
      claimed.add(winner.id);
    } else if (candidates.length === 0) {
      unresolvedByCaptureId.set(el.id, { captureId: el.id, reason: "missing", candidates: [] });
    } else {
      unresolvedByCaptureId.set(el.id, {
        captureId: el.id,
        reason: "ambiguous",
        candidates: candidates.map((c) => c.id),
      });
    }
  }

  // Emitted in the caller's original order rather than the internal processing order, so the
  // output shape does not change if the algorithm's traversal ever does.
  const matched: Match[] = [];
  const unresolved: Unresolved[] = [];
  for (const el of capture.elements) {
    const replayId = matchByCaptureId.get(el.id);
    if (replayId !== undefined) matched.push({ captureId: el.id, replayId });
    const miss = unresolvedByCaptureId.get(el.id);
    if (miss) unresolved.push(miss);
  }

  const replayOnly = [...replayById.keys()].filter((id) => !claimed.has(id));

  return { matched, unresolved, replayOnly };
}
