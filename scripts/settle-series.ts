/**
 * Record what a page's motion counts actually do over time — the reproducer for #182.
 *
 * **Node only** (ADR 0001). Run it as:
 *
 *     node scripts/settle-series.ts https://labs.chaingpt.org/ 5
 *
 * **See also `scripts/digest-series.ts`**, which records the same shape for the *replayed* archive
 * as well and carries every field the verdict is built from. A rule that fixes the live side and
 * breaks the clone's is the mistake #182 made twice, and only the two-sided series shows it.
 *
 * `src/equivalence/run.ts` used to pick a "settled" reading by stopping at the first pair of
 * consecutive equal samples. #182 measured that this is not reproducible: three consecutive runs of the gate on
 * one site returned FAIL, PASS and INCOMPLETE, and a live-against-replay listing showed the clone
 * was not wrong.
 *
 * This exists because the fix is a design decision that needs the series in front of it, and the
 * probe that produced the evidence lived under `archives/`, which is gitignored. Whoever takes #182
 * should not have to rebuild the measurement before they can argue about the answer.
 *
 * What it showed on `https://labs.chaingpt.org/`, five loads, sampling past the gate's own budget:
 *
 *     run 0  css: 59 59 59 59 56 58 58 52 52 52 ...
 *     run 3  css: 59 59 59 59 59 59 59 59 59 59 59 59 58 58 58 52 52 ...
 *     run 4  css: 52 52 52 52 52 52 52 52 52 52 ...
 *
 * The page holds an entry-animation set of 59, those finish, and it rests at 52. **The opening 59
 * is a plateau and the current rule picks it.** Run 3's plateau lasted twelve samples, which is the
 * gate's entire `MAX_SAMPLES`, so no larger "k consecutive equal readings" recovers 52 from a
 * window that never contains it. A bigger constant is fitted to whichever loads were observed.
 */

import { chromium } from "playwright";

const SAMPLES = 20;
const GAP_MS = 400;

interface Sample {
  css: number;
  waapi: number;
  gsap: number;
  scrollTriggers: number;
}

function readCounts(): Sample {
  const win = globalThis as unknown as {
    gsap?: { globalTimeline: { getChildren(): unknown[] } };
    ScrollTrigger?: { getAll(): unknown[] };
  };
  const animations = document.getAnimations();
  return {
    css: animations.filter((a) => a.constructor.name === "CSSAnimation").length,
    waapi: animations.filter((a) => a.constructor.name === "Animation").length,
    gsap: win.gsap?.globalTimeline.getChildren().length ?? 0,
    scrollTriggers: win.ScrollTrigger?.getAll().length ?? 0,
  };
}

function same(a: Sample, b: Sample): boolean {
  return (
    a.css === b.css &&
    a.waapi === b.waapi &&
    a.gsap === b.gsap &&
    a.scrollTriggers === b.scrollTriggers
  );
}

/** What a rule of `k` consecutive equal readings would choose, or the last sample if it never holds. */
function plateauPick(series: Sample[], k: number): Sample {
  let run = 1;
  for (let i = 1; i < series.length; i += 1) {
    run = same(series[i]!, series[i - 1]!) ? run + 1 : 1;
    if (run >= k) return series[i]!;
  }
  return series[series.length - 1]!;
}

const url = process.argv[2];
const runs = Number(process.argv[3] ?? 5);
if (url === undefined) {
  console.error("usage: node scripts/settle-series.ts <url> [runs]");
  process.exit(2);
}

const browser = await chromium.launch();
const series: Sample[][] = [];
try {
  for (let run = 0; run < runs; run += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    const samples: Sample[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      samples.push(await page.evaluate(readCounts));
      await page.waitForTimeout(GAP_MS);
    }
    await context.close();
    series.push(samples);
    console.log(`run ${run}   css: ${samples.map((s) => s.css).join(" ")}`);
    console.log(`        gsap: ${samples.map((s) => s.gsap).join(" ")}`);
  }
} finally {
  await browser.close();
}

console.log("");
// `k = 2` is what `STABLE_REPEATS` in src/equivalence/run.ts amounts to today.
for (const k of [2, 3, 4, 5, 6]) {
  const picks = series.map((samples) => plateauPick(samples, k).css);
  const reproducible = new Set(picks).size === 1;
  const note = k === 2 ? "  <- the rule in use today" : "";
  console.log(
    `k=${k}  css ${picks.join(", ").padEnd(28)} ${reproducible ? "reproducible here" : "varies"}${note}`,
  );
}
const finals = series.map((samples) => samples[samples.length - 1]!.css);
console.log(
  `last sample after ${(SAMPLES * GAP_MS) / 1000}s  css ${finals.join(", ")}  ${new Set(finals).size === 1 ? "reproducible here" : "varies"}`,
);
console.log("");
console.log("`reproducible here` means across these runs only. It is not a proposal: a constant");
console.log("fitted to the loads you happened to observe is the wall-clock guess #182 refuses.");
