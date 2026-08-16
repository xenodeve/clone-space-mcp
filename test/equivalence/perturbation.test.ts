import { describe, expect, test } from "bun:test";
import { perturbedFields } from "../../src/equivalence/perturbation.ts";

/**
 * #171's third drive mode, from the body of the issue rather than its checkboxes:
 *
 * > the harness needs a third mode — **instrumented against uninstrumented on the same side** —
 * > with a perturbation budget.
 *
 * The reason it belongs to slice 0 and not to the instrumentation slice: comparing an instrumented
 * live page against an instrumented replay compares **two pages that both carry hooks**, and
 * nothing in that comparison can say whether the hooks moved the numbers. The live-against-live
 * control already in the gate answers run-to-run noise; this answers a different question, and no
 * amount of the first kind of pass substitutes for it.
 */
describe("perturbedFields", () => {
  test("names a field the hooks moved", () => {
    expect(perturbedFields({ "dom.elements": 2767 }, { "dom.elements": 2765 })).toEqual([
      "dom.elements",
    ]);
  });

  test("says nothing when the hooks changed nothing", () => {
    expect(perturbedFields({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
  });

  /**
   * The instrumented drive produces fields the plain one cannot — the observation summary is the
   * instrument's own output, not a change it made to the page. Counting those as perturbation
   * would make every instrumented run look maximally disturbed and the control useless.
   */
  test("a field only the instrumented drive produces is the instrument's output, not a perturbation", () => {
    expect(perturbedFields({ a: 1, "observed.shaders": 4 }, { a: 1 })).toEqual([]);
  });

  /**
   * The other direction is not symmetric. A field the page produced **without** hooks and stopped
   * producing **with** them is the hooks suppressing something, which is exactly what this control
   * exists to catch.
   */
  test("a field the hooks suppressed is a perturbation", () => {
    expect(perturbedFields({ a: 1 }, { a: 1, "motion.gsap": 198 })).toEqual(["motion.gsap"]);
  });

  test("reports every moved field, sorted, so two runs are comparable", () => {
    expect(perturbedFields({ b: 2, a: 1 }, { b: 3, a: 9 })).toEqual(["a", "b"]);
  });

  /**
   * `Object.is`, for the same reason `classify` uses it: `NaN` must equal itself here or a field
   * that was never measurable reads as something the hooks broke.
   */
  test("NaN against NaN is not a perturbation", () => {
    expect(perturbedFields({ a: Number.NaN }, { a: Number.NaN })).toEqual([]);
  });
});
