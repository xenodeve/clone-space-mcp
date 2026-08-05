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
   * Deliberately not "the anchor matches the file exactly once". `scripts/mutate.ts` rewrites
   * this very file while it runs this entry, so a run of `bun run mutate` would fail this
   * test and pollute its own verdict — measured, not assumed: with the mutation applied the
   * earlier version of this test exited 1 with `MUTATION NOT APPLIED — occurs 0 times`.
   *
   * Both states are legitimate. What is not legitimate is neither, which is the anchor
   * having rotted, and that is what this guards.
   */
  test("its anchor has not rotted — the source is either fixed or carrying the defect, never both", () => {
    const source = readFileSync(resolve(repoRoot, mutation!.file), "utf8");
    // Counted, not `includes`. A second copy of the anchor — in a comment, a string, a sibling
    // function — makes `mutate.ts` refuse at run time, so a membership test would pass while the
    // corpus entry was already unusable.
    // `countOccurrences` rather than a second counting rule here: this test exists to notice a
    // rotted anchor, and it can only do that if it counts the way the applier counts.
    const fixed = countOccurrences(source, mutation!.find);
    const defectApplied = countOccurrences(source, mutation!.replace);

    // Exactly one occurrence, across both forms together. Zero means the anchor rotted; two means
    // `mutate.ts` will refuse the entry; one of each is impossible and would mean the file is not
    // in either known state.
    expect(fixed + defectApplied).toBe(1);
  });
});
