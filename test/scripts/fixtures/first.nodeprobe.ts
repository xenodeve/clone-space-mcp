// A `node:test` file used only by `test/scripts/mutation-hook-runtime.test.ts`, which runs it
// under `node --test` to prove the loader hook reaches the per-file child that runner spawns.
// Named `.nodeprobe.ts` so Bun's own test glob does not collect it.
import assert from "node:assert";
import { test } from "node:test";
import { fingerprintKey } from "../../../src/identity/fingerprint.ts";

test("first child sees the mutated fingerprint key", () => {
  assert.strictEqual(
    fingerprintKey({
      id: "wa:0:1",
      frameKey: "0",
      tag: "div",
      attrs: {},
      siblingOrdinal: 2,
      textHash: null,
      parentId: null,
    }),
    "0|div||2|",
  );
});
