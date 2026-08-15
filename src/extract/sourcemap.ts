/**
 * Resolve a runtime position to the original source line it was written on (#178, slice 6 of #169).
 *
 * The project's goal is an agent that can say how an effect works **and which line it comes from**.
 * Every position the runtime can report is in minified coordinates, which are useless to a reader:
 * `three.module.min.js:12:326662` names line 12 of a file with about fifteen lines. This module is
 * what turns that into `three@0.151.2/build/three.module.js:18723:4` and the text around it.
 *
 * **It answers or it declines. It never guesses.** A resolver that falls back to the nearest
 * segment on another line returns something plausible and wrong, which is worse than nothing here —
 * the whole point of the chain is that a citation can be checked.
 *
 * No dependency. The format is documented, the decoder is short, and this reads sourcemaps out of
 * archives captured from sites nobody controls; a package is a supply-chain surface bought for
 * about forty lines of arithmetic.
 */

/** A decoded mapping segment. All fields are 0-based, as the format defines them. */
export interface Segment {
  generatedLine: number;
  generatedColumn: number;
  /** -1 when the segment names a generated column with no source position. */
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
  /** -1 when the segment carries no name. */
  nameIndex: number;
}

export interface SourceMap {
  version: number;
  sources: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings: string;
}

/** A position as a stack frame gives it: **1-based** in both line and column. */
export interface Frame {
  line: number;
  column: number;
}

export interface OriginalPosition {
  source: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** "" when the segment carries no name — never a guess from a nearby one. */
  name: string;
}

export interface ExcerptLine {
  /** 1-based. */
  line: number;
  text: string;
}

export interface ResolvedFrame extends OriginalPosition {
  /** Empty when the map carries no content for that source. */
  excerpt: ExcerptLine[];
}

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const VALUE_OF: ReadonlyMap<string, number> = new Map(
  [...BASE64].map((character, index) => [character, index]),
);

/**
 * Read one Base64 VLQ value starting at `index`.
 *
 * Each digit carries five payload bits plus a continuation bit; the assembled value's lowest bit is
 * its sign, which is why a negative zero is representable and is treated as zero.
 */
function readVlq(text: string, index: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let position = index;
  for (;;) {
    if (position >= text.length) throw new Error("sourcemap: mappings ended mid-value");
    const digit = VALUE_OF.get(text[position]!);
    if (digit === undefined) {
      throw new Error(`sourcemap: mappings has an invalid character "${text[position]}"`);
    }
    position += 1;
    result += (digit & 31) << shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  const negative = (result & 1) === 1;
  const magnitude = result >> 1;
  return { value: negative ? -magnitude : magnitude, next: position };
}

function decodeSegment(text: string): number[] {
  const fields: number[] = [];
  let index = 0;
  while (index < text.length) {
    const { value, next } = readVlq(text, index);
    fields.push(value);
    index = next;
  }
  return fields;
}

/**
 * Decode the `mappings` string into segments.
 *
 * The three field counts the format defines are 1 (a generated column with no source), 4 (a source
 * position) and 5 (a source position with a name). Anything else is a malformed map, and decoding
 * part of it would hand the caller positions it cannot distinguish from correct ones.
 */
export function decodeMappings(mappings: string): Segment[] {
  const segments: Segment[] = [];
  let generatedLine = 0;
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;

  for (const lineText of mappings.split(";")) {
    // The generated column resets at every line; every other field is cumulative across the map.
    let generatedColumn = 0;
    for (const segmentText of lineText.split(",")) {
      if (segmentText === "") continue;
      const fields = decodeSegment(segmentText);
      if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5) {
        throw new Error(`sourcemap: mappings segment has ${fields.length} fields, not 1, 4 or 5`);
      }
      generatedColumn += fields[0]!;
      if (fields.length === 1) {
        segments.push({
          generatedLine,
          generatedColumn,
          sourceIndex: -1,
          sourceLine: -1,
          sourceColumn: -1,
          nameIndex: -1,
        });
        continue;
      }
      sourceIndex += fields[1]!;
      sourceLine += fields[2]!;
      sourceColumn += fields[3]!;
      if (fields.length === 5) nameIndex += fields[4]!;
      segments.push({
        generatedLine,
        generatedColumn,
        sourceIndex,
        sourceLine,
        sourceColumn,
        nameIndex: fields.length === 5 ? nameIndex : -1,
      });
    }
    generatedLine += 1;
  }
  return segments;
}

/**
 * Resolve a **1-based** generated position to its **1-based** original position.
 *
 * This function is the single place the 0-based format and the 1-based frame meet. Every other
 * export here speaks 1-based, so an off-by-one has one place to be.
 *
 * The chosen segment is the last one at or before the column **on that generated line**. Restricting
 * to the line is the rule that matters: segments are stored in one flat, ascending list, so a search
 * that ignores the line happily returns the last segment of the previous line for a position nothing
 * maps — an answer that looks right and is not.
 */
/**
 * Decoded segments, per map object.
 *
 * `originalPositionFor` decoded the whole `mappings` string on every call. Measured on the biggest
 * map in a `www.chaingpt.org` archive — 531,045 characters, 99,485 segments — one decode is 29ms
 * and six lookups cost **111ms**, because each one paid for the decode again. A page with six
 * shaders resolves them all against the same map.
 *
 * A `WeakMap` rather than a cache with a policy: the entry lives exactly as long as the caller
 * holds the map, and nothing has to decide when to evict.
 */
const decoded = new WeakMap<SourceMap, Segment[]>();

function segmentsOf(map: SourceMap): Segment[] {
  const cached = decoded.get(map);
  if (cached !== undefined) return cached;
  const segments = decodeMappings(map.mappings);
  decoded.set(map, segments);
  return segments;
}

export function originalPositionFor(
  map: SourceMap,
  line: number,
  column: number,
): OriginalPosition | undefined {
  const targetLine = line - 1;
  const targetColumn = column - 1;
  let best: Segment | undefined;
  for (const segment of segmentsOf(map)) {
    if (segment.generatedLine !== targetLine) continue;
    if (segment.generatedColumn > targetColumn) break;
    best = segment;
  }
  if (best === undefined || best.sourceIndex < 0) return undefined;
  const source = map.sources[best.sourceIndex];
  if (source === undefined) return undefined;
  return {
    source,
    line: best.sourceLine + 1,
    column: best.sourceColumn + 1,
    name: best.nameIndex >= 0 ? (map.names?.[best.nameIndex] ?? "") : "",
  };
}

/**
 * The original text around a **1-based** line, from `sourcesContent`.
 *
 * Returns nothing when the map does not carry that source's text. A map without `sourcesContent`
 * is common and is not an error — it means the citation can name a file and a line but cannot show
 * them, and saying so beats fetching something from the network and calling it the original.
 */
export function sourceExcerpt(
  map: SourceMap,
  source: string,
  line: number,
  context: number,
): ExcerptLine[] {
  const index = map.sources.indexOf(source);
  if (index === -1) return [];
  const content = map.sourcesContent?.[index];
  if (typeof content !== "string") return [];
  const lines = content.split("\n");
  const first = Math.max(1, line - context);
  const last = Math.min(lines.length, line + context);
  const excerpt: ExcerptLine[] = [];
  for (let current = first; current <= last; current += 1) {
    excerpt.push({ line: current, text: lines[current - 1]! });
  }
  return excerpt;
}

/**
 * The whole chain: a runtime frame to a cited source position with the text around it.
 *
 * Returns nothing when the position does not resolve. An excerpt with no position would be a
 * citation of nowhere, and a position the map declined to give is not improved by attaching text.
 */
export function resolveFrame(
  map: SourceMap,
  frame: Frame,
  context: number,
): ResolvedFrame | undefined {
  const position = originalPositionFor(map, frame.line, frame.column);
  if (position === undefined) return undefined;
  return { ...position, excerpt: sourceExcerpt(map, position.source, position.line, context) };
}

/**
 * Read a sourcemap document. Returns nothing for anything that is not one, because this parses
 * bytes fetched from a site nobody controls and a throw here would end a capture over an artifact
 * that is supplemental.
 */
export function parseSourceMap(text: string): SourceMap | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const map = parsed as Record<string, unknown>;
  if (map.version !== 3) return undefined;
  if (!Array.isArray(map.sources) || !map.sources.every((s) => typeof s === "string")) {
    return undefined;
  }
  if (typeof map.mappings !== "string") return undefined;
  return parsed as SourceMap;
}
