import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureHar } from "../../src/capture/record.ts";

const fixtureManifest = JSON.parse(
  readFileSync(new URL("../fixtures/motion-site/fixture-manifest.json", import.meta.url), "utf8"),
) as {
  assets: {
    crossOriginStylesheet: string;
    iframeDocument: string;
  };
};

let servers: FixtureServers;
let browser: Browser;
let tempDir: string;

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
  const entries = har.log.entries;
  const crossOrigin = new URL(servers.crossOrigin.url).origin;
  const stylesheetEntry = entries.find((entry: { request: { url: string } }) => {
    const url = new URL(entry.request.url);
    return url.origin === crossOrigin && url.pathname === fixtureManifest.assets.crossOriginStylesheet;
  });

  assert.ok(stylesheetEntry, "the HAR is missing the cross-origin stylesheet request");
  assert.ok(
    stylesheetEntry.response?.content?._file,
    "the stylesheet entry is missing attached content",
  );
  assert.ok(
    entries.some(
      (entry: { request: { url: string } }) =>
        new URL(entry.request.url).pathname === fixtureManifest.assets.iframeDocument,
    ),
    "the HAR is missing the iframe document request",
  );
});
