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
  };
};

let servers: FixtureServers;
let browser: Browser;
let tempDir: string;

type HarEntry = {
  request: { url: string };
  response?: { content?: { _file?: string } };
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
