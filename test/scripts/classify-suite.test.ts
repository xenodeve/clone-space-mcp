import { describe, expect, test } from "bun:test";
import { classifySuiteResult } from "../../scripts/classify-suite.ts";
import { APPLIED_TOKEN, NOT_APPLIED_TOKEN } from "../../scripts/mutation-hook.ts";

const EXPECT = "the test that is supposed to catch this";
/** Every well-formed run carries this: the hook prints it when it rewrites the module. */
const APPLIED = `${APPLIED_TOKEN}\n`;

/**
 * With the defect applied in memory rather than on disk, a rotted anchor no longer fails before the
 * suite starts — it fails *inside the child*, which looks from here like any other non-zero exit.
 * So the order of these checks is the whole safety property: a corpus that no longer matches must
 * come back as NOT APPLIED, never as CAUGHT, however plausible the child's output looks.
 */
describe("classifySuiteResult", () => {
  test("a failing suite that names the expected test is CAUGHT", () => {
    expect(classifySuiteResult(`${APPLIED}(fail) ${EXPECT}\n`, 1, EXPECT)).toBe("CAUGHT");
  });

  test("a passing suite means the mutation survived", () => {
    expect(classifySuiteResult(`${APPLIED}all good\n`, 0, EXPECT)).toBe("SURVIVED");
  });

  test("a failing suite that names some other test is not a catch", () => {
    expect(classifySuiteResult(`${APPLIED}(fail) an unrelated test\n`, 1, EXPECT)).toBe(
      "CAUGHT_BY_THE_WRONG_TEST",
    );
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
      classifySuiteResult(
        `${APPLIED}(fail) ${EXPECT}\n${NOT_APPLIED_TOKEN}: find text occurs 0 times\n`,
        1,
        EXPECT,
      ),
    ).toBe("NOT_APPLIED");
  });

  /**
   * The half that only exists because the defect moved off disk. Writing it into the file failed
   * before the suite started, whatever the suite imported; a load hook fires only if something
   * loads the file. A corpus entry whose target no test imports would otherwise come back
   * SURVIVED — a plausible-looking verdict on a defect that was never applied.
   */
  test("a suite that never loaded the target is NOT APPLIED, not SURVIVED", () => {
    expect(classifySuiteResult("all good, nothing imported it\n", 0, EXPECT)).toBe("NOT_APPLIED");
  });

  test("and the same when it failed for some unrelated reason", () => {
    expect(classifySuiteResult(`(fail) ${EXPECT}\n`, 1, EXPECT)).toBe("NOT_APPLIED");
  });
});
