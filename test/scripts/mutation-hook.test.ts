import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { mutationForModule } from "../../scripts/mutation-hook.ts";
import type { Mutation } from "../../scripts/mutations.ts";

const REPO_ROOT = "D:/repo";
const CORPUS: Mutation[] = [
  {
    id: "target",
    why: "test fixture",
    file: "src/identity/fingerprint.ts",
    find: "a",
    replace: "b",
    suite: "bun",
    expect: "nothing",
  },
  {
    id: "elsewhere",
    why: "test fixture",
    file: "src/capture/record.ts",
    find: "a",
    replace: "b",
    suite: "bun",
    expect: "nothing",
  },
];

/**
 * The hook is asked about every module the runtime loads, so it has to answer "is this the file
 * the corpus entry names?" from whatever shape the runtime hands it — a native path under Bun, a
 * `file://` URL under Node, and on Windows either separator. Getting this wrong is silent: the
 * hook simply never fires, the run measures unmutated code, and the result looks like a defect
 * that made no difference.
 */
describe("mutationForModule", () => {
  test("matches the corpus file, given a native path", () => {
    expect(mutationForModule(CORPUS, "target", "D:/repo/src/identity/fingerprint.ts", REPO_ROOT)?.id).toBe(
      "target",
    );
  });

  test("matches the same file given Windows separators", () => {
    expect(
      mutationForModule(CORPUS, "target", "D:\\repo\\src\\identity\\fingerprint.ts", REPO_ROOT)?.id,
    ).toBe("target");
  });

  test("matches the same file given a file:// URL, which is what Node's loader passes", () => {
    const url = pathToFileURL("D:/repo/src/identity/fingerprint.ts").href;

    expect(mutationForModule(CORPUS, "target", url, REPO_ROOT)?.id).toBe("target");
  });

  test("does not match a different file", () => {
    expect(mutationForModule(CORPUS, "target", "D:/repo/src/capture/record.ts", REPO_ROOT)).toBeUndefined();
  });

  /**
   * `src/identity/fingerprint.ts` must not be matched by a corpus entry naming
   * `identity/fingerprint.ts` somewhere else in the tree — a suffix test would.
   */
  test("does not match a same-named file under a different root", () => {
    expect(
      mutationForModule(CORPUS, "target", "D:/other/src/identity/fingerprint.ts", REPO_ROOT),
    ).toBeUndefined();
  });

  test("refuses an id the corpus does not carry, rather than silently mutating nothing", () => {
    expect(() => mutationForModule(CORPUS, "no-such-id", "D:/repo/src/identity/fingerprint.ts", REPO_ROOT)).toThrow(
      /unknown mutation id/,
    );
  });
});
