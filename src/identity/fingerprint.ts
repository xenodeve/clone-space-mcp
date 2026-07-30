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
 * `parentId` is excluded on purpose: it is a `wa:` id, so it differs between runs by
 * construction and would make every child of a re-numbered parent unmatchable. Parentage
 * still disambiguates — but transitively, after the parent itself has been matched, which
 * is why `reconcile` works top-down.
 */
export function fingerprintKey(el: ElementFingerprint): string {
  const attrs = Object.keys(el.attrs)
    .sort()
    .map((k) => `${k}=${el.attrs[k]}`)
    .join(",");

  return [el.frameKey, el.tag, attrs, el.siblingOrdinal, el.textHash ?? ""].join("|");
}
