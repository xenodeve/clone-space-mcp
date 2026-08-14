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

export type Verdict = "equal" | "allowed" | "different" | "unobserved";

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
  /** Fields that differ and nothing covers. Empty is the only shape a `PASS` may have. */
  residual: string[];
  /**
   * `PASS` when nothing differs uncovered and every field was observed on both sides.
   * `INCOMPLETE` when the residual is empty but something was only half observed — **that is not
   * agreement**, and a caller reading a boolean would have been told it was.
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
): ClassifyResult {
  for (const entry of allowlist) assertUsable(entry);
  const excuses = new Map(allowlist.map((entry) => [entry.field, entry]));

  const fields: FieldResult[] = [];
  const residual: string[] = [];
  let anyUnobserved = false;

  for (const field of [...new Set([...Object.keys(live), ...Object.keys(replay)])].sort()) {
    const onLive = Object.hasOwn(live, field);
    const onReplay = Object.hasOwn(replay, field);

    // Observed on one side only. Not a difference — nothing was compared — and emphatically not
    // agreement. A page whose 242 click listeners are never fired produces exactly this, and
    // reading it as `equal` is how a scroll-only clone comes to look complete.
    if (!onLive || !onReplay) {
      anyUnobserved = true;
      fields.push({ field, verdict: "unobserved", live: live[field], replay: replay[field] });
      continue;
    }

    if (Object.is(live[field], replay[field])) {
      fields.push({ field, verdict: "equal" });
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

  const verdict = residual.length > 0 ? "FAIL" : anyUnobserved ? "INCOMPLETE" : "PASS";
  return { fields, residual, verdict };
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
