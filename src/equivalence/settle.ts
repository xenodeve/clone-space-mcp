/**
 * When the digest reads the page (#182).
 *
 * The gate used to stop sampling at the **first pair of consecutive equal readings** and call that
 * the settled value. Measured on `https://labs.chaingpt.org/`, that rule returns FAIL, PASS and
 * INCOMPLETE on the same unchanged site: the page holds an entry-animation set of 59, those
 * animations finish, and it rests at 52 — so an agreeing pair is a **plateau**, and which plateau
 * the loop lands on depends on sampling phase.
 *
 * Six real series measured 2026-08-16, three live loads and three replays of one archive:
 *
 * | rule | what it read on the six runs |
 * |---|---|
 * | two agreeing samples (before this) | 59 59 59 59 59 59 — and the page rests at 52 |
 * | `SETTLE_REPEATS` agreeing samples | 52 52 52 52 52 52 |
 *
 * **`SETTLE_REPEATS` is a bet, and this file says so rather than presenting it as a fix.** Any
 * count is a bet that no plateau lasts that long, and #182's objection to a fitted constant stands.
 * Three things make this bet different from the one it replaces: it was measured instead of
 * assumed; the sampling budget bounds it; and when the budget ends without the count agreeing,
 * `hasSettled` returns **false** so the caller can report the field as unobserved rather than
 * comparing a reading it knows is mid-transition. The previous rule had no such report.
 *
 * **What this deliberately does not address.** The same measurement showed `layout.scrollHeight`
 * and `dom.elements` varying between *replays of one archive* while constant across all 30 samples
 * of each run — 8544 on one replay and 8486 on two others, from the first sample to the last. That
 * is not a sampling phase problem and no clock can fix it; it is the clone landing in one of two
 * layout states. Tracked separately.
 */

/** The part of a sample that decides whether the page is still moving. */
export interface SettleSample {
  css: number;
  waapi: number;
  gsap: number;
  st: number;
}

/**
 * How many consecutive agreeing samples end the wait.
 *
 * Five, because the longest entry plateau in the six measured series ran three samples past its
 * last change and the transition itself took three; two — the previous value — is inside every one
 * of them.
 */
export const SETTLE_REPEATS = 5;

/**
 * Have the last `repeats` samples all projected to the same key? False while fewer than `repeats`
 * samples exist, so a run that ends early is never reported as settled on the strength of having
 * barely started.
 *
 * The projection is explicit because **the same defect exists at more than one reading**. The
 * settle loop compares motion counts; the reading taken after the scroll pass compares element and
 * node counts, and the gate took exactly one sample there. Measured on `labs.chaingpt.org`, that
 * one sample read `dom.elements` as 2821 live against 2819 on the clone, while every reading after
 * it agreed at 2767 — the residual the gate had been reporting as the clone's fault.
 */
export function tailIsConstant<T>(
  samples: readonly T[],
  key: (sample: T) => string,
  repeats: number = SETTLE_REPEATS,
): boolean {
  // A non-positive count would make `slice(-0)` the whole array and report an empty series as
  // constant — true of nothing, which is the one answer this must never give.
  if (repeats < 1) throw new Error("equivalence: tailIsConstant needs at least one repeat");
  if (samples.length < repeats) return false;
  const tail = samples.slice(-repeats);
  const first = key(tail[0]!);
  return tail.every((sample) => key(sample) === first);
}

const motionKey = (sample: SettleSample): string =>
  `${sample.css}|${sample.waapi}|${sample.gsap}|${sample.st}`;

/** `tailIsConstant` over the motion counts — the reading the settle loop takes. */
export function hasSettled<T extends SettleSample>(
  samples: readonly T[],
  repeats: number = SETTLE_REPEATS,
): boolean {
  return tailIsConstant(samples, motionKey, repeats);
}

/**
 * The sample the digest reads: the **last one taken**.
 *
 * The loop does not stop early, so this is always the end of the budget. Unconstrained in its
 * element type because both readings the gate takes use it — the motion counts and the post-scroll
 * counts. It is a separate function from the constancy checks because they answer different
 * questions — *what did we read* and *was the
 * page still moving when we read it* — and the caller publishes the first only when the second
 * says yes.
 */
export function settledSample<T>(samples: readonly T[]): T {
  const last = samples[samples.length - 1];
  if (last === undefined) throw new Error("equivalence: no samples were taken");
  return last;
}
