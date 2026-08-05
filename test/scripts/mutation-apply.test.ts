import { describe, expect, test } from "bun:test";
import { applyMutationText } from "../../scripts/mutation-apply.ts";

/**
 * The dangerous failure of a text mutation is not an exception — it is silence. A `find`
 * that matches nothing leaves the file unmutated, the measurement runs against correct
 * code, and the result reads as "the defect made no difference". That reading then gets
 * written into a report as a finding.
 *
 * This has already happened here twice: once when `perl -0pi` was given a `\n` pattern
 * against CRLF files, and once when a fix moved text an older corpus anchor matched. So
 * the contract is that a non-matching anchor throws, and says how many times it matched.
 */
describe("applyMutationText", () => {
  test("replaces the one occurrence it was given", () => {
    const source = 'return [el.frameKey, el.tag, attrs].join("|");\n';

    expect(
      applyMutationText(
        source,
        '[el.frameKey, el.tag, attrs]',
        '[el.frameKey, el.tag, attrs, el.siblingOrdinal]',
      ),
    ).toBe('return [el.frameKey, el.tag, attrs, el.siblingOrdinal].join("|");\n');
  });

  test("refuses an anchor that matches nothing, and says so", () => {
    // The CRLF case specifically: the anchor is written with \n, the file has \r\n.
    expect(() => applyMutationText("const a = 1;\r\nconst b = 2;\r\n", "const a = 1;\nconst b = 2;", "x")).toThrow(
      /occurs 0 times/,
    );
  });

  test("refuses an anchor that matches more than once", () => {
    expect(() => applyMutationText("drop();\ndrop();\n", "drop();", "keep();")).toThrow(/occurs 2 times/);
  });

  test("names the file in the failure when one is given, so the report says which anchor rotted", () => {
    expect(() => applyMutationText("unrelated\n", "absent", "x", "src/identity/fingerprint.ts")).toThrow(
      /src\/identity\/fingerprint\.ts/,
    );
  });
});
