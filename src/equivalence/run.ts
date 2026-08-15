/**
 * The equivalence gate's driver (#171, slice 0 of #169) — **Node only** (ADR 0001).
 *
 * Drives the live page and the replayed archive with **the same driver, in one session**, collects
 * the same digest from both, and hands the pair to the pure classifier. One session matters: a
 * comparison run a day later measures how much the site changed, not how faithful the clone is.
 *
 * v1 deliberately drives navigation and a scroll pass and nothing else. That is not a shortcut
 * hidden in the verdict — it is published as the coverage vector, where `interaction: 0` says
 * plainly that 242 registered click listeners were never fired. A green verdict at low coverage is
 * a small claim, correctly reported.
 */

import { captureHar } from "../capture/record.ts";
import { replayArchive, type ReplayBrowser } from "../replay/replay.ts";
import { classify, coverageOf, type AllowlistEntry, type ClassifyResult, type Digest } from "./classify.ts";

/** Two readings agree when every motion count in them does. */
function sameMotion(a: MotionSample, b: MotionSample): boolean {
  return a.css === b.css && a.waapi === b.waapi && a.gsap === b.gsap && a.st === b.st;
}

/** The slice of a page the driver needs. Structural, so a fake can stand in. */
export interface EquivalencePage {
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
  evaluate<Result, Arg>(fn: (arg: Arg) => Result | Promise<Result>, arg?: Arg): Promise<Result>;
  waitForTimeout(ms: number): Promise<void>;
}

/**
 * The browser is typed loosely for the same reason `captureHar` types its own: Playwright's
 * `Browser` is not assignable to any narrow structural interface this file could declare, and a
 * tighter type here makes the real browser unusable rather than making anything safer.
 */
export type EquivalenceBrowser = ReplayBrowser;

interface LiveContext {
  newPage(): Promise<EquivalencePage>;
  close(): Promise<void>;
}

export interface EquivalenceOptions {
  url: string;
  outDir: string;
  browser: EquivalenceBrowser;
  allowlist?: readonly AllowlistEntry[];
  /** Test seam: a field forced onto the live digest, to exercise the one-sided case. */
  extraLiveField?: Digest;
}

export interface EquivalenceReport extends ClassifyResult {
  url: string;
  archive: string;
  coverage: Record<string, number>;
}

/**
 * Sampling until the page stops changing, rather than at a fixed count.
 *
 * The plan's rule is to compare at *normalised progress*, never at a wall-clock instant, and a
 * fixed sample count does not obey it: a page's entry animations settle whenever they settle, and
 * live and replay do not reach that point together. Measured — the first real-site run had
 * `motion.gsap.settled` differing 196 against 190 on `www.chaingpt.org` and 49 against 50 on
 * `labs.chaingpt.org`, while an earlier six-sample probe showed both sides converging on the same
 * value. Those were readings taken mid-flight, not differences.
 *
 * So the driver waits for two consecutive identical readings and uses that, bounded so a page that
 * never settles cannot hold the gate open.
 */
const STABLE_REPEATS = 2;
const MAX_SAMPLES = 12;
const SAMPLE_GAP_MS = 400;
/** Scroll steps the driver takes, on both sides, so the scroll dimension is genuinely covered. */
const SCROLL_STEPS = 4;

/**
 * Live passes driven to establish which fields carry signal at all (#182).
 *
 * Two was the original number and it is measurably too few: a field that plateaus at one of two
 * values can have both passes land on the same plateau, and the gate then reports it as stable and
 * puts the difference in the residual as the clone's fault. Three consecutive gate runs on
 * `labs.chaingpt.org` returned FAIL, PASS and INCOMPLETE for that reason.
 *
 * The cost is one more live drive per run, paid on every run. That is the control doing its job.
 */
const BASELINE_PASSES = 3;

/**
 * The digest, collected identically on both sides.
 *
 * Counts alone are refused as a pass condition — the plan's §3 records three claims that a single
 * sample got wrong — so motion is sampled repeatedly and the *settled* value is what enters the
 * digest, with the peak kept beside it.
 */
interface MotionSample {
  css: number;
  waapi: number;
  gsap: number;
  st: number;
  height: number;
}

async function collectDigest(page: EquivalencePage): Promise<Digest> {
  const samples: MotionSample[] = [];
  let stableFor = 0;
  let settledAfter = MAX_SAMPLES;
  for (let i = 0; i < MAX_SAMPLES; i += 1) {
    samples.push(
      await page.evaluate(() => {
        const win = globalThis as unknown as {
          gsap?: { globalTimeline: { getChildren(): unknown[] } };
          ScrollTrigger?: { getAll(): unknown[] };
        };
        const animations = document.getAnimations();
        return {
          css: animations.filter((a) => a.constructor.name === "CSSAnimation").length,
          waapi: animations.filter((a) => a.constructor.name === "Animation").length,
          gsap: win.gsap?.globalTimeline.getChildren().length ?? 0,
          st: win.ScrollTrigger?.getAll().length ?? 0,
          height: document.documentElement.scrollHeight,
        };
      }),
    );
    const previous = samples[samples.length - 2];
    const latest = samples[samples.length - 1]!;
    stableFor = previous !== undefined && sameMotion(previous, latest) ? stableFor + 1 : 0;
    if (stableFor >= STABLE_REPEATS - 1 && samples.length > 1) {
      settledAfter = samples.length;
      break;
    }
    await page.waitForTimeout(SAMPLE_GAP_MS);
  }

  // The scroll half of the driver, identical on both sides.
  for (let step = 1; step <= SCROLL_STEPS; step += 1) {
    await page.evaluate((fraction: number) => {
      window.scrollTo(0, document.documentElement.scrollHeight * fraction);
    }, step / SCROLL_STEPS);
    await page.waitForTimeout(SAMPLE_GAP_MS);
  }

  const afterScroll = await page.evaluate(() => {
    const win = globalThis as unknown as {
      gsap?: { globalTimeline: { getChildren(): unknown[] } };
      ScrollTrigger?: { getAll(): unknown[] };
    };
    const animations = document.getAnimations();
    return {
      css: animations.filter((a) => a.constructor.name === "CSSAnimation").length,
      st: win.ScrollTrigger?.getAll().length ?? 0,
      gsapPresent: win.gsap !== undefined,
      elements: document.querySelectorAll("*").length,
      canvases: document.querySelectorAll("canvas").length,
      videos: document.querySelectorAll("video").length,
      title: document.title,
    };
  });

  const settled = samples[samples.length - 1]!;
  return {
    // Whether the page settled at all is itself a comparable fact: one side settling and the other
    // not is a real difference, where the sample index it happened at is not.
    "motion.settled": settledAfter < MAX_SAMPLES,
    "motion.css.settled": settled.css,
    "motion.css.peak": Math.max(...samples.map((s) => s.css)),
    "motion.gsap.settled": settled.gsap,
    "motion.scrollTriggers": settled.st,
    "motion.gsapPresent": afterScroll.gsapPresent,
    "motion.css.afterScroll": afterScroll.css,
    "motion.scrollTriggers.afterScroll": afterScroll.st,
    "dom.elements": afterScroll.elements,
    "dom.canvases": afterScroll.canvases,
    "dom.videos": afterScroll.videos,
    "dom.title": afterScroll.title,
    "layout.scrollHeight": settled.height,
  };
}

export async function runEquivalence(options: EquivalenceOptions): Promise<EquivalenceReport> {
  // The live side is driven **twice**, and the second pass is not redundancy — it is the control
  // that decides which fields carry any signal at all. Measured on three real sites: comparing the
  // live page with itself put `dom.elements`, `motion.gsap` and even ScrollTrigger registrations
  // in the residual, so every verdict the gate produced before this control existed was noise.
  const passes: Digest[] = [];
  for (let pass = 0; pass < BASELINE_PASSES; pass += 1) {
    const context = (await options.browser.newContext({})) as unknown as LiveContext;
    try {
      const page = await context.newPage();
      await page.goto(options.url, { waitUntil: "load" });
      passes.push(await collectDigest(page));
    } finally {
      await context.close();
    }
  }
  const live: Digest = { ...passes[0]!, ...(options.extraLiveField ?? {}) };

  const har = await captureHar({
    browser: options.browser as never,
    url: options.url,
    outDir: options.outDir,
  });
  const archive = har.slice(0, har.lastIndexOf("network.har") - 1);

  const replay = await replayArchive({ archive, browser: options.browser });
  let replayed: Digest;
  try {
    replayed = await collectDigest(replay.page as unknown as EquivalencePage);
  } finally {
    await replay.close();
  }

  const result = classify(live, replayed, options.allowlist ?? [], { passes });
  return {
    ...result,
    url: options.url,
    archive,
    // Published with every verdict, never reduced to a score. `interaction` is zero because v1
    // drives none, and saying so is the point: a green verdict here is a claim about navigation
    // and scrolling, and about nothing else.
    coverage: coverageOf({
      scroll: [SCROLL_STEPS, SCROLL_STEPS],
      motion_settled: [
        live["motion.settled"] === true && replayed["motion.settled"] === true ? 1 : 0,
        1,
      ],
      // How much of the digest carried signal at all. A field the live page could not reproduce
      // against itself is excluded from the verdict, so the share that survived is the honest
      // measure of how much this run actually compared.
      stable_fields: [
        result.fields.length - result.unstable.length,
        result.fields.length,
      ],
      interaction: [0, 1],
      listener_execution: [0, 1],
    }),
  };
}
