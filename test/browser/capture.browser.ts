import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureHar } from "../../src/capture/record.ts";

const fixtureManifest = JSON.parse(
  readFileSync(new URL("../fixtures/motion-site/fixture-manifest.json", import.meta.url), "utf8"),
) as {
  assets: {
    crossOriginStylesheet: string;
    iframeDocument: string;
    lazyImage: string;
    sourcemap: string;
  };
};

let servers: FixtureServers;
let browser: Browser;
let tempDir: string;

type HarEntry = {
  request: { url: string };
  response?: { status?: number; content?: { _file?: string } };
};

before(async () => {
  servers = await startFixtureServers();
  browser = await chromium.launch();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-capture-"));
});

after(async () => {
  await browser?.close();
  await servers?.stop();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test("captures cross-origin stylesheet and iframe document requests in the HAR", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: tempDir,
  });
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const entries = har.log.entries as HarEntry[];
  const normalizedEntries = entries.map((entry) => ({
    entry,
    url: new URL(entry.request.url),
  }));
  const crossOrigin = new URL(servers.crossOrigin.url).origin;
  const stylesheetEntry = normalizedEntries.find(({ url }) => {
    return url.origin === crossOrigin && url.pathname === fixtureManifest.assets.crossOriginStylesheet;
  })?.entry;

  assert.ok(stylesheetEntry, "the HAR is missing the cross-origin stylesheet request");
  const attachedFile = stylesheetEntry.response?.content?._file;
  assert.ok(attachedFile, "the stylesheet entry is missing attached content");
  const attachedPath = resolve(dirname(harPath), attachedFile);
  assert.ok(existsSync(attachedPath), `attached stylesheet file does not exist: ${attachedPath}`);
  assert.ok(statSync(attachedPath).size > 0, "attached stylesheet file is empty");
  assert.equal(
    readFileSync(attachedPath, "utf8"),
    readFileSync(new URL("../fixtures/cross-origin/theme.css", import.meta.url), "utf8"),
    "attached stylesheet content does not match the fixture",
  );
  assert.ok(
    normalizedEntries.some(({ url }) => url.pathname === fixtureManifest.assets.iframeDocument),
    "the HAR is missing the iframe document request",
  );
});

test("sweeps the page to capture the IntersectionObserver-gated lazy image", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: tempDir,
  });
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const entries = har.log.entries as HarEntry[];
  const lazyImage = new URL(fixtureManifest.assets.lazyImage, servers.primary.url);

  assert.ok(
    entries.some((entry) => entry.request.url === lazyImage.href),
    "the HAR is missing the lazy image request triggered by the capture sweep",
  );
});

test("captures the published sourcemap request in the HAR", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: tempDir,
  });
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const entries = har.log.entries as HarEntry[];
  const sourcemap = new URL(fixtureManifest.assets.sourcemap, servers.primary.url);
  const sourcemapEntry = entries.find((entry) => entry.request.url === sourcemap.href);

  assert.ok(sourcemapEntry, "the HAR is missing the published sourcemap request");
  assert.equal(sourcemapEntry.response?.status, 200, "the published sourcemap request did not succeed");
  const attachedFile = sourcemapEntry.response?.content?._file;
  assert.ok(attachedFile, "the sourcemap entry is missing attached content");
  const capturedMap = JSON.parse(readFileSync(resolve(dirname(harPath), attachedFile), "utf8")) as {
    mappings?: string;
  };
  assert.ok(capturedMap.mappings, "the attached sourcemap has no mappings");
});

test("continues when an external script cannot be read for sourcemap discovery", async () => {
  const scriptUrl = new URL("/motion.js", servers.primary.url);
  const page = encodeURIComponent(`<script src="${scriptUrl.href}"></script>`);

  await assert.doesNotReject(
    captureHar({
      browser,
      url: `data:text/html,${page}`,
      outDir: tempDir,
    }),
  );
});

test("stops after three empty checkpoints when scrolling cannot advance", async () => {
  const lockedPage = encodeURIComponent(`
    <body style="height: 5000px">
      <script>window.scrollTo = () => {};</script>
    </body>
  `);

  await Promise.race([
    captureHar({
      browser,
      url: `data:text/html,${lockedPage}`,
      outDir: tempDir,
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("the capture sweep did not terminate")), 1_500);
    }),
  ]);
});
