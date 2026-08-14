/**
 * The equivalence gate's core (#171, slice 0 of #169).
 *
 * The acceptance criterion this serves is the developer's own: **the offline clone must behave as
 * the online site does for client-side code**. A checklist can only test what its author thought
 * to ask; equivalence tests what the site actually does — so the gate is the falsifier, and it is
 * built before the slices whose value it exists to judge.
 *
 * Pure on purpose. Everything difficult about the gate is a *rule*, not a comparison, and a rule
 * that can only be exercised through a browser is a rule nobody exercises.
 */

/** A flat observation set. One key per compared field; the value is whatever was observed. */
export type Digest = Record<string, unknown>;

/**
 * The six categories of difference that must be allowed or the gate is red forever. They are
 * documented in `docs/superpowers/plans/2026-08-14-deep-client-comprehension.md` §4.2; the numbers
 * are the contract, so an entry outside them is a policy nobody wrote down.
 */
export type AllowedCategory = 1 | 2 | 3 | 4 | 5 | 6;

export interface AllowlistEntry {
  /** The field this covers. Exact match; see `assertUsable` for why it is not a pattern. */
  field: string;
  category: AllowedCategory;
  /**
   * Why this difference is legitimate, and how it was shown not to propagate into a surface that
   * is not allowed. An entry without one is refused: an allowlist whose reasons live in someone's
   * head is how a gate quietly stops testing.
   */
  rationale: string;
}

export type Verdict = "equal" | "allowed" | "different" | "unobserved" | "unstable";

/**
 * Two digests of the **same side**, taken under the same driver. A field that differs between them
 * cannot be evidence about the clone, and the gate must not report it as one.
 *
 * This is a measurement, taken per run, not a declaration. Measured on three real sites by driving
 * the live page twice: `dom.elements` differed on all three, `motion.gsap.settled` by 198 to 142,
 * and ScrollTrigger registrations by 38 to 6. Every `FAIL` the gate produced before this existed
 * was noise — and an allowlist would have been the wrong instrument for it, because it would
 * excuse the clone for something the clone did not do.
 *
 * **Two passes do not catch a bimodal field, and this is measured too.** A later run of the same
 * site saw both baseline passes report 6 ScrollTriggers while replay reported 38 — the field
 * settles at one of two values, so a two-sample baseline can agree with itself and still be
 * comparing nothing. The control raises the floor; it does not make a `different` verdict certain,
 * and a caller should read `unstable` as *"this many fields carried no signal"* rather than as a
 * guarantee about the rest.
 */
export interface StabilityBaseline {
  baselineA: Digest;
  baselineB: Digest;
}

export interface FieldResult {
  field: string;
  verdict: Verdict;
  live?: unknown;
  replay?: unknown;
  /** Which of the six categories covered this, when the verdict is `allowed`. */
  category?: AllowedCategory;
}

export interface ClassifyResult {
  fields: FieldResult[];
  /** Fields the baseline showed cannot be compared. Reported, never silently dropped. */
  unstable: string[];
  /** Fields that differ and nothing covers. Empty is the only shape a `PASS` may have. */
  residual: string[];
  /**
   * `PASS` when nothing differs uncovered and every field was observed on both sides.
   * `INCOMPLETE` when the residual is empty but a field was only half observed, or could not be
   * measured twice the same way — **neither is agreement**, and a caller reading a boolean would
   * have been told it was.
   * `FAIL` when the residual is non-empty.
   */
  verdict: "PASS" | "INCOMPLETE" | "FAIL";
}

function assertUsable(entry: AllowlistEntry): void {
  if (entry.rationale.trim().length === 0) {
    throw new Error(`equivalence: allowlist entry for ${entry.field} has no rationale`);
  }
  if (![1, 2, 3, 4, 5, 6].includes(entry.category)) {
    throw new Error(
      `equivalence: allowlist entry for ${entry.field} names category ${entry.category}, which is not one of the six documented ones`,
    );
  }
  // Category 1 — requests the archive deliberately cannot serve — is the one that invites a
  // wholesale allowance, and doing so is measured to be wrong: `www.chaingpt.org` cannot serve
  // `Cannon_Exterior.hdr`, its 3D scene's environment map, so an API-level comparison passes while
  // the scene renders unlit. A matcher that covers everything is that mistake written down.
  if (entry.field === "*" || entry.field.trim().length === 0) {
    throw new Error(
      "equivalence: an allowlist entry may not cover fields wholesale; name the field it excuses",
    );
  }
}

export function classify(
  live: Digest,
  replay: Digest,
  allowlist: readonly AllowlistEntry[],
  baseline?: StabilityBaseline,
): ClassifyResult {
  for (const entry of allowlist) assertUsable(entry);
  const excuses = new Map(allowlist.map((entry) => [entry.field, entry]));

  const fields: FieldResult[] = [];
  const residual: string[] = [];
  const unstable: string[] = [];
  let inconclusive = false;

  for (const field of [...new Set([...Object.keys(live), ...Object.keys(replay)])].sort()) {
    const onLive = Object.hasOwn(live, field);
    const onReplay = Object.hasOwn(replay, field);

    // Observed on one side only. Not a difference — nothing was compared — and emphatically not
    // agreement. A page whose 242 click listeners are never fired produces exactly this, and
    // reading it as `equal` is how a scroll-only clone comes to look complete.
    if (!onLive || !onReplay) {
      inconclusive = true;
      fields.push({ field, verdict: "unobserved", live: live[field], replay: replay[field] });
      continue;
    }

    if (Object.is(live[field], replay[field])) {
      fields.push({ field, verdict: "equal" });
      continue;
    }

    // Checked before the allowlist on purpose. A field this run could not measure twice the same
    // way is not a difference anybody excused — it is a field that carries no signal at all, and
    // calling it `allowed` would credit an entry for work the measurement did.
    if (
      baseline !== undefined &&
      Object.hasOwn(baseline.baselineA, field) &&
      Object.hasOwn(baseline.baselineB, field) &&
      !Object.is(baseline.baselineA[field], baseline.baselineB[field])
    ) {
      inconclusive = true;
      unstable.push(field);
      fields.push({ field, verdict: "unstable", live: live[field], replay: replay[field] });
      continue;
    }

    const excuse = excuses.get(field);
    if (excuse !== undefined) {
      fields.push({
        field,
        verdict: "allowed",
        live: live[field],
        replay: replay[field],
        category: excuse.category,
      });
      continue;
    }

    fields.push({ field, verdict: "different", live: live[field], replay: replay[field] });
    residual.push(field);
  }

  const verdict = residual.length > 0 ? "FAIL" : inconclusive ? "INCOMPLETE" : "PASS";
  return { fields, residual, unstable, verdict };
}

/**
 * Coverage as a **vector**, one entry per dimension, never a score.
 *
 * A single number averages away exactly the dimension that is weak — a clone measured only over
 * scrolling would report high coverage while saying nothing about interaction, which is the
 * failure the plan calls a rubber stamp. Each dimension is `[achieved, expected]`.
 */
export function coverageOf(dimensions: Record<string, [number, number]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, [achieved, expected]] of Object.entries(dimensions)) {
    // Nothing expected is full coverage of nothing, not a division by zero. Saying 0% for a
    // dimension the page never had would make an unrelated absence look like a gap.
    out[name] = expected === 0 ? 100 : Math.round((100 * achieved) / expected);
  }
  return out;
}
