/**
 * Index an archive's sourcemaps, so a runtime position can be cited in original coordinates
 * (#178, slice 6 of #169).
 *
 * `src/extract/sourcemap.ts` resolves a position **given** a map. This is the half that finds the
 * map: it reads the captured HAR, follows each script's `sourceMappingURL` to the response the
 * capture actually fetched, and parses it. Nothing is fetched here — an archive that did not
 * capture a map cannot produce one later, and going to the network would make an offline artifact
 * quietly depend on the site still being up.
 *
 * **A HAR is captured from a site nobody controls**, so every path it names is untrusted. A body
 * stored as a sibling file is read only when it resolves inside the archive root; a `_file` of
 * `../../../etc/passwd` reads nothing.
 */

import { readFile } from "node:fs/promises";
import { relative, resolve as resolvePath } from "node:path";
import { parseSourceMap, resolveFrame, type ResolvedFrame, type SourceMap } from "./sourcemap.ts";

/** Lines of original source shown either side of a cited line. */
const EXCERPT_CONTEXT = 2;

export interface SourceIndex {
  /**
   * Cite a **1-based** generated position in `url`. Returns nothing when the archive holds no
   * usable map for that script, which is the common case and not an error.
   */
  resolve(url: string, line: number, column: number): ResolvedFrame | undefined;
  /** Script URLs that got a usable map. A miss is visible here rather than silently absent. */
  mapped: string[];
}

interface HarEntry {
  request?: { url?: unknown };
  response?: { redirectURL?: unknown; content?: { text?: unknown; _file?: unknown } };
}

/** Redirect hops followed before giving up, so a cycle in a captured HAR cannot spin. */
const MAX_REDIRECT_HOPS = 10;

function entriesOf(har: unknown): HarEntry[] {
  const log = (har as { log?: { entries?: unknown } } | undefined)?.log;
  return Array.isArray(log?.entries) ? (log.entries as HarEntry[]) : [];
}

/** Read a body, inline or from a sibling file that must resolve inside the archive. */
async function bodyOf(root: string, entry: HarEntry): Promise<string | undefined> {
  const content = entry.response?.content;
  if (typeof content?.text === "string") return content.text;
  if (typeof content?._file !== "string") return undefined;
  const path = resolvePath(root, content._file);
  const inside = relative(root, path);
  if (inside === "" || inside.startsWith("..") || resolvePath(root, inside) !== path) return undefined;
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The **last** `sourceMappingURL` in the body. A bundler appends its declaration at the end, and a
 * string literal earlier in the file can contain the same text — taking the first would let any
 * script point this at a map of its choosing.
 */
function declaredMapUrl(body: string): string | undefined {
  const matches = [...body.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)/g)];
  return matches.at(-1)?.[1];
}

function decodeDataUrl(url: string): string | undefined {
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (match === null) return undefined;
  const payload = match[2]!;
  try {
    return match[1] === undefined
      ? decodeURIComponent(payload)
      : Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

export async function indexArchiveSources(archiveRoot: string): Promise<SourceIndex> {
  let har: unknown;
  try {
    har = JSON.parse(await readFile(resolvePath(archiveRoot, "network.har"), "utf8"));
  } catch {
    return { resolve: () => undefined, mapped: [] };
  }

  const bodies = new Map<string, string>();
  const redirects = new Map<string, string>();
  for (const entry of entriesOf(har)) {
    const url = entry.request?.url;
    if (typeof url !== "string") continue;
    const target = entry.response?.redirectURL;
    if (typeof target === "string" && target !== "") redirects.set(url, target);
    const body = await bodyOf(archiveRoot, entry);
    if (body !== undefined) bodies.set(url, body);
  }

  const maps = new Map<string, SourceMap>();
  for (const [url, body] of bodies) {
    const declared = declaredMapUrl(body);
    if (declared === undefined) continue;
    const text = declared.startsWith("data:")
      ? decodeDataUrl(declared)
      : bodies.get(new URL(declared, url).href);
    if (text === undefined) continue;
    const map = parseSourceMap(text);
    if (map !== undefined) maps.set(url, map);
  }

  // A stack names the URL the page **asked for**, and a CDN often answers a redirect. Measured on
  // `www.chaingpt.org`: the page requests `https://unpkg.com/@rive-app/canvas@2.35.0`, unpkg answers
  // 301 to `.../rive.js`, and the map lives there. Indexing only the final URL left 2 of that
  // site's 6 shaders with a map in the archive and no citation.
  for (const [from] of redirects) {
    if (maps.has(from)) continue;
    let current = from;
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
      const next = redirects.get(current);
      if (next === undefined || next === current) break;
      current = next;
      const map = maps.get(current);
      if (map !== undefined) {
        maps.set(from, map);
        break;
      }
    }
  }

  return {
    mapped: [...maps.keys()],
    resolve: (url, line, column) => {
      const map = maps.get(url);
      return map === undefined ? undefined : resolveFrame(map, { line, column }, EXCERPT_CONTEXT);
    },
  };
}
