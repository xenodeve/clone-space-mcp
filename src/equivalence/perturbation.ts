/**
 * The observation layer's own control (#171): **does instrumenting the page change what the page
 * does?**
 *
 * The gate already drives the live page more than once to find fields that disagree with
 * themselves. That control answers run-to-run noise. It cannot answer this one, and #171 says why
 * in its own words:
 *
 * > Live-instrumented against replay-instrumented compares two pages that **both carry hooks**, so
 * > the harness needs a third mode — instrumented against uninstrumented on the same side — with a
 * > perturbation budget.
 *
 * A hook that changes a number is not a difference between live and replay; it is the instrument
 * writing into its own measurement. No number of extra same-mode passes finds it, for exactly the
 * reason no number of extra *live* passes finds a field that only moves on the replay side.
 *
 * **The budget is a set, not a tolerance.** A numeric slack would need a unit per field, and the
 * digest is a flat map of counts, strings and booleans with no shared scale — picking a tolerance
 * for each would be the judgement this module exists to replace. A field the hooks moved carries
 * no signal in an instrumented comparison at all, which is the same conclusion `unstable` reaches
 * about a field that will not hold still, and it is reached the same way: by measuring.
 */

import type { Digest } from "./classify.ts";

/**
 * Fields the hooks moved, driving one side twice — `withHooks` and `without` — with everything else
 * held the same.
 *
 * **The two directions are deliberately not symmetric.**
 *
 * A field only `withHooks` produced is the **instrument's own output** — the observation summary
 * exists because the hooks exist, and counting it would make every instrumented run look maximally
 * disturbed and this control useless.
 *
 * A field `without` produced and `withHooks` did not is a **perturbation**: the hooks suppressed
 * something the page did on its own, which is precisely what this exists to catch.
 */
export function perturbedFields(withHooks: Digest, without: Digest): string[] {
  const moved: string[] = [];
  for (const field of Object.keys(without).sort()) {
    if (!Object.hasOwn(withHooks, field)) {
      moved.push(field);
      continue;
    }
    // `Object.is` rather than `===`, for the same reason `classify` uses it: `NaN` has to equal
    // itself, or a field that was never measurable reads as something the hooks broke.
    if (!Object.is(withHooks[field], without[field])) moved.push(field);
  }
  return moved;
}
