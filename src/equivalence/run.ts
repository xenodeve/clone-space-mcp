/**
 * The equivalence gate's driver (#171, slice 0 of #169) — **Node only** (ADR 0001).
 *
 * Drives the live page and the replayed archive with **the same driver, in one session**, collects
 * the same digest from both, and hands the pair to the pure classifier. One session matters: a
 * comparison run a day later measures how much the site changed, not how faithful the clone is.
 *
 * It drives navigation, a scroll pass, and a bounded interaction plan (#176). Whatever it does not
 * reach is published as the coverage vector rather than hidden in the verdict — a green verdict at
 * low coverage is a small claim, correctly reported.
 *
 * **The interaction plan is discovered once, on the live page, and driven unchanged on every pass,
 * including the clone's.** Letting each side discover its own would have the two drive different
 * elements and compare the results as though they were comparable, and would hide the finding that
 * matters most: a selector the live page offers and the clone cannot resolve. That surfaces as
 * `interaction.stale`.
 */

import { captureHar } from "../capture/record.ts";
import { replayArchive, type ReplayBrowser } from "../replay/replay.ts";
import { classify, coverageOf, type AllowlistEntry, type ClassifyResult, type Digest } from "./classify.ts";
import {
  DEFAULT_LIMITS,
  DISCOVERY_SCRIPT,
  discoveredCandidates,
  planActions,
  type InteractionPlan,
} from "../capture/interaction.ts";
import { driveInteraction, type DriveReport, type DrivablePage } from "../capture/interaction-drive.ts";

/** Settle time after each driven action, so the effect it triggers is observable before the next. */
const INTERACTION_SETTLE_MS = 150;

/** Two readings agree when every motion count in them does. */
function sameMotion(a: MotionSample, b: MotionSample): boolean {
  return a.css === b.css && a.waapi === b.waapi && a.gsap === b.gsap && a.st === b.st;
}

/** The slice of a page the driver needs. Structural, so a fake can stand in. */
export interface EquivalencePage {
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
  // A string is an expression evaluated in the page, which is how `DISCOVERY_SCRIPT` is passed.
  // Playwright accepts both forms; note that the string form does NOT reliably receive `arg`, so
  // anything taking one must be a real function (measured on #176's scroll).
  evaluate<Result, Arg>(
    fn: string | ((arg: Arg) => Result | Promise<Result>),
    arg?: Arg,
  ): Promise<Result>;
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

interface DigestRun {
  digest: Digest;
  /** The plan this pass drove, so later passes can drive exactly the same one. */
  plan: InteractionPlan;
  drive: DriveReport;
}

async function collectDigest(
  page: EquivalencePage,
  interactionPlan?: InteractionPlan,
): Promise<DigestRun> {
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

  // The interaction half (#176). The plan is **discovered once, on the live page, and driven
  // unchanged on every pass** — including the clone's. Letting each side discover its own would
  // make the two sides drive different elements and compare the results as though they were
  // comparable; worse, it would hide the finding that matters most, which is a selector the live
  // page offers and the clone does not resolve. That shows up here as a stale skip.
  const plan =
    interactionPlan ??
    planActions(discoveredCandidates(await page.evaluate(DISCOVERY_SCRIPT)), DEFAULT_LIMITS);
  const drive = await driveInteraction(page as unknown as DrivablePage, plan, {
    settleMs: INTERACTION_SETTLE_MS,
  });
  await page.waitForTimeout(SAMPLE_GAP_MS);

  const afterInteraction = await page.evaluate(() => {
    const win = globalThis as unknown as { ScrollTrigger?: { getAll(): unknown[] } };
    return {
      css: document.getAnimations().filter((a) => a.constructor.name === "CSSAnimation").length,
      st: win.ScrollTrigger?.getAll().length ?? 0,
      elements: document.querySelectorAll("*").length,
      canvases: document.querySelectorAll("canvas").length,
    };
  });

  const settled = samples[samples.length - 1]!;
  return {
    plan,
    drive,
    digest: {
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

    // What the interaction actually did, and what the page became afterwards. These are the
    // fields that can only differ because something *behind a click* differs — everything above
    // is reachable by scrolling, which is the ceiling the gate had before #176.
    "interaction.performed": drive.performed.filter((action) => action.ok).length,
    "interaction.stale": drive.performed.filter((action) => action.note.startsWith("element is gone"))
      .length,
    "interaction.navigated": drive.navigatedTo !== "",
    "motion.css.afterInteraction": afterInteraction.css,
    "motion.scrollTriggers.afterInteraction": afterInteraction.st,
    "dom.elements.afterInteraction": afterInteraction.elements,
    "dom.canvases.afterInteraction": afterInteraction.canvases,
    },
  };
}

export async function runEquivalence(options: EquivalenceOptions): Promise<EquivalenceReport> {
  // The live side is driven **twice**, and the second pass is not redundancy — it is the control
  // that decides which fields carry any signal at all. Measured on three real sites: comparing the
  // live page with itself put `dom.elements`, `motion.gsap` and even ScrollTrigger registrations
  // in the residual, so every verdict the gate produced before this control existed was noise.
  const passes: Digest[] = [];
  let sharedPlan: InteractionPlan | undefined;
  for (let pass = 0; pass < BASELINE_PASSES; pass += 1) {
    const context = (await options.browser.newContext({})) as unknown as LiveContext;
    try {
      const page = await context.newPage();
      await page.goto(options.url, { waitUntil: "load" });
      const run = await collectDigest(page, sharedPlan);
      sharedPlan ??= run.plan;
      passes.push(run.digest);
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

  // The clone is driven as many times as the live page, for the same reason: a field that is
  // steady live and moves on the clone is invisible to a live-only control, and `layout.scrollHeight`
  // was measured doing exactly that.
  const replayPasses: Digest[] = [];
  for (let pass = 0; pass < BASELINE_PASSES; pass += 1) {
    const replay = await replayArchive({ archive, browser: options.browser });
    try {
      replayPasses.push(
        (await collectDigest(replay.page as unknown as EquivalencePage, sharedPlan)).digest,
      );
    } finally {
      await replay.close();
    }
  }
  const replayed: Digest = replayPasses[0]!;

  const result = classify(live, replayed, options.allowlist ?? [], {
    livePasses: passes,
    replayPasses,
  });
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
      // What the plan actually drove, out of what it planned. Not "did we try" — a page whose
      // controls all went stale reports near zero here, which is the honest number.
      interaction: [
        Number(replayed["interaction.performed"] ?? 0),
        Math.max(1, sharedPlan?.actions.length ?? 1),
      ],
      listener_execution: [0, 1],
    }),
  };
}
