/**
 * Extract — what moves on the page, and what drives it (#135, P4).
 *
 * It runs against a **live replay page**, not against the HAR. That is the whole reason replay
 * comes first: a GSAP timeline is not written down anywhere in the archive, it exists only once
 * the page's own JavaScript has built it. Reading the HAR could only ever recover the source text
 * that *might* create motion; running the page recovers the motion that *did*.
 *
 * Deterministic and re-runnable because replay is: the same archive produces the same graph.
 */

import type { ReplayHandle } from "../replay/replay.ts";

export const BEHAVIOUR_SCHEMA_VERSION = 1;

export type BehaviourMechanism =
  | "css-keyframes"
  | "waapi"
  | "gsap-timeline"
  | "gsap-scrolltrigger";

export interface BehaviourNode {
  mechanism: BehaviourMechanism;
  /**
   * A selector that resolves to the animated element in the replayed page, or `<non-element>` for
   * a target that is not one — GSAP animates plain objects too.
   */
  target: string;
  /** What the page calls it — a `@keyframes` name, a tween id, or the empty string. */
  name: string;
  timing: { durationMs: number | null; delayMs: number | null; iterations: number | null };
  easing: string | null;
  /** The library that owns it, or "browser" for CSS and WAAPI. */
  library: string;
}

export interface BehaviourGraph {
  schemaVersion: typeof BEHAVIOUR_SCHEMA_VERSION;
  url: string;
  nodes: BehaviourNode[];
  /** Mechanisms present, so a caller can compare against what a page was expected to declare. */
  mechanisms: BehaviourMechanism[];
}

/**
 * Runs inside the page. Kept as one function because it is serialized across the CDP boundary:
 * anything it closes over is not available on the other side.
 */
/* eslint-disable */
function collectInPage(): Omit<BehaviourGraph, "schemaVersion" | "url"> {
  const win = globalThis as unknown as {
    gsap?: { globalTimeline: { getChildren(): unknown[] } };
    ScrollTrigger?: { getAll(): unknown[] };
    document: Document;
  };

  /** A selector that resolves back to this element. Prefers the fixture's own stable marker. */
  const selectorFor = (element: Element | null | undefined): string => {
    if (!element) return "";
    // GSAP tweens plain objects as happily as elements — a progress value, a camera, a counter.
    // That is real behaviour with no selector, and saying so beats dropping it or inventing one.
    if (typeof (element as { tagName?: unknown }).tagName !== "string") return "<non-element>";
    const fixtureId = element.getAttribute?.("data-fixture-id");
    if (fixtureId) return `[data-fixture-id='${fixtureId}']`;
    if (element.id) return `#${element.id}`;
    const classes = element.className;
    if (typeof classes === "string" && classes.trim().length > 0) {
      return `${element.tagName.toLowerCase()}.${classes.trim().split(/\s+/).join(".")}`;
    }
    return element.tagName ? element.tagName.toLowerCase() : "";
  };

  const nodes: BehaviourNode[] = [];

  for (const animation of win.document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    const timing = effect?.getComputedTiming?.();
    const isCss = animation.constructor.name === "CSSAnimation";
    nodes.push({
      mechanism: isCss ? "css-keyframes" : "waapi",
      target: selectorFor(effect?.target ?? null),
      name: (animation as { animationName?: string }).animationName ?? animation.id ?? "",
      timing: {
        durationMs: typeof timing?.duration === "number" ? timing.duration : null,
        delayMs: typeof timing?.delay === "number" ? timing.delay : null,
        iterations:
          typeof timing?.iterations === "number" && Number.isFinite(timing.iterations)
            ? timing.iterations
            : null,
      },
      easing: timing?.easing ?? null,
      library: "browser",
    });
  }

  // `getChildren()` returns the timeline's direct children, and a child may itself be a timeline —
  // the fixture declares exactly that: `gsap.timeline()` with three tweens inside it. Only the
  // leaves carry targets, so a non-recursive walk reports a node that animates nothing.
  const walkGsap = (children: unknown[]): void => {
    for (const child of children) {
      const node = child as {
        targets?: () => Element[];
        getChildren?: () => unknown[];
        duration?: () => number;
        delay?: () => number;
        vars?: { ease?: unknown; repeat?: unknown };
      };
      if (typeof node.getChildren === "function") {
        walkGsap(node.getChildren());
        continue;
      }
      const targets = typeof node.targets === "function" ? node.targets() : [];
      if (targets.length === 0) continue;
      for (const target of targets) {
        nodes.push({
          mechanism: "gsap-timeline",
          target: selectorFor(target),
          name: "",
          timing: {
            durationMs: typeof node.duration === "function" ? node.duration() * 1000 : null,
            delayMs: typeof node.delay === "function" ? node.delay() * 1000 : null,
            iterations: typeof node.vars?.repeat === "number" ? node.vars.repeat + 1 : 1,
          },
          easing: typeof node.vars?.ease === "string" ? node.vars.ease : null,
          library: "gsap",
        });
      }
    }
  };
  walkGsap(win.gsap?.globalTimeline.getChildren() ?? []);

  for (const instance of win.ScrollTrigger?.getAll() ?? []) {
    const trigger = instance as { trigger?: Element; vars?: { start?: unknown; end?: unknown } };
    nodes.push({
      mechanism: "gsap-scrolltrigger",
      target: selectorFor(trigger.trigger),
      name: `${String(trigger.vars?.start ?? "")} → ${String(trigger.vars?.end ?? "")}`,
      timing: { durationMs: null, delayMs: null, iterations: null },
      easing: null,
      library: "gsap/ScrollTrigger",
    });
  }

  const mechanisms = [...new Set(nodes.map((node) => node.mechanism))];
  return { nodes, mechanisms };
}
/* eslint-enable */

export async function extractBehaviour(replay: ReplayHandle): Promise<BehaviourGraph> {
  const collected = await replay.page.evaluate(collectInPage);
  return { schemaVersion: BEHAVIOUR_SCHEMA_VERSION, url: replay.url, ...collected };
}
