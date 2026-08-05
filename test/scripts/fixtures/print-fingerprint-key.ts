// Prints one fingerprint key so a spawned runtime can be asked, from outside, whether the
// mutation hook actually reached the module it claims to rewrite.
import { fingerprintKey } from "../../../src/identity/fingerprint.ts";

console.log(
  fingerprintKey({
    id: "wa:0:1",
    frameKey: "0",
    tag: "div",
    attrs: {},
    siblingOrdinal: 2,
    textHash: null,
    parentId: null,
  }),
);
