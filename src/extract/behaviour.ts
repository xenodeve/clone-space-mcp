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

export const BEHAVIOUR_SCHEMA_VERSION = 2;

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
  /**
   * What a ScrollTrigger actually does (#167). Present only for `gsap-scrolltrigger`.
   *
   * Measured before this existed: all eight ScrollTrigger nodes on `https://labs.chaingpt.org/`
   * reported `dur null · delay null · ease null` and nothing else, because `timing` and `easing`
   * describe a tween and a ScrollTrigger is not one. "There is a ScrollTrigger on this h2" names
   * the mechanism and stops — the same class of answer as "the page loads gsap.min.js".
   *
   * `start` and `end` decide where on the page anything happens; `scrub` is the difference between
   * a scrubbed sequence and a reveal; `pin` is the most visible behaviour on a modern landing
   * page; `toggleActions` says what happens on enter, leave, enter-back and leave-back.
   */
  scrollTrigger?: {
    start: string | null;
    end: string | null;
    scrub: boolean | number | null;
    pin: boolean | string | null;
    toggleActions: string | null;
    /** The element that triggers it, which is frequently not the element that animates. */
    triggerTarget: string;
  };
}

export interface BehaviourGraph {
  schemaVersion: typeof BEHAVIOUR_SCHEMA_VERSION;
  url: string;
  nodes: BehaviourNode[];
  /** Mechanisms present, so a caller can compare against what a page was expected to declare. */
  mechanisms: BehaviourMechanism[];
  /**
   * Motion the page carries that this graph has **no node for**, counted rather than described.
   *
   * A node count reads as completeness unless something says otherwise, and this graph is not
   * complete by construction: it reports what `document.getAnimations()` knows plus GSAP's own
   * registries. **A CSS transition is in neither.** It appears in `getAnimations()` only while it
   * is actually running, so a page whose motion is transitions fired by class changes — the
   * Tailwind and Framer idiom — is almost invisible here.
   *
   * Measured, both replayed and scrolled to the bottom:
   *
   * | | `www.firecrawl.dev` | `www.chaingpt.org` |
   * |---|---|---|
   * | nodes in this graph | 12 | 121 |
   * | `getAnimations()` | 12 | 12 |
   * | elements with a transition | **318** | **1,028** |
   *
   * The extractor is not missing anything the browser tracks — the first two rows match exactly.
   * The third row is the honest limit, and a caller that cannot see it would read "12 nodes" as
   * "this page barely animates", which is false.
   *
   * **Only the transition count is here, and a transformed-element count was removed rather than
   * shipped.** `transform` is animation *state*: counted twice a second apart on the fixture it
   * gave 4 and 5, because GSAP was mid-flight. A field that disagrees with itself is noise wearing
   * a measurement's clothes — the same lesson the equivalence gate's stability baseline exists for.
   * `transition-duration` is a static computed style and does not move.
   */
  unrepresented: {
    /** Elements whose computed `transition-duration` is non-zero. */
    cssTransitionElements: number;
  };
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
    getComputedStyle(element: Element): CSSStyleDeclaration;
  };

  /**
   * A selector that resolves to **exactly one** element in this document (#168).
   *
   * The field always claimed that and did not keep it. Measured on `https://labs.chaingpt.org/`:
   * 154 of 203 gsap-timeline nodes — 76% — reported `div`, because an element animated by GSAP
   * frequently has neither an id nor a class of its own. The class that positions it lives on a
   * parent, and the animated child is a bare element a splitting plugin produced, one per line.
   *
   * So every candidate is **verified against the document** before it is returned, and an ambiguous
   * one falls through to an ancestor path with `:nth-child` — walked upward only until the path is
   * unique, so the common case stays short and readable.
   */
  const resolvesToOne = (selector: string): boolean => {
    try {
      return win.document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  const ancestorPath = (element: Element): string => {
    const parts: string[] = [];
    let node: Element | null = element;
    while (node && typeof (node as { tagName?: unknown }).tagName === "string") {
      if (node.id) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const parent: Element | null = node.parentElement;
      let part = node.tagName.toLowerCase();
      if (parent) {
        part += `:nth-child(${Array.prototype.indexOf.call(parent.children, node) + 1})`;
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      if (resolvesToOne(candidate)) return candidate;
      node = parent;
    }
    return parts.join(" > ");
  };

  const selectorFor = (element: Element | null | undefined): string => {
    if (!element) return "";
    // GSAP tweens plain objects as happily as elements — a progress value, a camera, a counter.
    // That is real behaviour with no selector, and saying so beats dropping it or inventing one.
    if (typeof (element as { tagName?: unknown }).tagName !== "string") return "<non-element>";
    const fixtureId = element.getAttribute?.("data-fixture-id");
    if (fixtureId) {
      const marker = `[data-fixture-id='${fixtureId}']`;
      if (resolvesToOne(marker)) return marker;
    }
    if (element.id && resolvesToOne(`#${element.id}`)) return `#${element.id}`;
    const classes = element.className;
    if (typeof classes === "string" && classes.trim().length > 0) {
      const byClass = `${element.tagName.toLowerCase()}.${classes.trim().split(/\s+/).join(".")}`;
      if (resolvesToOne(byClass)) return byClass;
    }
    return ancestorPath(element);
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

  // `getChildren()` already flattens: its `nested` parameter defaults to true, so descendants of a
  // child timeline arrive here without any walking of our own. Measured — a recursive version was
  // written, and a corpus entry that disabled the recursion SURVIVED three times because there was
  // no behaviour to lose.
  //
  // The empty-targets skip below is defensive and, measured, currently unreachable: an entry that
  // disabled it also SURVIVED, because with `nested` defaulting to true this list contains only
  // leaf tweens and every one of them has a target. It is kept rather than deleted because the
  // cost is one comparison and the failure it prevents — a node that animates nothing and names no
  // element — is one a caller cannot tell apart from a real one. It is **not** claimed as proven.
  const walkGsap = (children: unknown[]): void => {
    for (const child of children) {
      const node = child as {
        targets?: () => Element[];
        getChildren?: () => unknown[];
        duration?: () => number;
        delay?: () => number;
        vars?: { ease?: unknown; repeat?: unknown };
      };
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
    const trigger = instance as {
      trigger?: Element;
      animation?: { targets?: () => Element[] };
      vars?: {
        start?: unknown;
        end?: unknown;
        scrub?: unknown;
        pin?: unknown;
        toggleActions?: unknown;
      };
    };
    const vars = trigger.vars ?? {};
    // The animated element, when the trigger drives one, is frequently not the trigger itself —
    // and the relationship between them is the point. Falling back to the trigger keeps `target`
    // meaning "the element this node is about" rather than sometimes meaning nothing.
    const animated = typeof trigger.animation?.targets === "function" ? trigger.animation.targets()[0] : undefined;
    nodes.push({
      mechanism: "gsap-scrolltrigger",
      target: selectorFor(animated ?? trigger.trigger),
      name: `${String(vars.start ?? "")} → ${String(vars.end ?? "")}`,
      // Left null on purpose: these describe a tween, and filling them for a mechanism that has
      // none is how eight nodes came to report `dur null` as though that were a measurement.
      timing: { durationMs: null, delayMs: null, iterations: null },
      easing: null,
      library: "gsap/ScrollTrigger",
      scrollTrigger: {
        start: typeof vars.start === "string" ? vars.start : null,
        end: typeof vars.end === "string" ? vars.end : null,
        scrub: typeof vars.scrub === "boolean" || typeof vars.scrub === "number" ? vars.scrub : null,
        pin: typeof vars.pin === "boolean" || typeof vars.pin === "string" ? vars.pin : null,
        toggleActions: typeof vars.toggleActions === "string" ? vars.toggleActions : null,
        triggerTarget: selectorFor(trigger.trigger),
      },
    });
  }

  // One pass, one getComputedStyle per element: what the graph cannot represent, counted so a
  // node count cannot read as completeness. See `unrepresented` on BehaviourGraph.
  let cssTransitionElements = 0;
  for (const element of win.document.querySelectorAll("*")) {
    const style = win.getComputedStyle(element);
    if (style.transitionDuration !== "" && style.transitionDuration !== "0s") {
      cssTransitionElements += 1;
    }
  }

  const mechanisms = [...new Set(nodes.map((node) => node.mechanism))];
  return { nodes, mechanisms, unrepresented: { cssTransitionElements } };
}
/* eslint-enable */

export async function extractBehaviour(replay: ReplayHandle): Promise<BehaviourGraph> {
  const collected = await replay.page.evaluate(collectInPage);
  return { schemaVersion: BEHAVIOUR_SCHEMA_VERSION, url: replay.url, ...collected };
}
