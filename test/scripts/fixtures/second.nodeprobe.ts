// The second file exists purely so `node --test` has two of them: it spawns one child per file,
// and the whole point of this fixture pair is to show the hook registers in *each* child, not
// only in the runner. See `test/scripts/mutation-hook-runtime.test.ts`.
import assert from "node:assert";
import { test } from "node:test";
import { fingerprintKey } from "../../../src/identity/fingerprint.ts";

test("second child sees the mutated fingerprint key", () => {
  assert.strictEqual(
    fingerprintKey({
      id: "wa:0:2",
      frameKey: "0",
      tag: "span",
      attrs: {},
      siblingOrdinal: 5,
      textHash: null,
      parentId: null,
    }),
    "0|span||5|",
  );
});
