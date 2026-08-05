import { describe, expect, test } from "bun:test";
import { MUTATIONS } from "../../scripts/mutations.ts";
import { parseDropCount, parseMode, resolveMeasurableMutation } from "../../scripts/metamorphic-cli.ts";

const N = 400;

/**
 * The child process reports its count over stdout, so every way that channel can carry
 * something other than a count is a way to publish a fabricated measurement.
 */
describe("parseDropCount", () => {
  test("accepts a plain integer inside the case range", () => {
    expect(parseDropCount("179\n", N)).toBe(179);
  });

  /**
   * `Number("")` is 0 and `Number.isInteger(0)` is true, so a child that exits 0 having printed
   * nothing would otherwise be published as `defect restored: 0/400` — a clean-looking result
   * meaning "the check saw nothing", produced by a run that measured nothing.
   */
  test("refuses empty output rather than reading it as zero", () => {
    expect(() => parseDropCount("", N)).toThrow(/no drop count/);
    expect(() => parseDropCount("   \n", N)).toThrow(/no drop count/);
  });

  test("refuses anything that is not a bare non-negative integer", () => {
    expect(() => parseDropCount("179 cases\n", N)).toThrow(/no drop count/);
    expect(() => parseDropCount("-1\n", N)).toThrow(/no drop count/);
    expect(() => parseDropCount("17.9\n", N)).toThrow(/no drop count/);
  });

  test("refuses a count larger than the number of cases", () => {
    expect(() => parseDropCount(`${N + 1}\n`, N)).toThrow(/out of range/);
  });
});

/**
 * The harness only exercises `src/identity/`. Pointed at any of the capture-side entries it
 * would faithfully mutate a file the measurement never reads, and report the two counts as
 * equal — which reads exactly like evidence that the metric cannot see a real defect.
 */
describe("resolveMeasurableMutation", () => {
  test("resolves a mutation this harness can actually measure", () => {
    expect(resolveMeasurableMutation(MUTATIONS, "fingerprint-key-gates-on-ordinal-and-text").file).toBe(
      "src/identity/fingerprint.ts",
    );
  });

  test("refuses an id the corpus does not carry", () => {
    expect(() => resolveMeasurableMutation(MUTATIONS, "no-such-id")).toThrow(/unknown mutation id/);
  });

  test("refuses a corpus entry outside the code this harness measures", () => {
    expect(() => resolveMeasurableMutation(MUTATIONS, "publish-validation-unwired")).toThrow(
      /only exercises src\/identity/,
    );
  });
});

/**
 * Both modes read `process.argv` directly, so a malformed invocation must be refused rather
 * than resolved to whichever check happens to run first.
 */
describe("parseMode", () => {
  test("plain invocation reports the baseline", () => {
    expect(parseMode(["bun", "metamorphic.ts"])).toEqual({ kind: "report" });
  });

  test("--emit-count alone is the machine-readable child mode", () => {
    expect(parseMode(["bun", "metamorphic.ts", "--emit-count"])).toEqual({ kind: "emit-count" });
  });

  test("--against takes the id after it", () => {
    expect(parseMode(["bun", "metamorphic.ts", "--against", "some-id"])).toEqual({
      kind: "against",
      mutationId: "some-id",
    });
  });

  test("refuses --against with no id instead of silently doing something else", () => {
    expect(() => parseMode(["bun", "metamorphic.ts", "--against"])).toThrow(/needs a mutation id/);
    expect(() => parseMode(["bun", "metamorphic.ts", "--against", "--emit-count"])).toThrow(
      /needs a mutation id/,
    );
  });

  test("refuses both modes at once rather than letting one win by precedence", () => {
    expect(() => parseMode(["bun", "metamorphic.ts", "--emit-count", "--against", "x"])).toThrow(
      /cannot be combined/,
    );
  });
});
