import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startFixtureServers, type FixtureServers } from "../fixtures/serve.ts";
import {
  decodeMappings,
  parseSourceMap,
  resolveFrame,
  type SourceMap,
} from "../../src/extract/sourcemap.ts";

/**
 * The resolver against a map a real bundler produced.
 *
 * The unit tests judge a map written by this file's author, which proves the arithmetic and
 * nothing about the format. `test/fixtures/serve.ts` builds `instrumented.ts` **minified** with a
 * linked sourcemap, in memory, using Bun's own bundler — and the fixture's source was written for
 * exactly this: `computeHeroParallaxOffset` survives in the map and nowhere in the minified output.
 *
 * No browser is involved. This is `fetch` and four pure functions, so it belongs in the Bun suite.
 */

let servers: FixtureServers;
let minified: string;
let map: SourceMap;

beforeAll(async () => {
  servers = await startFixtureServers();
  const base = servers.primary.url;
  minified = await (await fetch(new URL("/build/instrumented.js", base))).text();
  const mapText = await (await fetch(new URL("/build/instrumented.js.map", base))).text();
  const parsed = parseSourceMap(mapText);
  if (parsed === undefined) throw new Error("fixture served a sourcemap this module cannot read");
  map = parsed;
});

afterAll(async () => {
  await servers?.stop();
});

/** The 1-based line of the first line of `sourcesContent` matching `needle`. */
function sourceLineContaining(source: string, needle: string): number {
  const index = map.sources.findIndex((name) => name.endsWith(source));
  const content = map.sourcesContent?.[index];
  if (typeof content !== "string") throw new Error(`no content for ${source}`);
  const line = content.split("\n").findIndex((text) => text.includes(needle));
  if (line === -1) throw new Error(`no line containing ${needle} in ${source}`);
  return line + 1;
}

describe("the fixture's real sourcemap", () => {
  test("the bundle really is minified, so resolving it is not a trivial exercise", () => {
    // The declaration is gone — the body is `function r(t,e){let a=t*e;return Math.min(a,96)}`.
    // The *name* survives, but only in the export binding (`export{r as computeHeroParallaxOffset}`),
    // because a public export name is part of the module's contract and cannot be mangled. So a
    // reader of the minified file can see that the symbol exists and not one line of how it works,
    // which is precisely the gap this module closes.
    expect(minified).not.toContain("function computeHeroParallaxOffset");
    expect(minified).toContain("as computeHeroParallaxOffset");
    expect(minified.split("\n").length).toBeLessThan(10);
  });

  test("carries the original source text, which is what makes a citation showable", () => {
    expect(sourceLineContaining("instrumented.ts", "computeHeroParallaxOffset")).toBeGreaterThan(0);
  });

  test("decodes to a substantial number of segments, so the checks below are not vacuous", () => {
    expect(decodeMappings(map.mappings).length).toBeGreaterThan(20);
  });

  test("every segment round-trips: its generated position resolves back to its own source line", () => {
    // The strongest available check, and the one an off-by-one cannot survive. Each segment states
    // where it came from; resolving the position it describes must return that exact place.
    const wrong: string[] = [];
    for (const segment of decodeMappings(map.mappings)) {
      if (segment.sourceIndex < 0) continue;
      const resolved = resolveFrame(
        map,
        { line: segment.generatedLine + 1, column: segment.generatedColumn + 1 },
        0,
      );
      const expected = {
        source: map.sources[segment.sourceIndex],
        line: segment.sourceLine + 1,
        column: segment.sourceColumn + 1,
      };
      if (
        resolved === undefined ||
        resolved.source !== expected.source ||
        resolved.line !== expected.line ||
        resolved.column !== expected.column
      ) {
        wrong.push(`${segment.generatedLine + 1}:${segment.generatedColumn + 1} → ${JSON.stringify(resolved)} want ${JSON.stringify(expected)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("every excerpt centres on the line the resolver named, in the real file", () => {
    const wrong: string[] = [];
    const lines = (map.sourcesContent?.[0] ?? "").split("\n");
    for (const segment of decodeMappings(map.mappings)) {
      if (segment.sourceIndex !== 0) continue;
      const resolved = resolveFrame(
        map,
        { line: segment.generatedLine + 1, column: segment.generatedColumn + 1 },
        1,
      );
      const centre = resolved?.excerpt.find((line) => line.line === resolved.line);
      if (centre?.text !== lines[resolved!.line - 1]) {
        wrong.push(`line ${resolved?.line}: ${JSON.stringify(centre)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("cites the parallax helper by name, from a position in the minified bundle", () => {
    // The end the whole slice exists for: a runtime position, in minified coordinates, answered
    // with a file, a line, and the text written on it.
    const target = sourceLineContaining("instrumented.ts", "function computeHeroParallaxOffset");
    const segment = decodeMappings(map.mappings).find(
      (candidate) => candidate.sourceIndex === 0 && candidate.sourceLine + 1 === target,
    );
    expect(segment).toBeDefined();

    const cited = resolveFrame(
      map,
      { line: segment!.generatedLine + 1, column: segment!.generatedColumn + 1 },
      1,
    );
    expect(cited?.source).toContain("instrumented.ts");
    expect(cited?.line).toBe(target);
    expect(cited?.excerpt.find((line) => line.line === target)?.text).toContain(
      "computeHeroParallaxOffset",
    );
  });
});
