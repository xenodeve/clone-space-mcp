/**
 * The reproducer for #187 — **Node only** (ADR 0001).
 *
 *     node scripts/replay-height-race.ts https://labs.chaingpt.org/ 3 3
 *
 * Two replays of one archive can lay the page out to different heights. This captures N archives
 * of a URL, replays each M times, and prints whether the heights agree within each archive.
 *
 * It exists because the effect is **intermittent, at roughly one replay in three**, and thirteen
 * replays that all agree is an unremarkable draw at that rate rather than evidence the effect has
 * gone — which is how a session can conclude it does not reproduce and stop.
 *
 * Measured 2026-08-16 on `https://labs.chaingpt.org/`, three archives, three replays each:
 *
 *     live heights: 8544 8544 8544
 *     archive 0  replay heights 8544 8486 8544   SPLIT within the archive
 *     archive 1  replay heights 8544 8486 8486   SPLIT within the archive
 *     archive 2  replay heights 8544 8544 8544   AGREED within the archive
 *
 * **The split is inside a single archive**, which refuted the hypothesis that the state belongs to
 * the capture and made this a per-replay race. Live is 8544 on every load and 8544 is the majority
 * replay value, so 8486 is the defect state rather than the reference one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { captureHar } from "../src/capture/record.ts";
import { replayArchive } from "../src/replay/replay.ts";

const url = process.argv[2] ?? "https://labs.chaingpt.org/";
const archives = Number(process.argv[3] ?? 3);
const replaysEach = Number(process.argv[4] ?? 3);
const SETTLE_MS = 9000;

const read = () => ({
  height: document.documentElement.scrollHeight,
  elements: document.querySelectorAll("*").length,
});

const browser = await chromium.launch();
const dir = mkdtempSync(join(tmpdir(), "probe-187-arch-"));
try {
  // Live, for the reference value.
  const liveHeights: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const context = await browser.newContext({});
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(SETTLE_MS);
    liveHeights.push((await page.evaluate(read)).height);
    await context.close();
  }
  console.log(`live heights: ${liveHeights.join(" ")}`);

  for (let a = 0; a < archives; a += 1) {
    const archive = join(dir, `archive-${a}`);
    await captureHar({ browser: browser as never, url, outDir: archive });
    const heights: number[] = [];
    for (let r = 0; r < replaysEach; r += 1) {
      const handle = await replayArchive({ archive, browser: browser as never });
      try {
        // `ReplayPage` is the narrow structural type replay declares; the real Playwright page
        // behind it has the timing helpers.
        const page = handle.page as unknown as {
          waitForTimeout(ms: number): Promise<void>;
          evaluate<Result>(fn: () => Result): Promise<Result>;
        };
        await page.waitForTimeout(SETTLE_MS);
        heights.push((await page.evaluate(read)).height);
      } finally {
        await handle.close();
      }
    }
    const distinct = new Set(heights);
    console.log(
      `archive ${a}  replay heights ${heights.join(" ")}  ` +
        (distinct.size === 1 ? "AGREED within the archive" : "SPLIT within the archive"),
    );
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
