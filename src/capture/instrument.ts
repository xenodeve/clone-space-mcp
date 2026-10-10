/**
 * Slice 1 of #169 (issue #173) — the observation layer.
 *
 * The pipeline can already say *what moves*. This is what lets it say *how, and from where*: hooks
 * installed before any page script runs, recording what the page **does** rather than what it
 * shipped. A WebGL shader is the sharpest case — the GLSL is assembled at runtime from strings and
 * uniforms, so it exists in no archived file, and no reader of files can ever produce it. Measured
 * on `https://www.chaingpt.org/`, replayed offline: **82,613 characters of GLSL**, 9 canvas
 * contexts, and 1,510 `addEventListener` registrations.
 *
 * **The stack is in the schema from the first version, on purpose.** Adding it later would leave
 * every observation recorded before that day unresolvable, and re-capturing a site is not free.
 * With it, `gl.shaderSource` resolved from `three.module.min.js:12:326662` to
 * `three@0.151.2/build/three.module.js:18723:4` — which is the whole of "which line".
 *
 * Hooking at the **browser API layer** rather than at a library is what makes this hold: `THREE`
 * was not a global on that page — it loads as an ES module — and every shader was still captured,
 * because everything must pass through WebGL eventually.
 *
 * This module is the pure schema and parser half, in the shape `transcript.ts` already uses. The
 * in-page scripts are strings here; installing them is the caller's job.
 */

export const INSTRUMENT_SCHEMA_VERSION = 1;
export const INSTRUMENT_FILE_NAME = "instrumentation.json";

export type ObservationType = "shader" | "canvas-context" | "listener";

export interface Observation {
  seq: number;
  ts: number;
  type: ObservationType;
  detail: Record<string, unknown>;
  /** The raw stack captured at the call. Resolving it is slice 6; carrying it is this slice. */
  stack: string;
}

export interface InstrumentationV1 {
  schemaVersion: 1;
  /** How many observations the bounded buffer dropped. A gap in `seq` must be explained by this. */
  droppedObservations: number;
  observations: Observation[];
}

export interface StackFrame {
  url: string;
  line: number;
  column: number;
}

/**
 * Frames a stack names, innermost first.
 *
 * Only `http(s)` frames with a line and column are returned. A frame this cannot read — `eval`,
 * `<anonymous>`, a `node:` internal — names no coordinate, and inventing one would be the
 * fabricated citation the pipeline plan refuses by name. Dropping it is the honest answer, and it
 * is what lets slice 6 report `generated-source` instead of guessing an original.
 */
export function parseStackFrames(stack: string | undefined): StackFrame[] {
  if (typeof stack !== "string" || stack.length === 0) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = /(https?:\/\/[^\s)]+?):(\d+):(\d+)/.exec(line);
    if (match === null) continue;
    frames.push({ url: match[1]!, line: Number(match[2]), column: Number(match[3]) });
  }
  return frames;
}

/** What the in-page drain returned, read defensively — the page is not a trusted producer. */
export function drainedObservations(value: unknown): {
  observations: Observation[];
  dropped: number;
} {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const raw = Array.isArray(record.observations) ? record.observations : [];
  const observations: Observation[] = [];
  for (const candidate of raw) {
    const entry = typeof candidate === "object" && candidate !== null ? (candidate as Record<string, unknown>) : {};
    // Without a sequence number an entry cannot be placed, and a loss involving it cannot be
    // detected. It is not an observation.
    if (typeof entry.seq !== "number") continue;
    observations.push({
      seq: entry.seq,
      ts: typeof entry.ts === "number" ? entry.ts : 0,
      type: (entry.type as ObservationType) ?? "listener",
      detail: typeof entry.detail === "object" && entry.detail !== null ? (entry.detail as Record<string, unknown>) : {},
      stack: typeof entry.stack === "string" ? entry.stack : "",
    });
  }
  return { observations, dropped: typeof record.dropped === "number" ? record.dropped : 0 };
}

export function validateInstrumentation(doc: unknown): { ok: true } | { ok: false } {
  if (typeof doc !== "object" || doc === null) return { ok: false };
  const record = doc as Record<string, unknown>;
  if (record.schemaVersion !== INSTRUMENT_SCHEMA_VERSION) return { ok: false };
  if (typeof record.droppedObservations !== "number" || record.droppedObservations < 0) {
    return { ok: false };
  }
  if (!Array.isArray(record.observations)) return { ok: false };

  let previous: number | undefined;
  let gap = 0;
  for (const candidate of record.observations) {
    const entry = candidate as Record<string, unknown>;
    if (typeof entry?.seq !== "number" || typeof entry.stack !== "string") return { ok: false };
    if (previous !== undefined) {
      if (entry.seq <= previous) return { ok: false };
      gap += entry.seq - previous - 1;
    }
    previous = entry.seq;
  }
  // A gap in `seq` is a loss. Accepting one the drop counter does not account for would make the
  // loss silent, which is the single property the counter exists to prevent.
  if (gap > record.droppedObservations) return { ok: false };
  return { ok: true };
}

export const INSTRUMENT_GLOBAL = "__i";

/**
 * Installed before any page script. The buffer is capped and the oldest is dropped on overflow,
 * bumping an explicit counter — the same bargain `transcript.ts` makes, for the same reason: a
 * detectable loss beats an unbounded array on a page that never stops drawing.
 */
export const INSTRUMENT_INIT_SCRIPT = `(() => {
  var CAP = 5000;
  var s = { seq: 0, dropped: 0, observations: [] };
  globalThis.${INSTRUMENT_GLOBAL} = s;
  var note = function (type, detail) {
    s.seq += 1;
    if (s.observations.length >= CAP) { s.observations.shift(); s.dropped += 1; }
    s.observations.push({
      seq: s.seq,
      ts: Math.round(performance.now()),
      type: type,
      detail: detail,
      stack: (new Error()).stack || ""
    });
  };
  [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext].forEach(function (ctor) {
    if (!ctor) return;
    var original = ctor.prototype.shaderSource;
    ctor.prototype.shaderSource = function (shader, source) {
      note("shader", { length: (source || "").length, source: source });
      return original.apply(this, arguments);
    };
  });
  var getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind) {
    note("canvas-context", { kind: kind });
    return getContext.apply(this, arguments);
  };
  var add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type) {
    note("listener", { type: type, target: (this && this.tagName) || String(this) });
    return add.apply(this, arguments);
  };
})();`;

export const INSTRUMENT_DRAIN_SCRIPT = `(() => {
  var s = globalThis.${INSTRUMENT_GLOBAL};
  if (!s) return { observations: [], dropped: 0 };
  var out = { observations: s.observations, dropped: s.dropped };
  s.observations = [];
  return out;
})();`;

export const PROVENANCE_GLOBAL = "__wap";

/**
 * Where each animation was created (#215), recorded for `src/extract/provenance.ts`. Installed by
 * `replayArchive({ instrument: true })` before any page script.
 *
 * **Kept out of `INSTRUMENT_INIT_SCRIPT` on purpose.** The equivalence gate installs that script on
 * the live page to measure whether instrumentation perturbs it (`src/equivalence/run.ts`), and
 * wrapping GSAP there would change what that control measures without anything saying so.
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
