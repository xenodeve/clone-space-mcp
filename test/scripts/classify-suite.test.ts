import { describe, expect, test } from "bun:test";
import { classifySuiteResult } from "../../scripts/classify-suite.ts";
import { NOT_APPLIED_TOKEN } from "../../scripts/mutation-hook.ts";

const EXPECT = "the test that is supposed to catch this";

/**
 * With the defect applied in memory rather than on disk, a rotted anchor no longer fails before the
 * suite starts — it fails *inside the child*, which looks from here like any other non-zero exit.
 * So the order of these checks is the whole safety property: a corpus that no longer matches must
 * come back as NOT APPLIED, never as CAUGHT, however plausible the child's output looks.
 */
describe("classifySuiteResult", () => {
  test("a failing suite that names the expected test is CAUGHT", () => {
    expect(classifySuiteResult(`some output\n(fail) ${EXPECT}\n`, 1, EXPECT)).toBe("CAUGHT");
  });

  test("a passing suite means the mutation survived", () => {
    expect(classifySuiteResult("all good\n", 0, EXPECT)).toBe("SURVIVED");
  });

  test("a failing suite that names some other test is not a catch", () => {
    expect(classifySuiteResult("(fail) an unrelated test\n", 1, EXPECT)).toBe("CAUGHT_BY_THE_WRONG_TEST");
  });

  test("a rotted anchor is NOT APPLIED, even though the child also failed", () => {
    expect(classifySuiteResult(`${NOT_APPLIED_TOKEN}: find text occurs 0 times\n`, 1, EXPECT)).toBe(
      "NOT_APPLIED",
    );
  });

  /**
   * The case that matters most: the child failed for the anchor, *and* the expected test name
   * happens to appear in the output anyway — because the suite printed its whole plan before
   * dying. Checking `expect` first would report a green-looking CAUGHT for a corpus that no longer
   * applies to the code.
   */
  test("a rotted anchor wins over an expected-test match in the same output", () => {
    expect(
      classifySuiteResult(`(fail) ${EXPECT}\n${NOT_APPLIED_TOKEN}: find text occurs 0 times\n`, 1, EXPECT),
    ).toBe("NOT_APPLIED");
  });
});
