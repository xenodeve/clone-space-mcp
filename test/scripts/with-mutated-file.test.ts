import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMutatedFile } from "../../scripts/mutation-apply.ts";

const ORIGINAL = 'export const key = [frame, tag].join("|");\n';
const FIND = "[frame, tag]";
const REPLACE = "[frame, tag, ordinal]";

async function scratchFile(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "clone-space-mutation-"));
  const path = join(directory, "target.ts");
  await writeFile(path, ORIGINAL, "utf8");
  return { path, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

/**
 * This runs against real source files, so the restore is the whole safety story: a body
 * that throws must not be able to leave a known defect sitting in the working tree, where
 * the next commit would carry it.
 */
describe("withMutatedFile", () => {
  test("the body sees the mutated content", async () => {
    const { path, cleanup } = await scratchFile();
    try {
      const seen = await withMutatedFile(path, FIND, REPLACE, async () => readFile(path, "utf8"));

      expect(seen).toBe('export const key = [frame, tag, ordinal].join("|");\n');
    } finally {
      await cleanup();
    }
  });

  test("the file is byte-identical afterwards", async () => {
    const { path, cleanup } = await scratchFile();
    try {
      await withMutatedFile(path, FIND, REPLACE, async () => undefined);

      expect(await readFile(path, "utf8")).toBe(ORIGINAL);
    } finally {
      await cleanup();
    }
  });

  test("the file is restored even when the body throws, and the error still propagates", async () => {
    const { path, cleanup } = await scratchFile();
    try {
      const attempt = withMutatedFile(path, FIND, REPLACE, async () => {
        throw new Error("measurement blew up");
      });

      await expect(attempt).rejects.toThrow("measurement blew up");
      expect(await readFile(path, "utf8")).toBe(ORIGINAL);
    } finally {
      await cleanup();
    }
  });

  test("an anchor that does not match leaves the file untouched and never runs the body", async () => {
    const { path, cleanup } = await scratchFile();
    let bodyRan = false;
    try {
      const attempt = withMutatedFile(path, "absent anchor", REPLACE, async () => {
        bodyRan = true;
      });

      await expect(attempt).rejects.toThrow(/occurs 0 times/);
      expect(bodyRan).toBe(false);
      expect(await readFile(path, "utf8")).toBe(ORIGINAL);
    } finally {
      await cleanup();
    }
  });
});
