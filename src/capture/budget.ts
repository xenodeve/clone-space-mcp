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
  /**
   * HAR entries still outstanding when capture tore the context down (#156): no response, and no
   * recorded failure either. **This is the archive defect** — a response was on its way and
   * capture stopped waiting for it.
   *
   * Counted from the published HAR rather than from an event counter, because the HAR is what
   * replay reads: the same number a reader of the archive can recompute, not an approximation.
   */
  unansweredRequests: number;
  /**
   * HAR entries whose request failed outright (#156) — Playwright records `_failureText` such as
   * `net::ERR_NAME_NOT_RESOLVED`. **Not a capture defect and deliberately not part of the
   * outcome:** the live browser did not get these either, so an archive that records the failure
   * is faithful to the run, and a replay that refuses them reproduces what the page actually saw.
   *
   * Published because it is still archive quality a caller needs. Measured on
   * `https://labs.chaingpt.org/` with flaky DNS on the capturing host: 8 failures in one run,
   * including two GSAP plugins and three hero videos. The page was archived as it loaded, which
   * is not the same as the page the site serves.
   */
  failedRequests: number;
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
 *
 * **Outstanding responses override a natural end** (#156). `reason` says why the *sweep* stopped
 * and stays what it was; `outcome` is a claim about the *archive*, and one whose responses were
 * still arriving when capture tore down is not complete however gracefully the sweep finished.
 *
 * `failedRequests` deliberately does **not** feed this. A request that failed — DNS, ORB, a
 * refused connection — failed for the live browser too, so recording the failure is faithful and
 * calling the archive incomplete for it would mark almost every real capture incomplete forever,
 * which teaches readers to ignore the field. Measured: of 30 responseless entries across four
 * captures of two real sites, 24 carried `_failureText` and only 6 were genuinely outstanding.
 */
export function terminationOutcome(
  decision: ReturnType<typeof evaluateBudget>,
  stats: Pick<TerminationStats, "unansweredRequests">,
): TerminationOutcome {
  const naturalEnd = decision.reason === undefined || decision.reason === "quiet-window";
  const outcome = naturalEnd && stats.unansweredRequests === 0 ? "complete" : "incomplete";
  return decision.reason === undefined ? { outcome } : { outcome, reason: decision.reason };
}

/** How long the post-sweep drain may take before capture stops waiting for it. */
export const DRAIN_DEADLINE_MS = 10_000;

/**
 * Wait for everything to settle, or stop waiting at `deadlineMs`. Resolves `true` when the work
 * settled in time and `false` when the deadline won.
 *
 * §6.10 bounds the sweep in wall-clock, and that bound is the archive's promise about how long a
 * capture takes. The drain runs *after* the sweep and so outside it: one script read that never
 * answers holds a browser open, and through the MCP tool it holds the caller's request open too.
 * A drain outside the budget is a hole in the budget.
 *
 * A rejection counts as settled. These reads are already handled by their caller, so the deadline
 * is about time, not outcome.
 */
export async function settleWithin(
  work: readonly Promise<unknown>[],
  deadlineMs: number,
): Promise<boolean> {
  if (work.length === 0) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(work).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
