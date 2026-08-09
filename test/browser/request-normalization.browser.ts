import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

/**
 * §6.5 S1 compatibility probe (#85). Measures, not infers, that pinned Playwright 1.62 can
 * rewrite a logically identical request into `routeFromHAR` through `route.fallback({ url })`
 * with the live origin stopped.
 *
 * The origin server is closed before any replay and asserted down; the archived HTML and every
 * served body must therefore come from the HAR. A request that reached the live network would
 * fail the page fetch (connection refused) rather than produce an archived body, so the only
 * way the page can read `ARCHIVED_ASSET_BODY` is through the HAR route.
 *
 * This probe owns the *mechanism* question (does the fallback rewrite reach the HAR handler?).
 * The taxonomy's exact labels and precedence are implemented and unit-tested in #90/#91; here
 * the page result distinguishes "served from HAR" from "aborted" — the observable contract.
 */

const VOLATILE_KEYS = ["_t"];
const REDACTED_BODY = "[REDACTED]\n";

type HarEntry = {
  request: { url: string; method: string; postData?: { text?: string } };
  response: { status: number; content: { text: string }; headers: Array<{ name: string; value: string }> };
};

interface ProbeContext {
  harPath: string;
  originalUrl: string;
  entries: HarEntry[];
  pageResults: Record<string, string>;
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  for (const key of VOLATILE_KEYS) url.searchParams.delete(key);
  return url.toString();
}

function archivedBodyIsRedacted(entry: HarEntry): boolean {
  return entry.request.method === "POST" && entry.request.postData?.text === REDACTED_BODY;
}

function fixtureHtml(origin: string): string {
  return `<!doctype html><script>
    window.__results = {};
    const record = (key, text) => { window.__results[key] = text; };
    fetch('${origin}/asset?tag=capture&_t=' + Date.now())
      .then(r => r.text()).then(t => record('asset', t)).catch(() => record('asset', 'ERR'));
    fetch('${origin}/dup?_t=' + Date.now())
      .then(r => r.text()).then(t => record('dup', t)).catch(() => record('dup', 'ERR'));
    fetch('${origin}/submit', { method: 'POST', body: 'live-body' })
      .then(() => record('submit', 'OK')).catch(() => record('submit', 'ERR'));
    fetch('${origin}/not-in-archive')
      .then(r => r.text()).then(t => record('absent', t)).catch(() => record('absent', 'ERR'));
    window.__done = true;
  </script>`;
}

function harDocument(origin: string): { log: { entries: HarEntry[] } } {
  const html = fixtureHtml(origin);
  return {
    log: {
      entries: [
        {
          request: { url: `${origin}/asset?tag=capture&_t=111`, method: "GET" },
          response: {
            status: 200,
            content: { text: "ARCHIVED_ASSET_BODY" },
            headers: [{ name: "content-type", value: "text/plain" }],
          },
        },
        {
          request: { url: `${origin}/dup?_t=aaa`, method: "GET" },
          response: {
            status: 200,
            content: { text: "DUP_A" },
            headers: [{ name: "content-type", value: "text/plain" }],
          },
        },
        {
          request: { url: `${origin}/dup?_t=bbb`, method: "GET" },
          response: {
            status: 200,
            content: { text: "DUP_B" },
            headers: [{ name: "content-type", value: "text/plain" }],
          },
        },
        {
          request: { url: `${origin}/submit`, method: "POST", postData: { text: REDACTED_BODY } },
          response: {
            status: 204,
            content: { text: "" },
            headers: [],
          },
        },
        {
          request: { url: `${origin}/`, method: "GET" },
          response: {
            status: 200,
            content: { text: html },
            headers: [{ name: "content-type", value: "text/html" }],
          },
        },
      ],
    },
  };
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

let browser: Browser;

test.before(async () => {
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
});

async function withProbe(
  run: (ctx: {
    context: import("playwright").BrowserContext;
    page: import("playwright").Page;
    probe: ProbeContext;
  }) => Promise<void>,
): Promise<ProbeContext> {
  const dir = mkdtempSync(join(tmpdir(), "clone-space-norm-probe-"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("LIVE_SERVER_BODY");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const har = harDocument(origin);
  const harPath = join(dir, "network.har");
  writeFileSync(harPath, JSON.stringify(har));

  // The live network must be unreachable for the whole replay.
  await stopServer(server);
  assert.equal(server.listening, false, "probe origin must be stopped before replay");

  const context = await browser.newContext();
  const page = await context.newPage();
  const probe: ProbeContext = {
    harPath,
    originalUrl: origin + "/",
    entries: har.log.entries,
    pageResults: {},
  };

  try {
    await run({ context, page, probe });
    await page.waitForFunction(
      () => (window as { __done?: boolean }).__done === true,
      undefined,
      { timeout: 10_000 },
    );
    probe.pageResults = await page.evaluate(
      () => (window as { __results?: Record<string, string> }).__results ?? {},
    );
    return probe;
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("strict HAR replay aborts when only an allowlisted query value changes", async () => {
  const probe = await withProbe(async ({ context, page, probe }) => {
    await context.routeFromHAR(probe.harPath, { notFound: "abort", update: false });
    await page.goto(probe.originalUrl, { waitUntil: "load" });
  });

  // Baseline RED, isolated to the volatile query change: the asset request is the only one whose
  // failure is caused by the changed `_t` value. dup/submit/absent are asserted in the next test,
  // where their distinct abort reasons (ambiguity / redaction / absence) are in scope.
  assert.equal(probe.pageResults.asset, "ERR", "baseline: the volatile-query request must abort");
});

test("normalized fallback serves the archived body and aborts the unexpected requests", async () => {
  const probe = await withProbe(async ({ context, page, probe }) => {
    // routeFromHAR first, then the normalizing route so it runs first.
    await context.routeFromHAR(probe.harPath, { notFound: "abort", update: false });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const normalized = normalizeUrl(request.url());
      const matches = probe.entries.filter(
        (entry) => entry.request.method === request.method() && normalizeUrl(entry.request.url) === normalized,
      );

      if (matches.length === 0) {
        await route.abort();
        return;
      }
      // Ambiguity outranks redaction: the PRD classifies any collapse of multiple distinct
      // archived raw URLs as ambiguous, regardless of whether one of them is redacted.
      if (matches.length > 1) {
        await route.abort();
        return;
      }
      if (archivedBodyIsRedacted(matches[0]!)) {
        await route.abort();
        return;
      }
      await route.fallback({ url: matches[0]!.request.url });
    });

    await page.goto(probe.originalUrl, { waitUntil: "load" });
  });

  assert.equal(probe.pageResults.asset, "ARCHIVED_ASSET_BODY", "normalized fallback must serve the archived body");
  assert.equal(probe.pageResults.dup, "ERR", "ambiguous normalized match must abort");
  assert.equal(probe.pageResults.submit, "ERR", "redacted POST must abort");
  assert.equal(probe.pageResults.absent, "ERR", "no candidate must abort");
});
