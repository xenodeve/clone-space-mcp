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
