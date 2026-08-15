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
 * stored as a sibling file is read only when the path is relative, resolves inside the archive
 * root, is not a symbolic link, and is a regular file — the same four rules `src/capture/redact.ts`
 * applies to the same field. See `bodyOf` for why the first of those is not optional.
 */

import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
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
  response?: {
    redirectURL?: unknown;
    content?: { mimeType?: unknown; text?: unknown; _file?: unknown };
  };
}

/**
 * Media types that cannot be a script or a sourcemap, skipped before their body is read.
 *
 * Measured on a `www.chaingpt.org` archive: reading every body held **54.9M characters** for one
 * index call, including a 1.7MB `.wasm` and a 1.2MB document, to find 10 maps. None of it could
 * ever carry a `sourceMappingURL` this module would follow.
 */
const UNREADABLE_PREFIXES = ["image/", "video/", "audio/", "font/", "application/wasm"];

/** Redirect hops followed before giving up, so a cycle in a captured HAR cannot spin. */
const MAX_REDIRECT_HOPS = 10;

function entriesOf(har: unknown): HarEntry[] {
  const log = (har as { log?: { entries?: unknown } } | undefined)?.log;
  return Array.isArray(log?.entries) ? (log.entries as HarEntry[]) : [];
}

/**
 * Read a body, inline or from a sibling file.
 *
 * **The path checks match `src/capture/redact.ts:154` deliberately, rule for rule.** A first
 * version here checked only that `relative()` did not climb out, and a review plus a probe showed
 * that is not containment on Windows: `relative()` cannot express a path on another drive, so it
 * returns that absolute path unchanged, which does not start with `..` and round-trips through
 * `resolve`. With the repo on `D:`, a `_file` of `C:\Windows\win.ini` was **allowed**.
 *
 * So an absolute path is refused for being absolute, a symbolic link is refused, and the target
 * must be a regular file — the same three the redactor already applies to the same field. They are
 * duplicated rather than shared because `redact.ts` is a standing park condition in this repo;
 * extracting a common helper means unparking it, and is worth doing when that happens.
 *
 * **Of those, only two are load-bearing and only one is tested.** The absolute-path refusal has a
 * corpus entry. The `isFile` half is redundant with `readFile`, which already fails `EISDIR` — a
 * corpus entry written for it SURVIVED, and was deleted rather than kept as evidence of nothing.
 * The **symbolic-link refusal is the one that matters and has no test on this platform**: creating
 * a symlink here fails `EPERM` without elevation, measured. It is kept because a symlink is the
 * one shape `readFile` would happily follow out of the archive.
 *
 * Unlike the redactor this returns `undefined` rather than throwing: a map is supplemental
 * evidence, and one unreadable body must not end an extraction.
 */
async function bodyOf(root: string, entry: HarEntry): Promise<string | undefined> {
  const content = entry.response?.content;
  const mimeType = typeof content?.mimeType === "string" ? content.mimeType.toLowerCase() : "";
  if (UNREADABLE_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return undefined;
  if (typeof content?.text === "string") return content.text;
  if (typeof content?._file !== "string" || content._file.length === 0) return undefined;
  if (isAbsolute(content._file)) return undefined;
  const path = resolvePath(root, content._file);
  const inside = relative(root, path);
  if (inside === "" || inside.startsWith("..") || resolvePath(root, inside) !== path) return undefined;
  try {
    const attachment = await lstat(path);
    if (attachment.isSymbolicLink() || !attachment.isFile()) return undefined;
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
