/**
 * The `extract_behaviour` tool (#135). Replays the archive and reports what moves and what drives
 * it — the other half of the north star, after `replay_page` establishes that it moves at all.
 *
 * Owns launching the browser, like the other browser tools. **Node only** (ADR 0001).
 */

import { extractBehaviour, type BehaviourGraph } from "../../extract/behaviour.ts";
import { replayArchive } from "../../replay/replay.ts";
import type { ReplayLauncher } from "./replay-page.ts";
import { parseStackFrames, type StackFrame } from "../../capture/instrument.ts";
import { indexArchiveSources } from "../../extract/archive-sources.ts";
import type { ResolvedFrame } from "../../extract/sourcemap.ts";

/** How much of one shader's GLSL travels in a tool result before it is truncated. */
const SHADER_EXCERPT = 8_000;

/**
 * What the page *did*, as an agent can act on it (#173).
 *
 * Summarised rather than raw: one page produced 1,510 listener registrations, and handing that
 * back whole spends a caller's context on repetition. Counts by type answer the question the raw
 * list was going to be reduced to anyway.
 */
export interface ObservedSummary {
  /**
   * Compiled shaders, with the frame that compiled each — the "which line" half of the goal.
   *
   * `origin` is where the runtime says the call came from, in the coordinates of the file the
   * browser loaded: `three.module.min.js:12:326662`, which names line 12 of a file with about
   * fifteen lines and tells a reader nothing. `source` is that same point resolved through a
   * sourcemap the archive captured — a real file, a real line, and the text written on it.
   *
   * It is absent whenever the archive holds no usable map for that script. That is the common
   * case, and saying nothing is the point: the alternative is a citation nobody can check.
   */
  shaders: {
    chars: number;
    source: string;
    truncated: boolean;
    origin?: StackFrame;
    original?: ResolvedFrame;
  }[];
  /** Script URLs in the archive that carry a usable sourcemap. */
  mappedScripts: string[];
  /** Canvas realms the page asked for, by kind: `2d`, `webgl`, `webgl2`, `bitmaprenderer`. */
  canvasContexts: Record<string, number>;
  /** The interaction surface, by event type. **Registration evidence, never behaviour.** */
  listeners: Record<string, number>;
  /** Observations the bounded in-page buffer dropped. Non-zero means this summary is partial. */
  dropped: number;
}

export interface ExtractBehaviourParams {
  archive: string;
}

export async function extractBehaviourFromArchive(
  params: ExtractBehaviourParams,
  launcher: ReplayLauncher,
): Promise<BehaviourGraph & { aborted: string[]; observed: ObservedSummary }> {
  const browser = await launcher.launch();
  try {
    // Instrumented on purpose. The graph says what moves; the observation layer says what the page
    // does — the shader it assembled at runtime, the canvas realms it opened, the interaction
    // surface it registered. Neither is reachable from the other.
    const replay = await replayArchive({ archive: params.archive, browser, instrument: true });
    try {
      const graph = await extractBehaviour(replay);
      const drained = await replay.drainObservations();
      const canvasContexts: Record<string, number> = {};
      const listeners: Record<string, number> = {};
      // Read from the archive, never fetched. A map the capture did not take cannot be obtained
      // later, and reaching for the network would make an offline artifact depend on the site.
      const sources = await indexArchiveSources(params.archive);
      const shaders: ObservedSummary["shaders"] = [];
      for (const observation of drained.observations) {
        if (observation.type === "canvas-context") {
          const kind = String(observation.detail.kind ?? "unknown");
          canvasContexts[kind] = (canvasContexts[kind] ?? 0) + 1;
        } else if (observation.type === "listener") {
          const type = String(observation.detail.type ?? "unknown");
          listeners[type] = (listeners[type] ?? 0) + 1;
        } else if (observation.type === "shader") {
          const source = String(observation.detail.source ?? "");
          // The innermost readable frame. Absent rather than invented when the stack names no
          // coordinate — a guessed origin is a fabricated citation.
          const origin = parseStackFrames(observation.stack)[0];
          shaders.push({
            chars: source.length,
            source: source.slice(0, SHADER_EXCERPT),
            truncated: source.length > SHADER_EXCERPT,
            origin,
            original:
              origin === undefined
                ? undefined
                : sources.resolve(origin.url, origin.line, origin.column),
          });
        }
      }
      const observed: ObservedSummary = {
        shaders,
        mappedScripts: sources.mapped,
        canvasContexts,
        listeners,
        dropped: drained.dropped,
      };
      // The aborted list travels with the graph on purpose: a graph extracted from a replay that
      // could not serve everything describes a page that did not fully run, and a caller reading
      // the nodes without that number would not know.
      return { ...graph, aborted: replay.aborted, observed };
    } finally {
      await replay.close();
    }
  } finally {
    await browser.close();
  }
}
