import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureHar } from "../../src/capture/record.ts";
import { harResourceUrls } from "../../src/capture/har.ts";

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
  const urls = harResourceUrls(har);

  assert.ok(
    urls.some((url) => new URL(url).pathname === fixtureManifest.assets.crossOriginStylesheet),
    "the HAR is missing the cross-origin stylesheet request",
  );
  assert.ok(
    urls.some((url) => new URL(url).pathname === fixtureManifest.assets.iframeDocument),
    "the HAR is missing the iframe document request",
  );
});
