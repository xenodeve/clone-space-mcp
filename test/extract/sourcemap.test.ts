import { describe, expect, test } from "bun:test";
import {
  decodeMappings,
  originalPositionFor,
  parseSourceMap,
  resolveFrame,
  sourceExcerpt,
  type SourceMap,
} from "../../src/extract/sourcemap.ts";

/**
 * A hand-built map, used only for the rules a real bundler's output cannot exercise on demand —
 * an uncovered column, a line with no segments, a source with no content, a malformed string. The
 * evidence that the decoder understands the real format is the browser test, which resolves a
 * position in a minified bundle a bundler actually produced.
 *
 * Every field is a delta from the previous segment, except the generated column which resets each
 * line. Worked out by hand so the expectations below are ground truth rather than whatever the
 * implementation happens to print:
 *
 * | segment  | fields          | means                                             |
 * |----------|-----------------|---------------------------------------------------|
 * | `AAAAA`  | `[0,0,0,0,0]`   | generated 1:1 → `a.ts` 1:1, name `render`          |
 * | `GAEA`   | `[+3,0,+2,0]`   | generated 1:4 → `a.ts` 3:1, no name                |
 * | `;AADA`  | `[0,0,-1,0]`    | generated 2:1 → `a.ts` 2:1, no name                |
 * | `;ACDA`  | `[0,+1,-1,0]`   | generated 3:1 → `b.ts` 1:1 — a source with no text |
 *
 * Generated line 4 has no segments at all, which is what "never answer from another line" needs.
 */
const MAP: SourceMap = {
  version: 3,
  sources: ["a.ts", "b.ts"],
  sourcesContent: ["one\ntwo\nthree\nfour\nfive", null],
  names: ["render"],
  mappings: "AAAAA,GAEA;AADA;ACDA",
};

describe("decodeMappings", () => {
  test("decodes the first segment as all-zero", () => {
    expect(decodeMappings(MAP.mappings)[0]).toEqual({
      generatedLine: 0,
      generatedColumn: 0,
      sourceIndex: 0,
      sourceLine: 0,
      sourceColumn: 0,
      nameIndex: 0,
    });
  });

  test("accumulates each field relative to the previous segment", () => {
    expect(decodeMappings(MAP.mappings)[1]).toMatchObject({
      generatedLine: 0,
      generatedColumn: 3,
      sourceLine: 2,
    });
  });

  test("resets the generated column at a new line but carries the source fields", () => {
    const third = decodeMappings(MAP.mappings)[2];
    expect(third).toMatchObject({ generatedLine: 1, generatedColumn: 0, sourceLine: 1 });
  });

  test("keeps a one-field segment, which names a generated column with no source", () => {
    const segments = decodeMappings("AAAAA,C");
    expect(segments[1]).toMatchObject({ generatedColumn: 1, sourceIndex: -1 });
  });

  test("rejects a malformed mappings string rather than decoding part of it", () => {
    expect(() => decodeMappings("AAAAA,!!!")).toThrow(/mappings/);
  });

  test("rejects a segment with a field count the format does not define", () => {
    // Three fields is not one of the 1 / 4 / 5 forms.
    expect(() => decodeMappings("AAA")).toThrow(/mappings/);
  });
});

describe("originalPositionFor", () => {
  test("resolves a position that sits exactly on a segment", () => {
    expect(originalPositionFor(MAP, 1, 1)).toMatchObject({ source: "a.ts", line: 1, column: 1 });
  });

  test("resolves a position inside a segment to that segment's start", () => {
    // Column 5 sits past the segment that begins at generated column 4, and inside it.
    expect(originalPositionFor(MAP, 1, 5)).toMatchObject({ line: 3, column: 1 });
  });

  test("takes 1-based input and returns 1-based output", () => {
    // The map's first segment is 0,0 → 0,0. A resolver that forgot to convert would answer 0.
    expect(originalPositionFor(MAP, 1, 1)).toMatchObject({ line: 1, column: 1 });
  });

  test("returns nothing before the first segment of a line, rather than the nearest", () => {
    expect(originalPositionFor(MAP, 2, 0)).toBeUndefined();
  });

  test("never answers from a segment on another generated line", () => {
    // Generated line 4 has no segments at all. The nearest segment is on line 3, and reporting it
    // is how a resolver returns a plausible wrong answer.
    expect(originalPositionFor(MAP, 4, 1)).toBeUndefined();
  });

  test("names the symbol when the segment carries one", () => {
    expect(originalPositionFor(MAP, 1, 1)?.name).toBe("render");
  });

  test("leaves the name empty rather than guessing when the segment carries none", () => {
    expect(originalPositionFor(MAP, 2, 1)?.name).toBe("");
  });
});

describe("sourceExcerpt", () => {
  test("returns the line at the position with its surrounding context", () => {
    expect(sourceExcerpt(MAP, "a.ts", 3, 1)).toEqual([
      { line: 2, text: "two" },
      { line: 3, text: "three" },
      { line: 4, text: "four" },
    ]);
  });

  test("clamps at the start of the file instead of emitting negative lines", () => {
    expect(sourceExcerpt(MAP, "a.ts", 1, 2)[0]).toEqual({ line: 1, text: "one" });
  });

  test("clamps at the end of the file", () => {
    expect(sourceExcerpt(MAP, "a.ts", 5, 2).at(-1)).toEqual({ line: 5, text: "five" });
  });

  test("returns nothing for a source whose content the map does not carry", () => {
    expect(sourceExcerpt(MAP, "b.ts", 1, 1)).toEqual([]);
  });

  test("returns nothing for a source the map does not list at all", () => {
    expect(sourceExcerpt(MAP, "nowhere.ts", 1, 1)).toEqual([]);
  });
});

describe("resolveFrame", () => {
  test("resolves a frame to its source position and the text around it", () => {
    expect(resolveFrame(MAP, { line: 1, column: 1 }, 1)).toEqual({
      source: "a.ts",
      line: 1,
      column: 1,
      name: "render",
      excerpt: [
        { line: 1, text: "one" },
        { line: 2, text: "two" },
      ],
    });
  });

  test("returns nothing when the map cannot answer, rather than a partial result", () => {
    expect(resolveFrame(MAP, { line: 4, column: 1 }, 1)).toBeUndefined();
  });

  test("still resolves the position when the map carries no content for that source", () => {
    const frame = resolveFrame(MAP, { line: 3, column: 1 }, 1);
    expect(frame).toMatchObject({ source: "b.ts", line: 1, excerpt: [] });
  });
});

describe("parseSourceMap", () => {
  test("reads a well-formed map", () => {
    expect(parseSourceMap(JSON.stringify(MAP))?.sources).toEqual(["a.ts", "b.ts"]);
  });

  test("returns nothing for a version the format does not define", () => {
    expect(parseSourceMap(JSON.stringify({ ...MAP, version: 2 }))).toBeUndefined();
  });

  test("returns nothing for text that is not JSON, rather than throwing", () => {
    expect(parseSourceMap("not json")).toBeUndefined();
  });

  test("returns nothing when sources and mappings are not both present", () => {
    expect(parseSourceMap(JSON.stringify({ version: 3, sources: ["a.ts"] }))).toBeUndefined();
  });
});
