import { describe, expect, test } from "bun:test";
import {
  hasSettled,
  settledSample,
  tailIsConstant,
  SETTLE_REPEATS,
} from "../../src/equivalence/settle.ts";

/**
 * Real series, measured 2026-08-16 on `https://labs.chaingpt.org/` — three live loads and three
 * replays of one archive, 30 samples at 400 ms, recorded by `scripts/digest-series.ts`.
 *
 * The page holds an entry-animation set of 59, those animations finish, and it rests at 52. Only
 * `css` is reproduced here, because it is what moved. That makes these series a test of *which
 * sample* the rule reads and not of *which counters* it compares — the counters get their own
 * cases at the bottom of this file, or a rule that looked at `css` alone would pass everything
 * above.
 */
const CSS_SERIES: Record<string, number[]> = {
  "live 0": [59, 59, 59, 59, 59, 59, 59, 58, 58, 58, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52],
  "live 1": [59, 59, 59, 59, 59, 59, 58, 58, 58, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52],
  "live 2": [59, 59, 59, 59, 59, 56, 58, 58, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52],
  "replay 0": [59, 59, 59, 59, 59, 59, 59, 59, 59, 58, 58, 58, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52],
  "replay 1": [59, 59, 59, 59, 59, 59, 59, 59, 59, 58, 58, 58, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52],
  "replay 2": [59, 59, 59, 59, 59, 59, 59, 59, 59, 58, 58, 58, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52, 52],
};

const asSamples = (css: readonly number[]) =>
  css.map((count) => ({ css: count, waapi: 0, gsap: 0, st: 0 }));

/** What a loop that stops as soon as `repeats` consecutive samples agree would read. */
function stopEarlyAt(css: readonly number[], repeats: number): number {
  const samples = asSamples(css);
  for (let i = 1; i <= samples.length; i += 1) {
    const taken = samples.slice(0, i);
    if (hasSettled(taken, repeats)) return settledSample(taken).css;
  }
  return settledSample(samples).css;
}

describe("stopping at k agreeing samples", () => {
  test("every k below the plateau length reads the plateau, and the ones above it are fitted", () => {
    // This is the whole of #182 in one assertion. The page rests at 52. Every k small enough to
    // stop before the budget ends stops **inside the entry plateau**, which runs 6 to 9 samples:
    const picked = (k: number) => Object.values(CSS_SERIES).map((series) => stopEarlyAt(series, k));

    // k = 2 (the rule before this) through 5: every run stops inside the entry plateau and reads
    // 59, a value the page is not at when it rests. Consistent, and consistently wrong.
    for (const k of [2, 3, 4, 5]) {
      expect(picked(k)).toEqual([59, 59, 59, 59, 59, 59]);
    }

    // k = 6 through 9 is the worst region and the one #182 actually observed: the rule clears the
    // plateau on *some* runs and not others, so the same page reads 59 on one run and 52 on the
    // next. That is the non-reproducible verdict, expressed as an array.
    expect(picked(6)).toEqual([59, 59, 52, 59, 59, 59]);
    expect(picked(8)).toEqual([52, 52, 52, 59, 59, 59]);

    // k = 10 clears these six — and is fitted to them. An earlier measurement of the same page
    // needed 6; this one needs 10. Neither number is a property of anything but the loads observed.
    expect(picked(10)).toEqual([52, 52, 52, 52, 52, 52]);
  });
});

describe("reading the end of the budget", () => {
  test("reads the same value on every one of the six real series", () => {
    const picked = Object.values(CSS_SERIES).map(
      (series) => settledSample(asSamples(series)).css,
    );
    expect(picked).toEqual([52, 52, 52, 52, 52, 52]);
  });

  test("a budget that ends mid-transition is reported not settled", () => {
    // The honest half. A page with an intro longer than the budget cannot be read correctly by
    // any rule; what it must not do is claim it was.
    const truncated = asSamples(CSS_SERIES["replay 0"]!.slice(0, 11));
    expect(hasSettled(truncated)).toBe(false);
    expect(settledSample(truncated).css).toBe(58);
  });

  test("a budget that ends on the resting value is reported settled", () => {
    expect(hasSettled(asSamples(CSS_SERIES["live 0"]!))).toBe(true);
  });

  test("an entry plateau long enough to fill the budget is indistinguishable from a rest", () => {
    // Stated rather than hidden: `hasSettled` cannot tell a plateau from an end, and neither can
    // anything else that only sees the series. The budget is what bounds the error.
    expect(hasSettled(asSamples([59, 59, 59, 59, 59, 59]))).toBe(true);
  });
});

describe("hasSettled", () => {
  test("refuses a repeat count that would make an empty series look settled", () => {
    expect(() => hasSettled([], 0)).toThrow(/at least one repeat/);
    expect(() => hasSettled(asSamples([52]), -1)).toThrow(/at least one repeat/);
  });

  test("needs SETTLE_REPEATS samples before it can say anything", () => {
    expect(hasSettled(asSamples([52, 52]))).toBe(false);
    expect(hasSettled(asSamples(Array.from({ length: SETTLE_REPEATS }, () => 52)))).toBe(true);
  });

  test("is false while the tail is still moving", () => {
    expect(hasSettled(asSamples([52, 52, 52, 52, 58]))).toBe(false);
  });
});

describe("every motion counter, not only css", () => {
  // The measured series vary only in `css`, because that is what moved on that page. A rule that
  // compared css alone would pass all of the assertions above, so each of the other three gets an
  // explicit case: a tail that is constant in css and moving in one of them is not settled.
  const withField = (field: "waapi" | "gsap" | "st", tail: readonly number[]) =>
    tail.map((value) => ({ css: 52, waapi: 0, gsap: 0, st: 0, [field]: value }));

  for (const field of ["waapi", "gsap", "st"] as const) {
    test(`a tail moving in ${field} is not settled`, () => {
      expect(hasSettled(withField(field, [0, 0, 0, 0, 1]))).toBe(false);
      expect(hasSettled(withField(field, [1, 1, 1, 1, 1]))).toBe(true);
    });
  }
});

describe("settledSample", () => {
  test("throws rather than inventing a reading when nothing was sampled", () => {
    expect(() => settledSample([])).toThrow(/no samples/);
  });
});

describe("tailIsConstant", () => {
  /**
   * The after-scroll reading has the same shape of defect as the settle loop and was left with it:
   * the gate takes exactly one sample there. Measured 2026-08-16 on `labs.chaingpt.org`, three runs
   * of live-against-replay, reading `dom.elements` at the moment the gate reads it and then 14 more
   * times at 400 ms:
   *
   *     live    2821  2767 2767 2767 ... (14 identical)
   *     replay  2819  2767 2767 2767 ... (14 identical)
   *
   * The first read differs by two elements on two of three runs. Every read after it agrees. That
   * is the `dom.elements` residual the gate has been reporting as the clone's fault.
   */
  const AFTER_SCROLL = {
    live: [2821, 2767, 2767, 2767, 2767],
    replay: [2819, 2767, 2767, 2767, 2767],
  };

  const asCounts = (elements: readonly number[]) => elements.map((count) => ({ count }));
  const key = (sample: { count: number }) => String(sample.count);

  test("the gate's one-sample read is where the difference is, and the tail is where it is not", () => {
    expect(AFTER_SCROLL.live[0]).not.toBe(AFTER_SCROLL.replay[0]);
    expect(AFTER_SCROLL.live.at(-1)).toBe(AFTER_SCROLL.replay.at(-1));
  });

  test("is false while the reading is still moving and true once it stops", () => {
    expect(tailIsConstant(asCounts(AFTER_SCROLL.live), key, 5)).toBe(false);
    expect(tailIsConstant(asCounts(AFTER_SCROLL.live.slice(1)), key, 4)).toBe(true);
  });

  test("compares the whole projected key, not one field of it", () => {
    const samples = [{ a: 1, b: 1 }, { a: 1, b: 2 }];
    expect(tailIsConstant(samples, (s) => `${s.a}`, 2)).toBe(true);
    expect(tailIsConstant(samples, (s) => `${s.a}|${s.b}`, 2)).toBe(false);
  });

  test("refuses a repeat count that would make an empty series look constant", () => {
    expect(() => tailIsConstant([], key, 0)).toThrow(/at least one repeat/);
  });
});
