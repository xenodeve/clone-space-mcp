import { describe, expect, test } from "bun:test";
import { classify, coverageOf, type AllowlistEntry } from "../../src/equivalence/classify.ts";

/**
 * Slice 0 of #169 (issue #171). The falsifier, and the rules the plan puts on it.
 *
 * The gate exists because every later slice is a claim that the clone got better, and without a
 * differential verdict those claims can only be ordered by taste. What is tested here is not the
 * comparison — that part is arithmetic — but the four rules that decide whether a verdict means
 * anything: `unobserved` is not agreement, an allowlist entry must carry its reason, the residual
 * is all-or-nothing, and coverage is a vector.
 */

const allow = (over: Partial<AllowlistEntry> = {}): AllowlistEntry => ({
  field: "network.beacon",
  category: 1,
  rationale: "the archive deliberately cannot serve it and no client-visible difference follows",
  ...over,
});

describe("classify", () => {
  test("matching observations on both sides are equal", () => {
    const result = classify({ "motion.css": 12 }, { "motion.css": 12 }, []);
    expect(result.fields).toEqual([{ field: "motion.css", verdict: "equal" }]);
    expect(result.residual).toEqual([]);
    expect(result.verdict).toBe("PASS");
  });

  test("an uncovered difference is the residual, and the verdict is not PASS", () => {
    const result = classify({ "motion.css": 12 }, { "motion.css": 8 }, []);
    expect(result.fields[0]).toEqual({
      field: "motion.css",
      verdict: "different",
      live: 12,
      replay: 8,
    });
    expect(result.residual).toEqual(["motion.css"]);
    expect(result.verdict).toBe("FAIL");
  });

  test("an allowlist entry covers a difference and names the category that covered it", () => {
    const result = classify({ "network.beacon": 7 }, { "network.beacon": 0 }, [allow()]);
    expect(result.fields[0]).toEqual({
      field: "network.beacon",
      verdict: "allowed",
      live: 7,
      replay: 0,
      category: 1,
    });
    expect(result.residual).toEqual([]);
    expect(result.verdict).toBe("PASS");
  });

  /**
   * The rule the whole gate rests on. A page whose 242 click listeners are never fired produces no
   * observation for them on either side, and reading that as agreement is how a scroll-only clone
   * comes to look complete.
   */
  test("a field neither side observed is unobserved, never equal", () => {
    const result = classify({}, {}, []);
    expect(result.fields).toEqual([]);

    const oneSided = classify({ "motion.gsap": 190 }, {}, []);
    expect(oneSided.fields[0]).toEqual({
      field: "motion.gsap",
      verdict: "unobserved",
      live: 190,
      replay: undefined,
    });
  });

  test("unobserved does not enter the residual, and does not let the verdict claim PASS either", () => {
    const result = classify({ "motion.gsap": 190 }, {}, []);
    // It is not a difference — nothing was compared. It is also not agreement, so a caller that
    // reads only `verdict` must not be told the two sides matched.
    expect(result.residual).toEqual([]);
    expect(result.verdict).toBe("INCOMPLETE");
  });

  test("an allowlist entry with no rationale is refused at load rather than silently accepted", () => {
    expect(() => classify({ a: 1 }, { a: 2 }, [allow({ field: "a", rationale: "  " })])).toThrow(
      /rationale/,
    );
  });

  test("an allowlist entry outside the six documented categories is refused", () => {
    expect(() => classify({ a: 1 }, { a: 2 }, [allow({ field: "a", category: 7 as 1 })])).toThrow(
      /category/,
    );
  });

  // "Category 1 must not be allowed wholesale" — measured: www.chaingpt.org cannot serve
  // Cannon_Exterior.hdr, its 3D scene's environment map, so an API-level comparison passes while
  // the scene renders unlit. A matcher that covers every network field is that mistake in code.
  test("an allowlist entry may not match every field", () => {
    expect(() => classify({ a: 1 }, { a: 2 }, [allow({ field: "*" })])).toThrow(/wholesale/);
  });
});

describe("coverageOf", () => {
  test("reports a vector, one entry per dimension", () => {
    expect(coverageOf({ scroll: [4, 4], interaction: [0, 12] })).toEqual({
      scroll: 100,
      interaction: 0,
    });
  });

  test("a dimension nothing was expected on is 100, not a division by zero", () => {
    expect(coverageOf({ canvas_realms: [0, 0] })).toEqual({ canvas_realms: 100 });
  });
});

/**
 * The control that changed the gate's shape (#171).
 *
 * Driving the LIVE page twice and comparing it with itself, on three real sites, put most of the
 * digest in the residual: `dom.elements` differed on all three, `motion.gsap.settled` by 198 to
 * 142, and even ScrollTrigger registrations by 38 to 6. Every `FAIL` the gate had produced was
 * noise. A field that differs when the same page is measured twice cannot be evidence about the
 * clone — and the answer is not an allowlist, which would excuse the clone for something the clone
 * did not do. It is to mark the field unstable, from a measurement, per run.
 */
describe("classify with a stability baseline", () => {
  test("a field that differs against itself is unstable, not different", () => {
    const result = classify({ "motion.gsap": 198 }, { "motion.gsap": 190 }, [], {
      livePasses: [{ "motion.gsap": 198 }, { "motion.gsap": 142 }],
      replayPasses: [],
    });
    expect(result.fields[0]).toEqual({
      field: "motion.gsap",
      verdict: "unstable",
      live: 198,
      replay: 190,
    });
    expect(result.residual).toEqual([]);
    expect(result.unstable).toEqual(["motion.gsap"]);
  });

  test("an unstable field cannot make the verdict PASS on its own", () => {
    const result = classify({ a: 1 }, { a: 2 }, [], { livePasses: [{ a: 1 }, { a: 3 }], replayPasses: [] });
    // Nothing was proven equal, so this is not agreement.
    expect(result.verdict).toBe("INCOMPLETE");
  });

  test("a field stable against itself and differing against replay is still the residual", () => {
    const result = classify({ a: 1 }, { a: 2 }, [], { livePasses: [{ a: 1 }, { a: 1 }], replayPasses: [] });
    expect(result.residual).toEqual(["a"]);
    expect(result.verdict).toBe("FAIL");
  });

  test("with no baseline supplied, nothing is excused as unstable", () => {
    const result = classify({ a: 1 }, { a: 2 }, []);
    expect(result.residual).toEqual(["a"]);
    expect(result.unstable).toEqual([]);
  });

  // An allowlist is a claim about the world; instability is a measurement of this run. Letting an
  // entry declare a field unstable would turn the mechanism back into the judgement it replaced.
  test("instability comes from the baseline, never from an allowlist entry", () => {
    const result = classify({ a: 1 }, { a: 2 }, [
      { field: "a", category: 2, rationale: "time-dependent" },
    ]);
    expect(result.fields[0]!.verdict).toBe("allowed");
    expect(result.unstable).toEqual([]);
  });
});

/**
 * #182. Two baseline passes can agree by luck on a field that settles at one of two values, and the
 * gate then reports it as stable and blames the clone for the difference. Measured: three
 * consecutive gate runs on `labs.chaingpt.org` returned FAIL, PASS and INCOMPLETE, and the FAIL's
 * `unstable` list was empty for fields the INCOMPLETE run called unstable.
 */
describe("a baseline of more than two passes", () => {
  test("catches a field two passes agreed on by luck", () => {
    // Passes 1 and 2 both landed on 52; the third shows the field also settles at 59.
    const baseline = { livePasses: [{ a: 52 }, { a: 52 }, { a: 59 }], replayPasses: [] };
    const result = classify({ a: 52 }, { a: 59 }, [], baseline);
    expect(result.unstable).toEqual(["a"]);
    expect(result.residual).toEqual([]);
  });

  test("still calls a field stable when every pass agrees", () => {
    const baseline = { livePasses: [{ a: 52 }, { a: 52 }, { a: 52 }], replayPasses: [] };
    const result = classify({ a: 52 }, { a: 59 }, [], baseline);
    expect(result.unstable).toEqual([]);
    expect(result.residual).toEqual(["a"]);
  });

  test("needs a field in every pass before it can call it unstable", () => {
    // A field only some passes produced says nothing about stability, and guessing from a subset
    // is how a control starts excusing differences it never measured.
    const baseline = { livePasses: [{ a: 52 }, {}, { a: 59 }], replayPasses: [] };
    expect(classify({ a: 52 }, { a: 59 }, [], baseline).unstable).toEqual([]);
  });
});

/**
 * #182, the part a live-only control could never see. Measured on `labs.chaingpt.org`, three drives
 * each: `layout.scrollHeight` read 8544, 8544, 8544 live and 8486, 8544, 8486 on the clone. The
 * live side is rock steady, so no number of extra live passes catches it, and the difference goes
 * to the residual as the clone's fault.
 */
describe("stability measured on both sides", () => {
  test("catches a field that is steady live and moves on the clone", () => {
    const baseline = {
      livePasses: [{ a: 8544 }, { a: 8544 }, { a: 8544 }],
      replayPasses: [{ a: 8486 }, { a: 8544 }, { a: 8486 }],
    };
    const result = classify({ a: 8544 }, { a: 8486 }, [], baseline);
    expect(result.unstable).toEqual(["a"]);
    expect(result.residual).toEqual([]);
  });

  test("still accuses when both sides are steady and they disagree", () => {
    // The control must not excuse a real difference. Both sides reproduce their own value.
    const baseline = {
      livePasses: [{ a: 1 }, { a: 1 }, { a: 1 }],
      replayPasses: [{ a: 2 }, { a: 2 }, { a: 2 }],
    };
    const result = classify({ a: 1 }, { a: 2 }, [], baseline);
    expect(result.unstable).toEqual([]);
    expect(result.residual).toEqual(["a"]);
  });

  test("never compares a live pass against a replay pass", () => {
    // Pooling the two groups would make every genuine difference look like instability — the
    // control excusing exactly what it exists to detect.
    const baseline = { livePasses: [{ a: 1 }, { a: 1 }], replayPasses: [{ a: 2 }, { a: 2 }] };
    expect(classify({ a: 1 }, { a: 2 }, [], baseline).residual).toEqual(["a"]);
  });
});
