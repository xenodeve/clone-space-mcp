/**
 * Where each animation was **created** (#215) — the "which line" half of *"what makes the hero
 * move?"*, for motion rather than shaders.
 *
 * The graph reads animations out of registries — `document.getAnimations()`, GSAP's global
 * timeline — and a registry remembers what exists, not who made it. So the creation call is
 * observed as it happens, by `PROVENANCE_INIT_SCRIPT` in `src/capture/instrument.ts`, which keys
 * each recorded stack by the object created. `collectInPage` looks each node's object up; this
 * module turns the stack it found into a citation.
 */

import { parseStackFrames, type StackFrame } from "../capture/instrument.ts";
import type { ResolvedFrame } from "./sourcemap.ts";

/**
 * A node's citation, at the level the deep-comprehension plan's §6 defines. A level is never
 * promoted: `original-source` only when an archived map resolved the frame.
 */
export interface NodeSource {
  provenance: "original-source" | "generated-source";
  /** The position in the file the browser actually loaded. Always kept, even when resolved. */
  generated: StackFrame;
  /** The same point carried back through a sourcemap the archive captured. */
  original?: ResolvedFrame;
}

/**
 * The frame that created the motion: the innermost readable one that is not inside a library
 * script. **Absent rather than invented** when nothing qualifies — a guessed origin is the
 * fabricated citation the pipeline plan refuses by name.
 */
export function creationFrame(stack: string | undefined, libraries: readonly string[]): StackFrame | undefined {
  return parseStackFrames(stack).find((frame) => !libraries.includes(frame.url));
}

/** Cite a generated frame, resolving it through the archive's maps when one covers it. */
export function citeFrame(
  generated: StackFrame | undefined,
  resolve: (url: string, line: number, column: number) => ResolvedFrame | undefined,
): NodeSource | undefined {
  if (generated === undefined) return undefined;
  const original = resolve(generated.url, generated.line, generated.column);
  return original === undefined
    ? { provenance: "generated-source", generated }
    : { provenance: "original-source", generated, original };
}
