/**
 * The `extract_behaviour` tool (#135). Replays the archive and reports what moves and what drives
 * it — the other half of the north star, after `replay_page` establishes that it moves at all.
 *
 * Owns launching the browser, like the other browser tools. **Node only** (ADR 0001).
 */

import { extractBehaviour, type BehaviourGraph } from "../../extract/behaviour.ts";
import { replayArchive } from "../../replay/replay.ts";
import type { ReplayLauncher } from "./replay-page.ts";

export interface ExtractBehaviourParams {
  archive: string;
}

export async function extractBehaviourFromArchive(
  params: ExtractBehaviourParams,
  launcher: ReplayLauncher,
): Promise<BehaviourGraph & { aborted: string[] }> {
  const browser = await launcher.launch();
  try {
    const replay = await replayArchive({ archive: params.archive, browser });
    try {
      const graph = await extractBehaviour(replay);
      // The aborted list travels with the graph on purpose: a graph extracted from a replay that
      // could not serve everything describes a page that did not fully run, and a caller reading
      // the nodes without that number would not know.
      return { ...graph, aborted: replay.aborted };
    } finally {
      await replay.close();
    }
  } finally {
    await browser.close();
  }
}
