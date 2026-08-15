import { describe, expect, test } from "bun:test";
import {
  defaultBudgets,
  settleWithin,
  evaluateBudget,
  terminationOutcome,
  TERMINATION_SCHEMA_VERSION,
  type Budgets,
  type TerminationStats,
} from "../../src/capture/budget.ts";

const DEFAULTS = defaultBudgets();

describe("defaultBudgets", () => {
  test("returns a documented set with no zero caps", () => {
    expect(DEFAULTS.wallClockMs).toBeGreaterThan(0);
    expect(DEFAULTS.maxBytes).toBeGreaterThan(0);
    expect(DEFAULTS.maxNodes).toBeGreaterThan(0);
    expect(DEFAULTS.maxHeight).toBeGreaterThan(0);
    expect(DEFAULTS.maxEvents).toBeGreaterThan(0);
  });
});

describe("evaluateBudget", () => {
  const baseStats: TerminationStats = {
    sweepCheckpoints: 0,
    scrolls: 0,
    wallClockMs: 0,
    bytes: 0,
    nodes: 0,
    height: 0,
    unansweredRequests: 0,
    failedRequests: 0,
    networkDrainSettled: true,
  };

  test("does not stop when nothing is exceeded", () => {
    const result = evaluateBudget(DEFAULTS, baseStats);
    expect(result.stop).toBe(false);
  });

  test("quiet-window fires when sweepCheckpoints reaches the cap and nothing else", () => {
    const result = evaluateBudget(DEFAULTS, { ...baseStats, sweepCheckpoints: 3 });
    expect(result.stop).toBe(true);
    expect(result.reason).toBe("quiet-window");
  });

  test("wall-clock budget fires with reason budget-exceeded", () => {
    const result = evaluateBudget({ ...DEFAULTS, wallClockMs: 100 }, { ...baseStats, wallClockMs: 101 });
    expect(result.stop).toBe(true);
    expect(result.reason).toBe("budget-exceeded");
  });

  test("byte budget fires when the HAR exceeds maxBytes", () => {
    const result = evaluateBudget({ ...DEFAULTS, maxBytes: 1000 }, { ...baseStats, bytes: 1001 });
    expect(result.stop).toBe(true);
    expect(result.reason).toBe("budget-exceeded");
  });

  test("node budget fires when the DOM exceeds maxNodes", () => {
    const result = evaluateBudget({ ...DEFAULTS, maxNodes: 5000 }, { ...baseStats, nodes: 5001 });
    expect(result.stop).toBe(true);
    expect(result.reason).toBe("budget-exceeded");
  });

  test("height budget fires when the document exceeds maxHeight", () => {
    const result = evaluateBudget({ ...DEFAULTS, maxHeight: 10000 }, { ...baseStats, height: 10001 });
    expect(result.stop).toBe(true);
    expect(result.reason).toBe("budget-exceeded");
  });

  test("event budget fires when events exceed maxEvents", () => {
    const result = evaluateBudget({ ...DEFAULTS, maxEvents: 1000 }, { ...baseStats, scrolls: 1001 });
    expect(result.stop).toBe(true);
    expect(result.reason).toBe("budget-exceeded");
  });

  test("reason precedence: first exceeded cap wins, in documented order", () => {
    // Quiet-window is checked first; a quiet window with an exceeded budget reports quiet-window.
    const result = evaluateBudget(
      { ...DEFAULTS, wallClockMs: 100 },
      { ...baseStats, sweepCheckpoints: 3, wallClockMs: 9999 },
    );
    expect(result.reason).toBe("quiet-window");
  });

  test("a zero or missing budget is treated as unbounded (cap never fires)", () => {
    const unbounded: Budgets = { ...DEFAULTS, wallClockMs: 0, maxBytes: 0 };
    const result = evaluateBudget(unbounded, { ...baseStats, wallClockMs: 1e9, bytes: 1e9 });
    expect(result.stop).toBe(false);
  });

  test("exports the schema version", () => {
    expect(TERMINATION_SCHEMA_VERSION).toBe(1);
  });
});

describe("terminationOutcome", () => {
  const baseStats: TerminationStats = {
    sweepCheckpoints: 0,
    scrolls: 0,
    wallClockMs: 0,
    bytes: 0,
    nodes: 0,
    height: 0,
    unansweredRequests: 0,
    failedRequests: 0,
    networkDrainSettled: true,
  };

  test("quiet-window maps to complete (the page settled naturally)", () => {
    const decision = evaluateBudget(DEFAULTS, { ...baseStats, sweepCheckpoints: 3 });
    expect(terminationOutcome(decision, baseStats)).toEqual({ outcome: "complete", reason: "quiet-window" });
  });

  test("budget-exceeded maps to incomplete (a truncated capture)", () => {
    const decision = evaluateBudget({ ...DEFAULTS, wallClockMs: 100 }, { ...baseStats, wallClockMs: 101 });
    expect(terminationOutcome(decision, baseStats)).toEqual({ outcome: "incomplete", reason: "budget-exceeded" });
  });

  test("navigation maps to incomplete", () => {
    const decision = evaluateBudget(DEFAULTS, baseStats, true);
    expect(terminationOutcome(decision, baseStats)).toEqual({ outcome: "incomplete", reason: "navigation" });
  });

  test("no stop maps to complete with no reason", () => {
    const decision = evaluateBudget(DEFAULTS, baseStats);
    expect(terminationOutcome(decision, baseStats)).toEqual({ outcome: "complete" });
  });

  // #156. `reason` answers why the sweep stopped and stays `quiet-window`; `outcome` is a claim
  // about the archive, and one missing a response the page asked for is not a complete archive.
  test("an unanswered request makes a natural end incomplete, keeping its reason", () => {
    const stats = { ...baseStats, sweepCheckpoints: 3, unansweredRequests: 1 };
    const decision = evaluateBudget(DEFAULTS, stats);
    expect(terminationOutcome(decision, stats)).toEqual({
      outcome: "incomplete",
      reason: "quiet-window",
    });
  });

  test("an unanswered request makes an unstopped run incomplete too", () => {
    const stats = { ...baseStats, unansweredRequests: 2 };
    expect(terminationOutcome(evaluateBudget(DEFAULTS, stats), stats)).toEqual({
      outcome: "incomplete",
    });
  });

  // #156. A request that failed — DNS, ORB, a refused connection — failed for the live browser
  // too, so the archive is faithful for recording it. Measured across four captures of two real
  // sites: 24 of 30 responseless entries were failures. Feeding those into the outcome would mark
  // nearly every real capture incomplete forever, which teaches a reader to ignore the field.
  test("a failed request does not make the capture incomplete", () => {
    const stats = { ...baseStats, sweepCheckpoints: 3, failedRequests: 8 };
    expect(terminationOutcome(evaluateBudget(DEFAULTS, stats), stats)).toEqual({
      outcome: "complete",
      reason: "quiet-window",
    });
  });
});

describe("settleWithin", () => {
  test("returns true once everything settles", async () => {
    expect(await settleWithin([Promise.resolve(), Promise.resolve()], 1000)).toBe(true);
  });

  test("counts a rejection as settled — the deadline is about time, not outcome", async () => {
    expect(await settleWithin([Promise.reject(new Error("x")).catch(() => {})], 1000)).toBe(true);
  });

  test("stops waiting on work that outlasts the deadline", async () => {
    // Deliberately a *late* promise rather than one that never settles: a never-settling promise
    // left pending at the end of a test hangs the runner, which is how the first attempt at this
    // was reverted. Late is enough to prove the deadline won.
    const late = new Promise<void>((resolve) => setTimeout(resolve, 300));
    const started = Date.now();

    expect(await settleWithin([late], 20)).toBe(false);
    expect(Date.now() - started).toBeLessThan(250);

    await late;
  });
});
