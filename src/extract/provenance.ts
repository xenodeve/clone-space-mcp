/**
 * Where each animation was **created** (#215) — the "which line" half of *"what makes the hero
 * move?"*, for motion rather than shaders.
 *
 * The graph reads animations out of registries — `document.getAnimations()`, GSAP's global
 * timeline — and a registry remembers what exists, not who made it. So the creation call has to be
 * observed as it happens: this script is installed before any page script, records the stack of
 * every call that creates motion, and keys it by the object created. `collectInPage` looks each
 * node's object up afterwards.
 *
 * **Kept out of `INSTRUMENT_INIT_SCRIPT` on purpose.** The equivalence gate installs that script on
 * the live page to measure whether instrumentation perturbs it (`src/equivalence/run.ts`), and
 * wrapping GSAP there would change what that control measures without anything saying so.
 */

import { parseStackFrames, type StackFrame } from "../capture/instrument.ts";
import type { ResolvedFrame } from "./sourcemap.ts";

export const PROVENANCE_GLOBAL = "__wap";

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
 * Installed before any page script.
 *
 * GSAP is not there yet when this runs, so it watches `gsap` **arrive** on the global rather than
 * assuming it exists. GSAP 3 assigns that global even when loaded as an ES module
 * (`gsap-core.js` installs onto `window` when `window.gsap` is unset), which is why a getter that
 * reports `undefined` until the assignment is enough. The script that performs the assignment is
 * recorded as a library, so its own frames are skipped and the citation lands on the page's call.
 *
 * A tween created by a timeline method is not that method's return value — the timeline is. So a
 * timeline method tags every direct child not already tagged, which is exactly the one it added.
 */
export const PROVENANCE_INIT_SCRIPT = `(() => {
  var stacks = new WeakMap();
  var libraries = [];
  globalThis.${PROVENANCE_GLOBAL} = { stacks: stacks, libraries: libraries };
  var tag = function (object, stack) {
    if (object !== null && typeof object === "object" && !stacks.has(object)) stacks.set(object, stack);
  };
  var animate = Element.prototype.animate;
  if (typeof animate === "function") {
    Element.prototype.animate = function () {
      var animation = animate.apply(this, arguments);
      tag(animation, (new Error()).stack || "");
      return animation;
    };
  }
  var wrapped = new WeakSet();
  var wrapCreators = function (owner, names) {
    names.forEach(function (name) {
      var original = owner[name];
      if (typeof original !== "function") return;
      owner[name] = function () {
        var stack = (new Error()).stack || "";
        var result = original.apply(this, arguments);
        tag(result, stack);
        return result;
      };
    });
  };
  var wrapTimelineMethods = function (proto, names) {
    names.forEach(function (name) {
      var original = proto[name];
      if (typeof original !== "function") return;
      proto[name] = function () {
        var stack = (new Error()).stack || "";
        var result = original.apply(this, arguments);
        if (typeof this.getChildren === "function") {
          this.getChildren(false, true, true).forEach(function (child) { tag(child, stack); });
        }
        return result;
      };
    });
  };
  var adopt = function (gsap) {
    if (gsap === null || typeof gsap !== "object" || wrapped.has(gsap)) return;
    wrapped.add(gsap);
    wrapCreators(gsap, ["to", "from", "fromTo", "set", "delayedCall", "timeline"]);
    var timeline = gsap.core && gsap.core.Timeline;
    if (timeline && timeline.prototype) {
      wrapTimelineMethods(timeline.prototype, ["to", "from", "fromTo", "set", "call", "add"]);
    }
  };
  var current;
  try {
    Object.defineProperty(globalThis, "gsap", {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (value) {
        var script = document.currentScript;
        if (script && script.src && libraries.indexOf(script.src) < 0) libraries.push(script.src);
        current = value;
        adopt(value);
      }
    });
  } catch (error) {}
})();`;

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
