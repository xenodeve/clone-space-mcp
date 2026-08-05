import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { activeMutation, MUTATION_ENV, targetsModule } from "../../scripts/mutation-hook.ts";
import type { Mutation } from "../../scripts/mutations.ts";

const REPO_ROOT = "D:/repo";
const TARGET: Mutation = {
  id: "target",
  why: "test fixture",
  file: "src/identity/fingerprint.ts",
  find: "a",
  replace: "b",
  suite: "bun",
  expect: "nothing",
};

/**
 * The hook is asked about every module the runtime loads, so it has to answer "is this the file
 * the corpus entry names?" from whatever shape the runtime hands it — a native path under Bun, a
 * `file://` URL under Node, and on Windows either separator. Getting this wrong is silent: the
 * hook simply never fires, the run measures unmutated code, and the result looks like a defect
 * that made no difference.
 */
describe("targetsModule", () => {
  test("matches the corpus file, given a native path", () => {
    expect(targetsModule(TARGET, "D:/repo/src/identity/fingerprint.ts", REPO_ROOT)).toBe(true);
  });

  test("matches the same file given Windows separators", () => {
    expect(targetsModule(TARGET, "D:\\repo\\src\\identity\\fingerprint.ts", REPO_ROOT)).toBe(true);
  });

  test("matches the same file given a file:// URL, which is what Node's loader passes", () => {
    expect(targetsModule(TARGET, pathToFileURL("D:/repo/src/identity/fingerprint.ts").href, REPO_ROOT)).toBe(
      true,
    );
  });

  test("does not match a different file", () => {
    expect(targetsModule(TARGET, "D:/repo/src/capture/record.ts", REPO_ROOT)).toBe(false);
  });

  /**
   * `src/identity/fingerprint.ts` must not be matched by a same-named file somewhere else in the
   * tree — a suffix test would match it.
   */
  test("does not match a same-named file under a different root", () => {
    expect(targetsModule(TARGET, "D:/other/src/identity/fingerprint.ts", REPO_ROOT)).toBe(false);
  });
});

describe("activeMutation", () => {
  function withEnv<T>(value: string | undefined, body: () => T): T {
    const previous = process.env[MUTATION_ENV];
    if (value === undefined) delete process.env[MUTATION_ENV];
    else process.env[MUTATION_ENV] = value;
    try {
      return body();
    } finally {
      if (previous === undefined) delete process.env[MUTATION_ENV];
      else process.env[MUTATION_ENV] = previous;
    }
  }

  test("no selection means no mutation", () => {
    expect(withEnv(undefined, () => activeMutation())).toBeUndefined();
    expect(withEnv("", () => activeMutation())).toBeUndefined();
  });

  test("resolves a real corpus entry", () => {
    expect(withEnv("fingerprint-key-gates-on-ordinal-and-text", () => activeMutation())?.file).toBe(
      "src/identity/fingerprint.ts",
    );
  });

  /**
   * A typo'd id must stop the run rather than produce a process that quietly mutates nothing and
   * reports whatever the unmutated suite happened to do.
   */
  test("refuses an id the corpus does not carry", () => {
    expect(() => withEnv("no-such-id", () => activeMutation())).toThrow(/unknown mutation id/);
  });
});
