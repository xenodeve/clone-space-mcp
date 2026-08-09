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
 * with the live origin stopped, and that the unexpected-request classifications fail closed.
 *
 * The origin server is stopped before any replay: the archived HTML must come from the HAR, and
 * every successful fetch must come from the HAR too. The server's own response body is a
 * sentinel (`LIVE_SERVER_BODY`) so a leaked live request would be distinguishable from an
 * archived one.
 */

const VOLATILE_KEYS = ["_t"];
const REDACTED_BODY = "[REDACTED]\n";

type Classification =
  | "normalized-match"
  | "ambiguous-normalized-match"
  | "redacted-post-body"
  | "not-in-archive";

type HarEntry = {
  request: { url: string; method: string; postData?: { text?: string } };
  response: { status: number; content: { text: string }; headers: Array<{ name: string; value: string }> };
};

interface ProbeContext {
  harPath: string;
  originalUrl: string;
  entries: HarEntry[];
  classifications: Array<{ url: string; kind: Classification }>;
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

function htmlFor(origin: string): string {
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
  const html = htmlFor(origin);
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
    classifications: [],
    pageResults: {},
  };

  try {
    await run({ context, page, probe });
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
    await page.waitForFunction(
      () => (window as { __done?: boolean }).__done === true,
      undefined,
      { timeout: 10_000 },
    );
  });

  // The archived HTML runs with a fresh Date.now() nonce, so the strict HAR lookup misses.
  assert.equal(probe.pageResults.asset, "ERR", "baseline: the volatile-query request must abort");
  assert.equal(probe.pageResults.dup, "ERR");
  assert.equal(probe.pageResults.submit, "ERR");
  assert.equal(probe.pageResults.absent, "ERR");
});

test("normalized fallback serves the archived body and classifies the unexpected requests", async () => {
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
        probe.classifications.push({ url: request.url(), kind: "not-in-archive" });
        await route.abort();
        return;
      }
      if (archivedBodyIsRedacted(matches[0]!)) {
        probe.classifications.push({ url: request.url(), kind: "redacted-post-body" });
        await route.abort();
        return;
      }
      if (matches.length > 1) {
        probe.classifications.push({ url: request.url(), kind: "ambiguous-normalized-match" });
        await route.abort();
        return;
      }
      probe.classifications.push({ url: request.url(), kind: "normalized-match" });
      await route.fallback({ url: matches[0]!.request.url });
    });

    await page.goto(probe.originalUrl, { waitUntil: "load" });
    await page.waitForFunction(
      () => (window as { __done?: boolean }).__done === true,
      undefined,
      { timeout: 10_000 },
    );
  });

  assert.equal(probe.pageResults.asset, "ARCHIVED_ASSET_BODY", "normalized fallback must serve the archived body");
  assert.equal(probe.pageResults.dup, "ERR", "ambiguous normalized match must abort");
  assert.equal(probe.pageResults.submit, "ERR", "redacted POST must abort");
  assert.equal(probe.pageResults.absent, "ERR", "no candidate must abort");

  const asset = probe.classifications.find((c) => c.url.includes("/asset"));
  const dup = probe.classifications.find((c) => c.url.includes("/dup"));
  const submit = probe.classifications.find((c) => c.url.includes("/submit"));
  const absent = probe.classifications.find((c) => c.url.includes("/not-in-archive"));
  assert.equal(asset?.kind, "normalized-match");
  assert.equal(dup?.kind, "ambiguous-normalized-match");
  assert.equal(submit?.kind, "redacted-post-body");
  assert.equal(absent?.kind, "not-in-archive");
});
