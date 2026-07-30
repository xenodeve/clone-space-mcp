/**
 * What one element looks like, recorded so it can be recognised in a *different run*.
 *
 * `wa:` ids are assigned by a counter, and replay rebuilds the DOM by re-executing the
 * page's own JavaScript, so the counter lands somewhere else. The id is therefore a handle
 * within one run, never a key across two — recognition has to come from structure, which
 * is what a fingerprint is for.
 */
export interface ElementFingerprint {
  /** `wa:<frame-key>:<sequence>`. Unique within its run; meaningless across runs. */
  id: string;
  /** Which document this element lives in. Top frame is `0`; nesting extends it, e.g. `0/1`. */
  frameKey: string;
  /** Lowercased tag name. */
  tag: string;
  /**
   * A deliberately small, stable subset of attributes. Anything a framework rewrites on
   * hydration (generated ids, scoped-style hashes, `style`) must stay out — an attribute
   * that differs between runs turns a recognisable element into an unrecognisable one.
   */
  attrs: Record<string, string>;
  /** Index among siblings sharing this tag. What tells three identical `<li>` apart. */
  siblingOrdinal: number;
  /** Hash of direct text content; `null` when the element has none. */
  textHash: string | null;
  /** The `wa:` id of the parent within the same run, or `null` at a document root. */
  parentId: string | null;
}

/**
 * The string two elements must share to be *candidates* for the same element.
 *
 * Only the components that survive an unrelated edit elsewhere in the page belong here.
 * Sibling ordinal and text hash do **not**: one node inserted above a target shifts every
 * following ordinal, and dynamic text ("2 minutes ago") differs between runs by design.
 * Putting either in the key meant an element with a unique, stable attribute was never
 * even compared against the node that obviously was it — reported `missing` while that
 * node was simultaneously reported `replayOnly`. They are scored instead (#20).
 *
 * `parentId` is excluded for a different reason: it is a `wa:` id, so it differs between
 * runs by construction and would make every child of a re-numbered parent unmatchable.
 * Parentage still disambiguates — transitively, after the parent itself has been matched,
 * which is why `reconcile` works top-down.
 */
export function fingerprintKey(el: ElementFingerprint): string {
  const attrs = Object.keys(el.attrs)
    .sort()
    .map((k) => `${k}=${el.attrs[k]}`)
    .join(",");

  return [el.frameKey, el.tag, attrs].join("|");
}

/**
 * How much the weaker evidence supports these two being the same element, used only to
 * rank candidates that already share a key.
 *
 * **Exact matches only — there is deliberately no "closest ordinal wins".** When a whole
 * run of identical siblings shifts, proximity scoring pairs every one of them off
 * confidently and gets the entire run wrong. Scoring only exact agreement means such a run
 * comes back `identity-unresolved`, which is the outcome ADR 0002 exists to produce.
 *
 * Two absent text hashes are not agreement, so they score nothing.
 */
export function evidenceScore(a: ElementFingerprint, b: ElementFingerprint): number {
  let score = 0;
  if (a.siblingOrdinal === b.siblingOrdinal) score++;
  if (a.textHash !== null && a.textHash === b.textHash) score++;
  return score;
}
