/**
 * #187 — grade `restoreTiming` against a **live** site, control and candidate in one session.
 * **Node only** (ADR 0001).
 *
 *     node scripts/live-height-race-graded.ts https://labs.chaingpt.org/ 1 12
 *
 * `scripts/fixture-height-race.ts` is the deterministic instrument; this is the live case it cannot
 * stand in for, because the fixture reproduces the *opposite direction* — there live is the
 * not-arrived state, here live is the resource-applied one.
 *
 * **The control runs in the same invocation as the candidate, and that is the whole design.** The
 * third candidate fix on this issue measured 15/15 at the live value and was reverted because its
 * control, run afterwards, was also clean: the defect had stopped reproducing and the fifteen
 * measured nothing. Here every archive is replayed with the flag off and on back to back, so a
 * window in which the defect is not reproducing shows up as a clean control and the run is
 * discarded rather than believed.
 *
 * Measured 2026-08-16 on `https://labs.chaingpt.org/`, two invocations, twenty replays each way:
 *
 *     live  8544x3
 *     archive 0  restoreTiming=false  8486x1 8544x3   1/4  off-live
 *     archive 0  restoreTiming=true   8544x4          0/4
 *     archive 1  restoreTiming=false  8486x1 8544x3   1/4  off-live
 *     archive 1  restoreTiming=true   8544x4          0/4
 *     archive 0  restoreTiming=false  8486x3 8544x9   3/12 off-live
 *     archive 0  restoreTiming=true   8544x12         0/12
 *
 * **5/20 against 0/20.** Read it as two counts and one stated calculation, not as a test result: if
 * the flag changed nothing, the twenty flagged replays would be draws from the same 25% rate, and
 * twenty clean has probability 0.75^20 = 0.3%.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { captureHar } from "../src/capture/record.ts";
import { replayArchive } from "../src/replay/replay.ts";

const url = process.argv[2] ?? "https://labs.chaingpt.org/";
const archives = Number(process.argv[3] ?? 2);
const each = Number(process.argv[4] ?? 4);
const SETTLE_MS = 9000;
const read = () => document.documentElement.scrollHeight;

const browser = await chromium.launch();
const dir = mkdtempSync(join(tmpdir(), "probe-187-graded-"));
const tally = (v: number[]) => {
  const m = new Map<number, number>();
  for (const x of v) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort((a, b) => a[0] - b[0]).map(([h, n]) => `${h}x${n}`).join(" ");
};
try {
  const live: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const c = await browser.newContext({});
    const p = await c.newPage();
    await p.goto(url, { waitUntil: "load" });
    await p.waitForTimeout(SETTLE_MS);
    live.push(await p.evaluate(read));
    await c.close();
  }
  console.log(`live  ${tally(live)}`);
  const liveSet = new Set(live);

  for (let a = 0; a < archives; a += 1) {
    const archive = join(dir, `a${a}`);
    await captureHar({ browser: browser as never, url, outDir: archive });
    for (const restoreTiming of [false, true]) {
      const heights: number[] = [];
      for (let r = 0; r < each; r += 1) {
        const h = await replayArchive({ archive, browser: browser as never, restoreTiming });
        try {
          const p = h.page as unknown as { waitForTimeout(ms: number): Promise<void>; evaluate<R>(f: () => R): Promise<R> };
          await p.waitForTimeout(SETTLE_MS);
          heights.push(await p.evaluate(read));
        } finally {
          await h.close();
        }
      }
      const bad = heights.filter((x) => !liveSet.has(x)).length;
      console.log(`archive ${a}  restoreTiming=${String(restoreTiming).padEnd(5)}  ${tally(heights)}  ${bad}/${heights.length} off-live`);
    }
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
