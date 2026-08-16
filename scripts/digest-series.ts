/**
 * The full digest series, **both sides** — the measurement that decided #182 and produced #187.
 *
 * **Node only** (ADR 0001). Run it as:
 *
 *     node scripts/digest-series.ts https://labs.chaingpt.org/ 3
 *
 * `scripts/settle-series.ts` is the smaller sibling: live only, motion counts only, no capture. Use
 * that one to see whether a page plateaus. Use this one when the question is whether a *rule* makes
 * the digest reproducible, because a rule that fixes the live side and breaks the clone's is the
 * mistake #182 made twice.
 *
 * It records every field the verdict is built from, for three live loads and three replays of one
 * archive, and then evaluates candidate rules offline against the same data. What it showed on
 * `https://labs.chaingpt.org/`, 2026-08-16:
 *
 *   - the rule in use before #182 read 59 on all six runs, on a page that rests at 52, and read
 *     `gsap` 49 live against 50 on the clone — a difference that is not one;
 *   - reading the end of the budget read 52 and 49 on all six;
 *   - `layout.scrollHeight` read 8544 live on every load and 8544, 8486, 8486 across three replays
 *     of one archive, **constant across all thirty samples of each run**. That is not a sampling
 *     problem and no clock fixes it — it is #187.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { captureHar } from "../src/capture/record.ts";
import { replayArchive } from "../src/replay/replay.ts";

const url = process.argv[2] ?? "https://labs.chaingpt.org/";
const passes = Number(process.argv[3] ?? 3);
const SAMPLES = 30;
const GAP_MS = 400;

interface Sample {
  css: number;
  gsap: number;
  height: number;
  elements: number;
}

type Field = keyof Sample;

interface SeriesPage {
  evaluate<Result>(fn: () => Result): Promise<Result>;
  waitForTimeout(ms: number): Promise<void>;
}

const read = (): Sample => {
  const win = globalThis as unknown as {
    gsap?: { globalTimeline: { getChildren(): unknown[] } };
  };
  const animations = document.getAnimations();
  return {
    css: animations.filter((a) => a.constructor.name === "CSSAnimation").length,
    gsap: win.gsap?.globalTimeline.getChildren().length ?? 0,
    height: document.documentElement.scrollHeight,
    elements: document.querySelectorAll("*").length,
  };
};

async function series(page: SeriesPage): Promise<Sample[]> {
  const out: Sample[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    out.push(await page.evaluate(read));
    await page.waitForTimeout(GAP_MS);
  }
  return out;
}

const browser = await chromium.launch();
const dir = mkdtempSync(join(tmpdir(), "probe-tail-"));
const live: Sample[][] = [];
const replayed: Sample[][] = [];

try {
  for (let pass = 0; pass < passes; pass += 1) {
    const context = await browser.newContext({});
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    live.push(await series(page as unknown as SeriesPage));
    await context.close();
  }

  const archiveDir = join(dir, "archive");
  await captureHar({ browser: browser as never, url, outDir: archiveDir });
  for (let pass = 0; pass < passes; pass += 1) {
    const handle = await replayArchive({ archive: archiveDir, browser: browser as never });
    try {
      replayed.push(await series(handle.page as unknown as SeriesPage));
    } finally {
      await handle.close();
    }
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

const FIELDS: Field[] = ["css", "gsap", "height", "elements"];

// The rule in use today: stop at the first pair of consecutive equal MOTION samples.
function todaysPick(run: readonly Sample[], field: Field): number {
  for (let i = 1; i < run.length; i += 1) {
    const a = run[i - 1]!;
    const b = run[i]!;
    if (a.css === b.css && a.gsap === b.gsap) return b[field];
  }
  return run[run.length - 1]![field];
}

const tailPick = (run: readonly Sample[], field: Field): number => run[run.length - 1]![field];
const tailConstant = (run: readonly Sample[], field: Field, t: number): boolean =>
  run.slice(-t).every((s) => s[field] === run[run.length - 1]![field]);

function report(label: string, runs: readonly Sample[][]): void {
  console.log(`\n### ${label}`);
  for (const field of FIELDS) {
    const today = runs.map((r) => todaysPick(r, field));
    const tail = runs.map((r) => tailPick(r, field));
    const constant = runs.map((r) => (tailConstant(r, field, 5) ? "yes" : "NO"));
    const same = (xs: readonly number[]): boolean => new Set(xs).size === 1;
    console.log(
      `${field.padEnd(9)} today ${String(today).padEnd(28)} ${same(today) ? "same" : "VARIES"}` +
        ` | tail ${String(tail).padEnd(28)} ${same(tail) ? "same" : "VARIES"}` +
        ` | tail5-constant ${constant.join(",")}`,
    );
  }
}

report("live", live);
report("replay", replayed);

console.log("\n### live vs replay, by rule");
for (const field of FIELDS) {
  const l = new Set(live.map((r) => tailPick(r, field)));
  const r = new Set(replayed.map((r) => tailPick(r, field)));
  const lt = new Set(live.map((run) => todaysPick(run, field)));
  const rt = new Set(replayed.map((run) => todaysPick(run, field)));
  console.log(
    `${field.padEnd(9)} tail live ${[...l]} replay ${[...r]}` +
      `  | today live ${[...lt]} replay ${[...rt]}`,
  );
}

console.log("\nfull series (last 12 of each), live then replay");
for (const [label, runs] of [["live", live], ["replay", replayed]] as const) {
  for (const [i, run] of runs.entries()) {
    console.log(`${label} ${i} css  ${run.map((s) => s.css).join(" ")}`);
    console.log(`${label} ${i} elem ${run.map((s) => s.elements).join(" ")}`);
    console.log(`${label} ${i} hgt  ${run.map((s) => s.height).join(" ")}`);
  }
}
