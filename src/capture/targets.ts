/**
 * §6.9 browser-level target inventory (PRD #112). Records which targets existed during capture
 * (OOPIFs, popups, workers, worklets), when they attached/detached, and how they relate. This is
 * a supplemental inventory — the primary single-document evidence layout is unchanged.
 *
 * This module is the pure schema/assembly layer only; the browser-level CDP session wiring is
 * S2 (#117).
 */

export const TARGETS_SCHEMA_VERSION = 1;

export type TargetType =
  | "page"
  | "iframe"
  | "worker"
  | "service_worker"
  | "shared_worker"
  | "worklet"
  | "other";

export type TargetEntry = {
  targetId: string;
  type: TargetType;
  url?: string;
  openedAt: number;
  closedAt?: number;
  openerId?: string;
};

export type TargetsV1 = {
  schemaVersion: 1;
  targets: TargetEntry[];
};

/** A CDP `Target.targetCreated` / `Target.getTargets` payload, minimally typed. */
export type CdpTargetPayload = {
  targetId?: unknown;
  /** Which browser context the target belongs to. Absent on a fake or an older CDP build. */
  browserContextId?: unknown;
  type?: unknown;
  url?: unknown;
  openerId?: unknown;
};

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "page",
  "iframe",
  "worker",
  "service_worker",
  "shared_worker",
  "worklet",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Does this target belong to the run doing the capturing?
 *
 * `Target.setDiscoverTargets` is **browser-wide**: a second capture sharing the browser reports its
 * targets to this session too, and an archive would then describe a page it never visited. The run
 * learns its own context by asking its page session for `Target.getTargetInfo`, which answers with
 * a `browserContextId` — verified against a real Chromium before this was written.
 *
 * Unknown on either side means keep. Filtering on a context nobody reported would empty the
 * inventory over a missing capability, and §6.9 evidence is supplemental: a fake browser, or a CDP
 * build that does not answer, must leave capture working rather than silently blank.
 */
export function belongsToRun(info: CdpTargetPayload, runContextId: string | undefined): boolean {
  if (runContextId === undefined) return true;
  if (typeof info.browserContextId !== "string") return true;
  return info.browserContextId === runContextId;
}

/** Map a CDP target type to the canonical set; anything unknown falls to "other". */
export function normalizeType(raw: unknown): TargetType {
  if (typeof raw === "string" && KNOWN_TYPES.has(raw)) return raw as TargetType;
  return "other";
}

/**
 * Build a target entry from a CDP `targetCreated` payload. Throws on a missing/non-string
 * targetId or a non-finite openedAt.
 */
export function targetEntryFromCreated(payload: CdpTargetPayload, openedAt: number): TargetEntry {
  if (typeof payload.targetId !== "string" || payload.targetId.length === 0) {
    throw new Error("targets: missing or non-string targetId");
  }
  if (typeof openedAt !== "number" || !Number.isFinite(openedAt)) {
    throw new Error("targets: non-finite openedAt");
  }
  const entry: TargetEntry = {
    targetId: payload.targetId,
    type: normalizeType(payload.type),
    openedAt,
  };
  if (typeof payload.url === "string" && payload.url.length > 0) {
    entry.url = payload.url;
  }
  if (typeof payload.openerId === "string" && payload.openerId.length > 0) {
    entry.openerId = payload.openerId;
  }
  return entry;
}

/**
 * Set `closedAt` on a target. Throws on an unknown target or `closedAt < openedAt`. Returns a
 * new array; the input is never mutated.
 */
export function markClosed(entries: TargetEntry[], targetId: string, closedAt: number): TargetEntry[] {
  const existing = entries.find((entry) => entry.targetId === targetId);
  if (existing === undefined) {
    throw new Error(`targets: unknown target ${targetId}`);
  }
  if (closedAt < existing.openedAt) {
    throw new Error(`targets: closedAt ${closedAt} before openedAt ${existing.openedAt}`);
  }
  return entries.map((entry) =>
    entry.targetId === targetId ? { ...entry, closedAt } : entry,
  );
}

/**
 * Append a discovered target, from either the event stream or a snapshot.
 *
 * Two rules, and both exist because `validateTargets` refuses the document rather than dropping
 * the bad part — a refusal aborts the whole capture over evidence §6.9 treats as supplemental.
 *
 * - A target already recorded is left alone; a repeated announcement is not a second target.
 * - `openerId` is asserted only when this run already recorded the opener. An opener that closed
 *   before discovery was switched on is never announced and is absent from the snapshot, so the
 *   reference would dangle. The target existed, which is real evidence; the relationship is not
 *   something this run can vouch for.
 *
 * Returns a new array; the input is never mutated.
 */
export function appendDiscovered(
  entries: TargetEntry[],
  info: CdpTargetPayload,
  openedAt: number,
): TargetEntry[] {
  if (entries.some((entry) => entry.targetId === info.targetId)) return entries;
  const openerRecorded =
    info.openerId !== undefined && entries.some((entry) => entry.targetId === info.openerId);
  return [
    ...entries,
    targetEntryFromCreated(openerRecorded ? info : { ...info, openerId: undefined }, openedAt),
  ];
}

/**
 * Reconcile the event-built inventory against a `Target.getTargets` snapshot taken at the
 * observation boundary. The events are a filter on pushes; the snapshot is a pull at a known
 * instant, and each sees what the other cannot.
 *
 * - A snapshot target the run never recorded is appended, under `appendDiscovered`'s rules. It
 *   existed before discovery was enabled, or its `targetCreated` never arrived.
 * - A recorded target the snapshot does not list is *known* closed, whether or not its
 *   `targetDestroyed` was ever delivered. This is what makes the boundary exact: the listeners can
 *   only filter on delivery time, and a close the page caused just before the boundary can arrive
 *   after it.
 *
 * `drainable` is the set of target ids the run had recorded **before the snapshot was requested**,
 * and only those may be closed by absence. Enumeration is not atomic: Chromium builds the list,
 * then the response travels back, and a target opened in that window is announced by an event yet
 * legitimately missing from the list. Draining it would stamp a close that never happened.
 *
 * Returns a new array; the input is never mutated.
 */
export function reconcileWithSnapshot(
  entries: TargetEntry[],
  snapshot: readonly CdpTargetPayload[],
  observedAt: number,
  drainable: ReadonlySet<string>,
): TargetEntry[] {
  let result = entries;
  // Opener-first, not snapshot order. `Target.getTargets` promises no ordering, and a snapshot
  // that happens to list a child before its parent would lose the relationship under a single
  // forward pass — `appendDiscovered` can only assert an opener this run has already recorded.
  // Passing until nothing more can be placed keeps every edge the snapshot actually contains.
  let pending = [...snapshot];
  const inSnapshot = new Set(snapshot.map((info) => info.targetId));
  let placedSomething = true;
  while (pending.length > 0 && placedSomething) {
    placedSomething = false;
    const deferred: CdpTargetPayload[] = [];
    for (const info of pending) {
      const opener = info.openerId;
      const waitingOnSnapshotOpener =
        typeof opener === "string" &&
        inSnapshot.has(opener) &&
        !result.some((entry) => entry.targetId === opener);
      if (waitingOnSnapshotOpener) {
        deferred.push(info);
        continue;
      }
      result = appendDiscovered(result, info, observedAt);
      placedSomething = true;
    }
    pending = deferred;
  }
  // Whatever is left is a cycle the browser reported; append it and let `appendDiscovered` drop
  // the reference it cannot vouch for, rather than looping forever over it.
  for (const info of pending) {
    result = appendDiscovered(result, info, observedAt);
  }

  const live = new Set(snapshot.map((info) => info.targetId));
  const goneIds = result
    .filter(
      (entry) =>
        entry.closedAt === undefined && drainable.has(entry.targetId) && !live.has(entry.targetId),
    )
    .map((entry) => entry.targetId);
  for (const targetId of goneIds) {
    result = markClosed(result, targetId, observedAt);
  }
  return result;
}

/**
 * What a stored entry may carry, which is not the same set `normalizeType` recognises: everything
 * it does not recognise becomes "other", so refusing "other" here would refuse documents this
 * module produced — Chromium's own `browser` target among them.
 */
const STORED_TYPES: ReadonlySet<string> = new Set([...KNOWN_TYPES, "other"]);

function isTargetEntry(value: unknown): value is TargetEntry {
  if (!isRecord(value)) return false;
  if (typeof value.targetId !== "string" || value.targetId.length === 0) return false;
  if (typeof value.type !== "string" || !STORED_TYPES.has(value.type)) return false;
  // Capture-relative, so a negative value cannot have come from a run.
  if (typeof value.openedAt !== "number" || !Number.isFinite(value.openedAt) || value.openedAt < 0) {
    return false;
  }
  if (value.url !== undefined && typeof value.url !== "string") return false;
  if (value.openerId !== undefined && typeof value.openerId !== "string") return false;
  if (value.closedAt !== undefined) {
    if (typeof value.closedAt !== "number" || !Number.isFinite(value.closedAt)) return false;
    if (value.closedAt < 0) return false;
    if (value.closedAt < value.openedAt) return false;
  }
  return true;
}

/** Validate a target inventory: schema, array shape, per-entry well-formedness, unique ids, and
 * that every openerId names an earlier target. */
export function validateTargets(doc: unknown): { ok: true } | { ok: false } {
  const inventory = isRecord(doc) ? doc : {};
  if (inventory.schemaVersion !== TARGETS_SCHEMA_VERSION) return { ok: false };
  if (!Array.isArray(inventory.targets)) return { ok: false };
  if (!inventory.targets.every(isTargetEntry)) return { ok: false };

  const seen = new Set<string>();
  const targets = inventory.targets as TargetEntry[];
  for (const entry of targets) {
    if (seen.has(entry.targetId)) return { ok: false };
    seen.add(entry.targetId);
  }
  // A dangling openerId is a silent reference loss; the opener must be an earlier entry (CDP
  // emits the opener before the opened target).
  for (let i = 0; i < targets.length; i += 1) {
    const openerId = targets[i]!.openerId;
    if (openerId === undefined) continue;
    const openerIndex = targets.findIndex((entry) => entry.targetId === openerId);
    if (openerIndex === -1 || openerIndex >= i) return { ok: false };
  }
  return { ok: true };
}
