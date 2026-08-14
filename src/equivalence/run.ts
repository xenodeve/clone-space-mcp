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

/** How many points the driver samples motion at. One is not a measurement of a moving page. */
const SAMPLES = 4;
const SAMPLE_GAP_MS = 400;
/** Scroll steps the driver takes, on both sides, so the scroll dimension is genuinely covered. */
const SCROLL_STEPS = 4;

/**
 * The digest, collected identically on both sides.
 *
 * Counts alone are refused as a pass condition — the plan's §3 records three claims that a single
 * sample got wrong — so motion is sampled repeatedly and the *settled* value is what enters the
 * digest, with the peak kept beside it.
 */
async function collectDigest(page: EquivalencePage): Promise<Digest> {
  const samples: { css: number; waapi: number; gsap: number; st: number; height: number }[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
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
    if (i < SAMPLES - 1) await page.waitForTimeout(SAMPLE_GAP_MS);
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
  // Live first, and from the same process, so the two sides see one moment of the site.
  const liveContext = (await options.browser.newContext({})) as unknown as LiveContext;
  let live: Digest;
  try {
    const page = await liveContext.newPage();
    await page.goto(options.url, { waitUntil: "load" });
    live = { ...(await collectDigest(page)), ...(options.extraLiveField ?? {}) };
  } finally {
    await liveContext.close();
  }

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

  const result = classify(live, replayed, options.allowlist ?? []);
  return {
    ...result,
    url: options.url,
    archive,
    // Published with every verdict, never reduced to a score. `interaction` is zero because v1
    // drives none, and saying so is the point: a green verdict here is a claim about navigation
    // and scrolling, and about nothing else.
    coverage: coverageOf({
      scroll: [SCROLL_STEPS, SCROLL_STEPS],
      motion_samples: [SAMPLES, SAMPLES],
      interaction: [0, 1],
      listener_execution: [0, 1],
    }),
  };
}
