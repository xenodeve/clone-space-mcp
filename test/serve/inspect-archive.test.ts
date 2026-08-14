import { expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectArchive } from "../../src/serve/tools/inspect-archive.ts";
import { captureFixtureArchive } from "./fixture-archive.ts";

test("inspectArchive answers whether a capture is complete, with no MCP and no browser", async () => {
  const root = await captureFixtureArchive();
  try {
    const result = await inspectArchive({ path: root });

    expect(result.root).toBe(root);
    expect(result.complete).toBe(true);
    expect(result.integrity).toEqual({ ok: true, mismatched: [] });
    // Every contract is either carried or not published by this version of capture. "missing" is
    // what `complete` keys off, so it must be empty here.
    expect(result.contracts.filter((c) => c.status === "missing")).toEqual([]);
    expect(result.termination.outcome).toBeString();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspectArchive reports an incomplete capture and names what is wrong", async () => {
  const root = await captureFixtureArchive();
  try {
    writeFileSync(join(root, "targets.json"), '{"schemaVersion":1,"targets":[]}');

    const result = await inspectArchive({ path: root });

    expect(result.complete).toBe(false);
    expect(result.integrity.ok).toBe(false);
    // The whole point of the tool: an agent asking "is this any good?" gets the file, not a mood.
    expect(result.integrity.mismatched).toEqual(["targets.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspectArchive refuses a path that is not an archive", async () => {
  await expect(inspectArchive({ path: join(process.cwd(), "does-not-exist") })).rejects.toThrow(
    /not an archive/,
  );
});
