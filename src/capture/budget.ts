/**
 * §6.10 capture termination budget (plan §6.10): bound the adaptive sweep so an infinite-scroll
 * or polling page cannot extend a quiet window forever, and record why capture stopped so a
 * truncated capture is distinguishable from a complete one.
 *
 * The sweep loop and the post-sweep HAR/DOM checks both call the pure `evaluateBudget` decision.
 * A cap of 0 (or an absent cap) means unbounded. `termination.json` records the outcome, the
 * first reason that fired, the configured budgets, and the observed stats.
 */

export const TERMINATION_SCHEMA_VERSION = 1;
export const TERMINATION_FILE_NAME = "termination.json";

export const QUIET_WINDOW_CHECKPOINTS = 3;

export type TerminationReason = "quiet-window" | "budget-exceeded" | "navigation" | "complete";

export type Budgets = {
  wallClockMs: number;
  maxBytes: number;
  maxNodes: number;
  maxHeight: number;
  maxEvents: number;
};

export type TerminationStats = {
  sweepCheckpoints: number;
  scrolls: number;
  wallClockMs: number;
  bytes: number;
  nodes: number;
  height: number;
};

export type TerminationOutcome = {
  outcome: "complete" | "incomplete";
  reason?: TerminationReason;
};

/** The documented default budget set. A single page should comfortably fit within these. */
export function defaultBudgets(): Budgets {
  return {
    wallClockMs: 30_000,
    maxBytes: 64 * 1024 * 1024,
    maxNodes: 100_000,
    maxHeight: 200_000,
    maxEvents: 20_000,
  };
}

/**
 * Decide whether the sweep should stop. Returns `{ stop: false }` when nothing fired, or
 * `{ stop: true, reason }` with the first reason in precedence order:
 *
 * 1. `navigation` — the document changed mid-sweep (checked by the caller, reported here).
 * 2. `quiet-window` — 3 consecutive empty checkpoints. This is the page settling naturally,
 *    so it maps to a **complete** capture (see `terminationOutcome`).
 * 3. `budget-exceeded` — any of the five caps was crossed. This is a **truncated** capture.
 *
 * A cap of 0 (or absent in the caller's partial) means unbounded and never fires.
 */
export function evaluateBudget(
  budgets: Budgets,
  stats: TerminationStats,
  navigationDetected = false,
): { stop: boolean; reason?: TerminationReason } {
  if (navigationDetected) return { stop: true, reason: "navigation" };
  if (stats.sweepCheckpoints >= QUIET_WINDOW_CHECKPOINTS) {
    return { stop: true, reason: "quiet-window" };
  }
  const exceeded =
    (budgets.wallClockMs > 0 && stats.wallClockMs > budgets.wallClockMs) ||
    (budgets.maxBytes > 0 && stats.bytes > budgets.maxBytes) ||
    (budgets.maxNodes > 0 && stats.nodes > budgets.maxNodes) ||
    (budgets.maxHeight > 0 && stats.height > budgets.maxHeight) ||
    (budgets.maxEvents > 0 && stats.scrolls > budgets.maxEvents);
  if (exceeded) return { stop: true, reason: "budget-exceeded" };
  return { stop: false };
}

/**
 * Map a termination decision to the published outcome. `quiet-window` is a natural end — the
 * page settled — so it is **complete**; `budget-exceeded` and `navigation` are **incomplete**
 * (a truncated capture that must be distinguishable from a complete one, §6.10).
 */
export function terminationOutcome(
  decision: ReturnType<typeof evaluateBudget>,
): TerminationOutcome {
  if (decision.reason === undefined) return { outcome: "complete" };
  if (decision.reason === "quiet-window") return { outcome: "complete", reason: "quiet-window" };
  return { outcome: "incomplete", reason: decision.reason };
}
