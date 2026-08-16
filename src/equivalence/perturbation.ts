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

/** A reading of one field in one pass: the value, or the fact that the pass did not produce it. */
type Reading = { readonly present: false } | { readonly present: true; readonly value: unknown };

function readingOf(digest: Digest, field: string): Reading {
  return Object.hasOwn(digest, field) ? { present: true, value: digest[field] } : { present: false };
}

function sameReading(a: Reading, b: Reading): boolean {
  if (!a.present || !b.present) return a.present === b.present;
  // `Object.is` rather than `===`, for the same reason `classify` uses it: `NaN` has to equal
  // itself, or a field that was never measurable reads as something the hooks broke.
  return Object.is(a.value, b.value);
}

/**
 * Fields the hooks moved: driven once with the observation layer installed, against **every** plain
 * pass of the same side, with everything else held the same.
 *
 * **Every plain pass, not the first one.** A delegated review named the case: a field reading
 * `1, 2, 1` across three plain drives and `2` under hooks is a value the page produces unaided, and
 * blaming the hooks for it would turn ordinary run-to-run noise into a finding — while the gate's
 * own stability control was simultaneously calling that field unstable. A field is perturbed only
 * when the hooked reading matches **none** of the plain ones.
 *
 * **Absence is a reading.** The digest publishes several fields only when the page settled, so a
 * field appearing under hooks and never without them is the hooks changing whether it settled.
 * An earlier version iterated the plain side alone and missed exactly that. There is no category of
 * hooked-only field to excuse: nothing in the digest is the instrument's own output, because the
 * observation summary travels through `drainObservations` and never through these fields.
 */
export function perturbedFields(withHooks: Digest, plainPasses: readonly Digest[]): string[] {
  if (plainPasses.length === 0) {
    // Returning `[]` would claim the hooks moved nothing when nothing was compared — the same
    // shape of false clean bill that `unobserved` exists to keep out of `equal`.
    throw new Error("perturbation: needs at least one plain pass to compare against");
  }
  const fields = new Set<string>(Object.keys(withHooks));
  for (const pass of plainPasses) for (const field of Object.keys(pass)) fields.add(field);

  const moved: string[] = [];
  for (const field of [...fields].sort()) {
    const hooked = readingOf(withHooks, field);
    if (!plainPasses.some((pass) => sameReading(hooked, readingOf(pass, field)))) moved.push(field);
  }
  return moved;
}
