/**
 * The `replay_page` tool (#133). Opens an archived page again with the network unplugged and
 * reports what an agent can act on: whether the archive served everything, and whether the page's
 * motion actually ran.
 *
 * It owns launching the browser, which `replayArchive` deliberately does not — same split as
 * `capture_page`, and the same reason: a test drives the plain function with no browser at all.
 * **Node only** (ADR 0001).
 */

import { replayArchive, type ReplayBrowser } from "../../replay/replay.ts";

export interface ReplayPageParams {
  /** Path to a published archive directory. */
  archive: string;
}

export interface ReplayPageResult {
  /** The original URL, navigated again. */
  url: string;
  /**
   * Requests the archive could not serve. **Empty is the whole point** — a non-empty list names
   * exactly what is missing, and means this replay is not a faithful one.
   */
  aborted: string[];
  /**
   * Motion observed running after load. Counts, not a description: describing how the page moves
   * is extract's job, and this only answers whether it moves at all.
   */
  motion: { cssKeyframes: number; waapi: number; gsapTweens: number; scrollTriggers: number };
}

export interface ReplayLauncher {
  launch(): Promise<ReplayBrowser & { close(): Promise<void> }>;
}

export async function replayPage(
  params: ReplayPageParams,
  launcher: ReplayLauncher,
): Promise<ReplayPageResult> {
  const browser = await launcher.launch();
  try {
    const replay = await replayArchive({ archive: params.archive, browser });
    try {
      const motion = await replay.page.evaluate(() => {
        const win = globalThis as unknown as {
          gsap?: { globalTimeline: { getChildren(): unknown[] } };
          ScrollTrigger?: { getAll(): unknown[] };
          document: Document;
        };
        const animations = win.document.getAnimations();
        return {
          cssKeyframes: animations.filter((a) => a.constructor.name === "CSSAnimation").length,
          waapi: animations.filter((a) => a.constructor.name === "Animation").length,
          gsapTweens: win.gsap?.globalTimeline.getChildren().length ?? 0,
          scrollTriggers: win.ScrollTrigger?.getAll().length ?? 0,
        };
      });
      return { url: replay.url, aborted: replay.aborted, motion };
    } finally {
      await replay.close();
    }
  } finally {
    await browser.close();
  }
}
