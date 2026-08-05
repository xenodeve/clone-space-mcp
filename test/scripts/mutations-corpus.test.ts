import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countOccurrences } from "../../scripts/mutation-apply.ts";
import { MUTATIONS } from "../../scripts/mutations.ts";
import { repoRoot } from "../../scripts/repo-root.ts";

/**
 * #20 is the only defect in this corpus that a *measurement* depends on, not just a test:
 * `bun run metamorphic --against` re-applies it to ask whether the metamorphic check
 * discriminates against a bug that actually happened (#78). If its anchor rots, that run
 * measures unmutated code and reports "no discrimination" — a false finding, permanently
 * recorded in a report.
 *
 * The expected text below is not derived from the current source. It is the literal
 * `fingerprintKey` return from before the fix, read out of commit 44e2671.
 */
const FINGERPRINT_KEY_GATES_ON_ORDINAL_AND_TEXT = "fingerprint-key-gates-on-ordinal-and-text";
const PRE_44E2671_KEY_EXPRESSION =
  'return [el.frameKey, el.tag, attrs, el.siblingOrdinal, el.textHash ?? ""].join("|");';

describe("the #20 fingerprint defect is in the corpus", () => {
  const mutation = MUTATIONS.find(({ id }) => id === FINGERPRINT_KEY_GATES_ON_ORDINAL_AND_TEXT);

  test("the corpus carries it", () => {
    expect(mutation).toBeDefined();
    expect(mutation?.file).toBe("src/identity/fingerprint.ts");
  });

  test("what it restores is the literal pre-44e2671 key expression", () => {
    expect(mutation!.replace).toBe(PRE_44E2671_KEY_EXPRESSION);
  });

  /**
   * Since #82 nothing writes the defect to disk, so the file is always in its fixed state and this
   * can assert exactly that. It replaces a looser "fixed **or** carrying the defect" form, which
   * was a concession to `scripts/mutate.ts` rewriting the file underneath its own run — a
   * situation that no longer exists, so the concession went with it.
   */
  test("its anchor still matches the source exactly once", () => {
    const source = readFileSync(resolve(repoRoot, mutation!.file), "utf8");

    // Counted, not `includes`. A second copy of the anchor — in a comment, a string, a sibling
    // function — makes the hook refuse at run time, so a membership test would pass while the
    // corpus entry was already unusable. `countOccurrences` specifically, so this counts the way
    // the applier counts rather than inventing a second rule.
    expect(countOccurrences(source, mutation!.find)).toBe(1);
  });
});
