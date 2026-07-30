/**
 * Spike harness for issue #3, questions Q1–Q3.
 *
 * These three block phase 1 because each one decides a v1 interface. The harness exists
 * so the answers are *measured against the fixture's known ground truth* rather than
 * inferred from documentation — and so that re-running it later is a command, not an
 * afternoon.
 *
 *   bun run spike
 *
 * **Runs under Node, not Bun.** Playwright's client does not complete its handshake
 * under Bun — measured on both transports, with raw CDP from Bun working in 99ms, so the
 * fault is in Playwright's client rather than in Bun's networking. See
 * `docs/reports/2026-07-30-cdp-spike.md`. The fixture server still runs under Bun, as a
 * child process, because it uses `Bun.serve` and `Bun.build`.
 *
 * It prints a JSON result and exits non-zero only on a harness failure, never on an
 * unfavourable answer: "no, pierce does not reach the iframe" is a finding, not an error.
 */

import { chromium, type CDPSession, type Page } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

interface FixtureServers {
  primary: { url: string };
  crossOrigin: { url: string };
}

/** Same resolution order as scripts/verify.sh: PATH first, then bun's default install. */
function resolveBun(): string {
  for (const candidate of [
    join(homedir(), ".bun/bin/bun.exe"),
    join(homedir(), ".bun/bin/bun"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "bun";
}

/** Starts the fixture as a Bun child process and waits for it to announce its origins. */
async function startFixtureServers(): Promise<FixtureServers & { stop(): Promise<void> }> {
  // stderr is inherited so a fixture crash is visible in this process's output rather
  // than swallowed; that makes stdio typed as [Writable, Readable, null].
  const child = spawn(resolveBun(), ["run", join(REPO, "scripts/fixture-serve.ts")], {
    cwd: REPO,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const origins = await new Promise<FixtureServers>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("fixture server did not announce its origins within 30s")),
      30_000,
    );
    createInterface({ input: child.stdout }).once("line", (line) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(line) as FixtureServers);
      } catch {
        reject(new Error(`fixture server printed something that is not JSON: ${line}`));
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`fixture server exited early (code ${code})`)));
  });

  return {
    ...origins,
    async stop() {
      child.stdin.end();
      child.kill();
    },
  };
}

/** The computed properties a v1 snapshot would plausibly want. Q2 prices this list. */
const COMPUTED_STYLES = [
  "display", "position", "top", "right", "bottom", "left", "width", "height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "transform", "transform-origin", "opacity", "visibility", "overflow",
  "z-index", "color", "background-color", "background-image", "border-radius",
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
  "animation-name", "animation-duration", "animation-timing-function",
  "animation-delay", "animation-iteration-count", "animation-direction",
  "transition-property", "transition-duration", "will-change",
];

interface Answer {
  question: string;
  verdict: string;
  measured: Record<string, unknown>;
  notCovered: string[];
}

/** Q1 — does one getEventListeners call really reach the whole subtree? */
async function q1(cdp: CDPSession): Promise<Answer> {
  const { result } = await cdp.send("Runtime.evaluate", {
    expression: "document.documentElement",
  });
  if (!result.objectId) throw new Error("Q1 harness: no objectId for document.documentElement");

  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
    objectId: result.objectId,
    depth: -1,
    pierce: true,
  });

  const byUrl: Record<string, number> = {};
  for (const l of listeners) {
    const key = l.scriptId ? (l.handler?.description ? "inline-or-module" : "unknown") : "unknown";
    byUrl[key] = (byUrl[key] ?? 0) + 1;
  }

  // The fixture's ground truth, by file:
  //   motion.js       — 2 carousel buttons (click), 1 shadow-root .mark (click)
  //   frame.html      — 1 .dot (click), inside the iframe document
  //   instrumented.ts — 1 window scroll  (bound on window, not in this subtree)
  //   GSAP/ScrollTrigger — its own scroll/resize/visibilitychange handlers
  const types = listeners.map((l) => l.type).sort();
  const counts: Record<string, number> = {};
  for (const t of types) counts[t] = (counts[t] ?? 0) + 1;

  const clickCount = counts["click"] ?? 0;

  return {
    question:
      "Does DOMDebugger.getEventListeners({depth:-1, pierce:true}) return the whole subtree in one call?",
    verdict:
      clickCount >= 4
        ? "YES — one call returned listeners from the light DOM, the shadow root and the iframe document."
        : clickCount >= 3
          ? "PARTIAL — the shadow root is reached, the iframe document is not. Frames need their own call."
          : "NO — the call did not reach beyond the light DOM.",
    measured: {
      totalListeners: listeners.length,
      byType: counts,
      clickListeners: clickCount,
      groundTruthClickListeners: {
        lightDom: 2,
        shadowRoot: 1,
        iframeDocument: 1,
        total: 4,
      },
      handlerSample: byUrl,
    },
    notCovered: [
      "Closed shadow roots — the fixture only has an open one.",
      "Out-of-process iframes (cross-origin). This fixture's iframe is same-origin, so a same-target result here does not predict an OOPIF.",
      "Listeners added after this call; the snapshot is a point in time.",
    ],
  };
}

/** Q2 — how many MB is a DOMSnapshot at real scale? */
async function q2(cdp: CDPSession, page: Page): Promise<Answer> {
  const measure = async (label: string) => {
    const started = performance.now();
    const snap = await cdp.send("DOMSnapshot.captureSnapshot", {
      computedStyles: COMPUTED_STYLES,
      includePaintOrder: false,
      includeDOMRects: true,
    });
    const ms = performance.now() - started;
    const bytes = Buffer.byteLength(JSON.stringify(snap), "utf8");
    const nodes = snap.documents.reduce((n, d) => n + (d.nodes.nodeType?.length ?? 0), 0);
    return { label, nodes, bytes, kb: +(bytes / 1024).toFixed(1), mb: +(bytes / 1048576).toFixed(3), ms: +ms.toFixed(1) };
  };

  const asAuthored = await measure("fixture as authored");

  // Inflate to the scale the question actually asks about. Real pages reach ~3000 nodes;
  // measuring only the fixture's ~90 and multiplying would be an estimate presented as a
  // measurement, which is the thing to avoid.
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "scale-probe";
    for (let i = 0; i < 3000; i++) {
      const el = document.createElement("span");
      el.className = `probe probe--${i % 12}`;
      el.textContent = `n${i}`;
      host.append(el);
    }
    document.body.append(host);
  });
  const atScale = await measure("fixture + 3000 synthetic nodes");

  await page.evaluate(() => document.getElementById("scale-probe")?.remove());

  const perNode = (atScale.bytes - asAuthored.bytes) / (atScale.nodes - asAuthored.nodes);

  return {
    question: `DOMSnapshot.captureSnapshot with ${COMPUTED_STYLES.length} computed properties — how many MB at ~3000 nodes?`,
    verdict:
      atScale.mb < 2
        ? `Cheap — ${atScale.mb} MB at ${atScale.nodes} nodes. No property allowlist needed in v1.`
        : atScale.mb < 8
          ? `Manageable — ${atScale.mb} MB at ${atScale.nodes} nodes. Worth an allowlist, not worth a redesign.`
          : `Expensive — ${atScale.mb} MB at ${atScale.nodes} nodes. v1 needs a property allowlist and probably a node filter.`,
    measured: {
      propertiesRequested: COMPUTED_STYLES.length,
      asAuthored,
      atScale,
      bytesPerNodeMarginal: Math.round(perNode),
    },
    notCovered: [
      "The synthetic nodes are uniform spans; a real page's variety of tag names and inline styles compresses differently in the string table.",
      "includePaintOrder was off — turning it on adds a per-node integer.",
      "Repeat runs were not taken, so the ms figure is one sample and indicative only.",
    ],
  };
}

/** Q3 — does CSS.getStyleSheetText bypass CORS? */
async function q3(cdp: CDPSession, page: Page, servers: FixtureServers): Promise<Answer> {
  // First establish the premise: the page itself must NOT be able to read this sheet.
  // Without this check a "yes" would be meaningless — the sheet might simply be readable.
  const inPage = await page.evaluate((crossOrigin: string) => {
    const sheet = [...document.styleSheets].find((s) => s.href?.startsWith(crossOrigin));
    if (!sheet) return { found: false, threw: false, error: "no such stylesheet" };
    try {
      const n = sheet.cssRules.length;
      return { found: true, threw: false, error: `readable, ${n} rules` };
    } catch (err) {
      return { found: true, threw: true, error: (err as Error).name };
    }
  }, servers.crossOrigin.url);

  // CSS.enable replays styleSheetAdded for every sheet already in the document, so no
  // reload is needed — and a reload would actively break this: styleSheetIds are
  // invalidated by navigation, so an id captured before one is guaranteed to fail with
  // "No style sheet with given id found". That is a harness bug that reads exactly like
  // a real negative answer, which is the reason it is called out here.
  const sheets: Array<{ styleSheetId: string; sourceURL: string }> = [];
  cdp.on("CSS.styleSheetAdded", (e) => {
    sheets.push({ styleSheetId: e.header.styleSheetId, sourceURL: e.header.sourceURL });
  });
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");

  const target = sheets.find((s) => s.sourceURL.startsWith(servers.crossOrigin.url));

  let text: string | null = null;
  let cdpError: string | null = null;
  if (target) {
    try {
      const res = await cdp.send("CSS.getStyleSheetText", { styleSheetId: target.styleSheetId });
      text = res.text;
    } catch (err) {
      cdpError = (err as Error).message;
    }
  }

  const marker = "styled from a cross-origin sheet";
  const gotRealContent = text !== null && text.includes(marker);

  return {
    question: "Does CSS.getStyleSheetText read a cross-origin stylesheet the page cannot?",
    verdict: !inPage.threw
      ? `INCONCLUSIVE — the premise failed: the page could read the sheet (${inPage.error}), so nothing was bypassed.`
      : gotRealContent
        ? "YES — the page throws SecurityError on cssRules, and CDP returned the real text."
        : `NO — the page throws SecurityError and CDP did not return the text (${cdpError ?? "empty or mismatched"}).`,
    measured: {
      pageCanReadRules: !inPage.threw,
      pageError: inPage.error,
      styleSheetsSeenByCdp: sheets.length,
      crossOriginSheetFoundByCdp: Boolean(target),
      cdpTextLength: text?.length ?? 0,
      cdpTextContainsFixtureMarker: gotRealContent,
      cdpError,
    },
    notCovered: [
      "A sheet served with Access-Control-Allow-Origin — untested here, and it would be readable in-page anyway.",
      "Sheets injected by an extension or a service worker.",
      "@import chains from a cross-origin sheet.",
    ],
  };
}

async function main(): Promise<void> {
  const servers = await startFixtureServers();
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);

    await page.goto(servers.primary.url, { waitUntil: "load" });
    // Let the deferred fixture cases (dynamic insertion at 600ms, delayed insertion at
    // 1200ms, the shadow root, the iframe) actually exist before anything is measured.
    await page.waitForTimeout(1500);

    const answers = [await q1(cdp), await q2(cdp, page), await q3(cdp, page, servers)];

    console.log(
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          runtime: `node ${process.version}`,
          fixtureServerRuntime: "bun (child process)",
          browserVersion: browser.version(),
          answers,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await servers.stop();
  }
}

await main();
