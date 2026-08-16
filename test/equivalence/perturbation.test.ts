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
    expect(perturbedFields({ "dom.elements": 2767 }, [{ "dom.elements": 2765 }])).toEqual([
      "dom.elements",
    ]);
  });

  test("says nothing when the hooks changed nothing", () => {
    expect(perturbedFields({ a: 1, b: "x" }, [{ a: 1, b: "x" }])).toEqual([]);
  });

  /**
   * **The plain side is every pass, not the first one.** A delegated review named the scenario: a
   * field reading `1, 2, 1` across three plain drives and `2` under hooks is a value the page
   * produces on its own, and blaming the hooks for it would turn ordinary run-to-run noise into a
   * finding. The gate already knows such a field is unstable; this control must not contradict it.
   */
  test("a hooked value that any plain pass also produced is not a perturbation", () => {
    expect(perturbedFields({ a: 2 }, [{ a: 1 }, { a: 2 }, { a: 1 }])).toEqual([]);
  });

  test("a hooked value no plain pass produced is a perturbation", () => {
    expect(perturbedFields({ a: 3 }, [{ a: 1 }, { a: 2 }, { a: 1 }])).toEqual(["a"]);
  });

  /**
   * The digest publishes some fields **only when the page settled** — `layout.scrollHeight`,
   * `motion.css.settled` and the rest are absent otherwise. So a field appearing under hooks and
   * not without them is the hooks changing whether the page settled, which is a perturbation and
   * one an earlier version of this function missed: it iterated the plain side only.
   *
   * Nothing in the digest is the instrument's own output — the observation summary travels through
   * `drainObservations`, never through these fields — so there is no category of hooked-only field
   * that ought to be excused.
   */
  test("a field only the hooked drive produced is a perturbation", () => {
    expect(perturbedFields({ a: 1, "layout.scrollHeight": 8486 }, [{ a: 1 }])).toEqual([
      "layout.scrollHeight",
    ]);
  });

  test("a field the hooks suppressed is a perturbation", () => {
    expect(perturbedFields({ a: 1 }, [{ a: 1, "motion.gsap": 198 }])).toEqual(["motion.gsap"]);
  });

  test("a field absent from the hooked drive and from some plain pass is not a perturbation", () => {
    // Absence is a reading like any other: if the plain side sometimes omits the field, the hooked
    // side omitting it is a state the page reaches without help.
    expect(perturbedFields({ a: 1 }, [{ a: 1, b: 2 }, { a: 1 }])).toEqual([]);
  });

  test("reports every moved field, sorted, so two runs are comparable", () => {
    expect(perturbedFields({ b: 2, a: 1 }, [{ b: 3, a: 9 }])).toEqual(["a", "b"]);
  });

  /**
   * `Object.is`, for the same reason `classify` uses it: `NaN` must equal itself here or a field
   * that was never measurable reads as something the hooks broke.
   */
  test("NaN against NaN is not a perturbation", () => {
    expect(perturbedFields({ a: Number.NaN }, [{ a: Number.NaN }])).toEqual([]);
  });

  test("no plain passes at all is no measurement, not a clean one", () => {
    // Returning `[]` here would claim the hooks moved nothing when nothing was compared.
    expect(() => perturbedFields({ a: 1 }, [])).toThrow(/pass/);
  });
});
