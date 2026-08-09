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

function isTargetEntry(value: unknown): value is TargetEntry {
  if (!isRecord(value)) return false;
  if (typeof value.targetId !== "string" || value.targetId.length === 0) return false;
  if (typeof value.type !== "string" || !KNOWN_TYPES.has(value.type)) return false;
  if (typeof value.openedAt !== "number" || !Number.isFinite(value.openedAt)) return false;
  if (value.url !== undefined && typeof value.url !== "string") return false;
  if (value.openerId !== undefined && typeof value.openerId !== "string") return false;
  if (value.closedAt !== undefined) {
    if (typeof value.closedAt !== "number" || !Number.isFinite(value.closedAt)) return false;
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
