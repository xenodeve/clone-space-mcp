import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { validateCheckpoints } from "../../src/capture/checkpoints.ts";
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
let captureCounter = 0;
const TRANSPORT_SENTINELS = [
  "FAKE_AUTH_SENTINEL",
  "FAKE_COOKIE_SENTINEL",
  "FAKE_QUERY_SENTINEL",
  "FAKE_REQUEST_SENTINEL",
  "FAKE_SET_COOKIE_SENTINEL",
  "FAKE_WEBSOCKET_SENTINEL",
];

type HarEntry = {
  _resourceType?: string;
  request: { url: string };
  response?: { status?: number; content?: { _file?: string } };
};

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

function nextCaptureOutDir(): string {
  captureCounter += 1;
  return join(tempDir, `archive-${captureCounter}`);
}

function credentialLeaks(harPath: string): string[] {
  return filesUnder(dirname(harPath)).flatMap((path) => {
    const content = readFileSync(path, "utf8");
    return TRANSPORT_SENTINELS.filter((sentinel) => content.includes(sentinel)).map(
      (sentinel) => `${path}: ${sentinel}`,
    );
  });
}

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
    outDir: nextCaptureOutDir(),
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

  for (const { entry, url } of normalizedEntries) {
    const responseFile = entry.response?.content?._file;
    if (!responseFile || entry.response?.status !== 200) continue;
    const expected = Buffer.from(
      new Uint8Array((await fetch(url).then((response) => response.arrayBuffer())) as ArrayBuffer),
    );
    const attached = readFileSync(resolve(dirname(harPath), responseFile));
    assert.deepEqual(attached, expected, `redaction changed response attachment for ${url.href}`);
  }
});

test("sweeps the page to capture the IntersectionObserver-gated lazy image", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: nextCaptureOutDir(),
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
    outDir: nextCaptureOutDir(),
  });
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const entries = har.log.entries as HarEntry[];
  const sourcemap = new URL(fixtureManifest.assets.sourcemap, servers.primary.url);
  const sourcemapEntry = entries.find((entry) => entry.request.url === sourcemap.href);

  assert.ok(sourcemapEntry, "the HAR is missing the published sourcemap request");
  assert.equal(sourcemapEntry.response?.status, 200, "the published sourcemap request did not succeed");
  const attachedFile = sourcemapEntry.response?.content?._file;
  assert.ok(attachedFile, "the sourcemap entry is missing attached content");
  const capturedMapText = readFileSync(resolve(dirname(harPath), attachedFile), "utf8");
  const publishedMapText = await fetch(sourcemap).then((response) => response.text());
  assert.equal(capturedMapText, publishedMapText, "redaction changed the sourcemap response body");
  const capturedMap = JSON.parse(capturedMapText) as {
    mappings?: string;
  };
  assert.ok(capturedMap.mappings, "the attached sourcemap has no mappings");
});

test("requests the instrumented script exactly once (no discovery re-fetch)", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: nextCaptureOutDir(),
  });
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const entries = har.log.entries as HarEntry[];
  const script = new URL("/build/instrumented.js", servers.primary.url);
  const scriptEntries = entries.filter((entry) => entry.request.url === script.href);

  assert.equal(
    scriptEntries.length,
    1,
    `expected exactly one request for the instrumented script, got ${scriptEntries.length}`,
  );
});

test("captures the sourcemap of a cross-origin script the page cannot read", async () => {
  const page = new URL("/cross-origin-script.html", servers.primary.url);
  const sourcemap = new URL("/instrumented.js.map", servers.crossOrigin.url);

  const harPath = await captureHar({
    browser,
    url: page.href,
    outDir: nextCaptureOutDir(),
  });
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const entries = har.log.entries as HarEntry[];
  const sourcemapEntry = entries.find((entry) => entry.request.url === sourcemap.href);

  assert.ok(sourcemapEntry, "the HAR is missing the sourcemap of the cross-origin script");
  assert.equal(
    sourcemapEntry.response?.status,
    200,
    "the cross-origin sourcemap request did not succeed",
  );
});

test("redacts transport credentials from the HAR and attached request bodies", async () => {
  const harPath = await captureHar({
    browser,
    url: new URL("/credential-probe.html", servers.primary.url).href,
    outDir: nextCaptureOutDir(),
  });
  const leakedByFile = credentialLeaks(harPath);
  const har = JSON.parse(readFileSync(harPath, "utf8")) as { log: { entries: HarEntry[] } };
  const webSocketEntry = har.log.entries.find((entry) => entry._resourceType === "websocket");
  const webSocketFrames = webSocketEntry?.response?.content?._file;

  assert.deepEqual(leakedByFile, [], `archive leaked credentials:\n${leakedByFile.join("\n")}`);
  assert.ok(webSocketFrames, "fixture did not produce an attached WebSocket frame file");
  assert.equal(readFileSync(resolve(dirname(harPath), webSocketFrames), "utf8"), "[REDACTED]\n");
});

test("publishes a checkpoints.json that validateCheckpoints accepts", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: nextCaptureOutDir(),
  });
  const checkpointsPath = resolve(dirname(harPath), "checkpoints.json");
  assert.ok(existsSync(checkpointsPath), "published archive is missing checkpoints.json");
  const checkpoints = JSON.parse(readFileSync(checkpointsPath, "utf8"));
  assert.deepEqual(validateCheckpoints(checkpoints), { ok: true });
});

test("associates the published checkpoints document with the run HAR", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: nextCaptureOutDir(),
  });
  const archiveRoot = dirname(harPath);
  const checkpoints = JSON.parse(
    readFileSync(resolve(archiveRoot, "checkpoints.json"), "utf8"),
  ) as { har?: { path?: string; scope?: string } };

  assert.equal(checkpoints.har?.path, "network.har");
  assert.equal(checkpoints.har?.scope, "run");
  assert.ok(existsSync(resolve(archiveRoot, "network.har")), "the associated HAR file is missing");
});

test("publishes detected capabilities for the primary motion fixture", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: nextCaptureOutDir(),
  });
  const archiveRoot = dirname(harPath);
  const capabilitiesPath = resolve(archiveRoot, "capabilities.json");
  const checkpoints = JSON.parse(
    readFileSync(resolve(archiveRoot, "checkpoints.json"), "utf8"),
  ) as { capabilities?: { path?: string; scope?: string } };

  assert.equal(checkpoints.capabilities?.path, "capabilities.json");
  assert.equal(checkpoints.capabilities?.scope, "run");
  assert.deepEqual(JSON.parse(readFileSync(capabilitiesPath, "utf8")), {
    schemaVersion: 1,
    flags: {
      serviceWorkerDependent: false,
      webSocketDependent: false,
      closedShadowRootPresent: false,
      // The motion fixture's instrumented script deliberately declares a sourcemap.
      sourcemapDeclared: true,
    },
  });
  assert.equal(statSync(capabilitiesPath).mode & 0o600, 0o600);
});

test("publishes true capabilities for the capability fixture", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.capability.url,
    outDir: nextCaptureOutDir(),
  });
  const capabilities = JSON.parse(
    readFileSync(resolve(dirname(harPath), "capabilities.json"), "utf8"),
  );

  assert.deepEqual(capabilities, {
    schemaVersion: 1,
    flags: {
      serviceWorkerDependent: true,
      webSocketDependent: true,
      closedShadowRootPresent: true,
      sourcemapDeclared: true,
    },
  });

  const har = JSON.parse(readFileSync(harPath, "utf8")) as { log: { entries: HarEntry[] } };
  const lateMapUrl = new URL("/late-instrumented.js.map", servers.capability.url).href;
  assert.ok(
    har.log.entries.some((entry) => entry.request.url === lateMapUrl),
    "the HAR is missing the sourcemap declared by the script loaded during the sweep",
  );
});

test("publishes the requested and observed environment without non-allowlisted storage", async () => {
  const outDir = nextCaptureOutDir();
  const harPath = await captureHar({
    browser,
    url: new URL("/environment-probe.html", servers.primary.url).href,
    outDir,
    environment: {
      viewport: { width: 900, height: 600 },
      deviceScaleFactor: 2,
      locale: "th-TH",
      timezoneId: "Asia/Bangkok",
      reducedMotion: "reduce",
      colorScheme: "dark",
      userAgent: "CloneSpaceFixture/1.0",
    },
    storageAllowlist: {
      localStorage: ["theme", "missing-key"],
      sessionStorage: ["panel"],
    },
    browserChannel: "chromium",
  });
  const environmentText = readFileSync(resolve(dirname(harPath), "environment.json"), "utf8");
  const environment = JSON.parse(environmentText);

  assert.deepEqual(environment.capture.requested, {
    viewport: { width: 900, height: 600 },
    deviceScaleFactor: 2,
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    reducedMotion: "reduce",
    colorScheme: "dark",
    userAgent: "CloneSpaceFixture/1.0",
  });
  assert.deepEqual(environment.capture.observed.viewport, { width: 900, height: 600 });
  assert.equal(environment.capture.observed.devicePixelRatio, 2);
  assert.equal(environment.capture.observed.locale, "th-TH");
  assert.equal(environment.capture.observed.timezoneId, "Asia/Bangkok");
  assert.equal(environment.capture.observed.reducedMotion, "reduce");
  assert.equal(environment.capture.observed.colorScheme, "dark");
  assert.equal(environment.capture.observed.userAgent, "CloneSpaceFixture/1.0");
  assert.ok(Array.isArray(environment.capture.observed.userAgentData.brands));
  assert.equal(typeof environment.capture.observed.userAgentData.mobile, "boolean");
  assert.equal(typeof environment.capture.observed.userAgentData.platform, "string");
  assert.deepEqual(environment.replay.requiredBrowser, {
    name: "chromium",
    version: browser.version(),
    playwrightVersion: "1.62.0",
    channel: "chromium",
  });
  assert.deepEqual(environment.replay.context, environment.capture.requested);
  assert.deepEqual(environment.replay.storage.allowlist.localStorage, ["missing-key", "theme"]);
  assert.deepEqual(environment.replay.storage.localStorage, [{ name: "theme", value: "dark" }]);
  assert.deepEqual(environment.replay.storage.sessionStorage, [{ name: "panel", value: "open" }]);
  assert.equal(environment.omissions.storage.omittedLocalStorageEntries, 1);
  assert.equal(environment.omissions.storage.omittedSessionStorageEntries, 1);
  assert.ok(
    environment.capture.observed.fontFaces.entries.some(
      (entry: { family: string }) => entry.family.includes("Alpha Fixture 299"),
    ),
    `the declared fixture FontFace is missing: ${JSON.stringify(
      environment.capture.observed.fontFaces.entries.slice(0, 3),
    )}`,
  );
  assert.equal(environment.capture.observed.fontFaces.entries.length, 256);
  assert.equal(environment.capture.observed.fontFaces.truncated, true);
  assert.doesNotMatch(environmentText, /PRIVATE_(LOCAL|SESSION)_VALUE/);
  assert.doesNotMatch(environmentText, /private-(local|session)-name/);
  assert.doesNotMatch(environmentText, /redirect-secret|CROSS_ORIGIN_VALUE/);
});

test("refuses to publish storage captured after a cross-origin redirect", async () => {
  const outDir = nextCaptureOutDir();

  await assert.rejects(
    captureHar({
      browser,
      url: new URL("/cross-origin-redirect.html", servers.primary.url).href,
      outDir,
      storageAllowlist: { localStorage: ["redirect-secret"] },
    }),
    /cross-origin redirect/,
  );
  assert.equal(existsSync(outDir), false);
});

test("does not publish raw credentials when a failed capture is retried", async () => {
  const outDir = nextCaptureOutDir();

  await assert.rejects(
    captureHar({
      browser,
      url: new URL("/credential-probe-fail.html", servers.primary.url).href,
      outDir,
    }),
    /fixture sweep failure/,
  );
  assert.equal(existsSync(outDir), false, "failed capture published its staging directory");
  assert.equal(
    readdirSync(tempDir).some((name) => name.startsWith(`.${basename(outDir)}-capture-`)),
    false,
    "failed capture left private staging behind",
  );

  const harPath = await captureHar({
    browser,
    url: new URL("/credential-probe.html", servers.primary.url).href,
    outDir,
  });
  assert.deepEqual(credentialLeaks(harPath), []);
});

test("continues when an external script cannot be read for sourcemap discovery", async () => {
  const scriptUrl = new URL("/motion.js", servers.primary.url);
  const page = encodeURIComponent(`<script src="${scriptUrl.href}"></script>`);

  await assert.doesNotReject(
    captureHar({
      browser,
      url: `data:text/html,${page}`,
      outDir: nextCaptureOutDir(),
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
      outDir: nextCaptureOutDir(),
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("the capture sweep did not terminate")), 1_500);
    }),
  ]);
});

test("publishes an opaque document epoch instead of the page URL", async () => {
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: nextCaptureOutDir(),
  });
  const checkpoints = JSON.parse(
    readFileSync(resolve(dirname(harPath), "checkpoints.json"), "utf8"),
  ) as { checkpoints: Array<{ primaryTarget: { documentEpoch: string } }> };

  const firstCheckpoint = checkpoints.checkpoints[0];
  assert.ok(firstCheckpoint, "the archive published no checkpoint at all");
  assert.doesNotMatch(
    firstCheckpoint.primaryTarget.documentEpoch,
    /http/,
    "document epoch must not contain the page URL",
  );
});

test("gives two different documents two different opaque epochs", async () => {
  const epochOf = async (url: string): Promise<string> => {
    const harPath = await captureHar({ browser, url, outDir: nextCaptureOutDir() });
    const doc = JSON.parse(readFileSync(resolve(dirname(harPath), "checkpoints.json"), "utf8")) as {
      checkpoints: Array<{ primaryTarget: { documentEpoch: string } }>;
    };
    const epoch = doc.checkpoints[0]?.primaryTarget.documentEpoch;
    assert.ok(epoch, "the archive published no checkpoint at all");
    return epoch;
  };

  const rootEpoch = await epochOf(servers.primary.url);
  const frameEpoch = await epochOf(
    new URL(fixtureManifest.assets.iframeDocument, servers.primary.url).href,
  );

  // Spelled out rather than imported from the validator: a test that shares the constant it
  // checks cannot disagree with the code, and loosening one would silently loosen the other.
  const OPAQUE_EPOCH = /^epoch:[0-9A-Za-z_-]{16,}$/;
  assert.notEqual(rootEpoch, frameEpoch, "two different documents must not share one epoch");
  assert.match(rootEpoch, OPAQUE_EPOCH);
  assert.match(frameEpoch, OPAQUE_EPOCH);
});

test("binds environment.json to the final checkpoint", async () => {
  // ADR 0005: environment.json must carry the final checkpoint's checkpointId,
  // document epoch, and monotonic timestamp. A presence-only check would accept
  // garbage; naming a non-final checkpoint is the incoherence §6.3 exists to catch.
  const harPath = await captureHar({
    browser,
    url: servers.primary.url,
    outDir: nextCaptureOutDir(),
  });
  const archiveRoot = dirname(harPath);
  const environment = JSON.parse(
    readFileSync(resolve(archiveRoot, "environment.json"), "utf8"),
  ) as { checkpoint?: unknown };
  const checkpoints = JSON.parse(
    readFileSync(resolve(archiveRoot, "checkpoints.json"), "utf8"),
  ) as {
    checkpoints: Array<{
      checkpointId: string;
      openedAt: number;
      primaryTarget: { documentEpoch: string };
    }>;
  };
  const finalCheckpoint = checkpoints.checkpoints[checkpoints.checkpoints.length - 1];
  assert.ok(finalCheckpoint, "checkpoints.json has no final checkpoint");

  assert.ok(
    environment.checkpoint &&
      typeof environment.checkpoint === "object" &&
      !Array.isArray(environment.checkpoint),
    "environment.json is missing final-checkpoint binding",
  );
  const binding = environment.checkpoint as {
    checkpointId?: unknown;
    documentEpoch?: unknown;
    openedAt?: unknown;
  };
  assert.equal(
    binding.checkpointId,
    finalCheckpoint.checkpointId,
    "environment checkpointId does not match the final checkpoint",
  );
  assert.equal(
    binding.documentEpoch,
    finalCheckpoint.primaryTarget.documentEpoch,
    "environment documentEpoch does not match the final checkpoint",
  );
  assert.equal(
    binding.openedAt,
    finalCheckpoint.openedAt,
    "environment openedAt does not match the final checkpoint",
  );
});

test("captures the volatile-key policy and preserves the raw request evidence", async () => {
  const pageUrl = new URL("/request-normalization.html", servers.capability.url);
  const harPath = await captureHar({
    browser,
    url: pageUrl.href,
    outDir: nextCaptureOutDir(),
    volatileQueryKeys: ["_t"],
  });

  // The fixture server recorded the raw request (method + URL) it served for this page.
  const observed = (await fetch(new URL("/__observed-request-urls", servers.capability.url)).then(
    (response) => response.json(),
  )) as Array<{ method: string; url: string }>;
  const observedEntry = observed.find((entry) => entry.url.includes("/request-normalization-endpoint"));
  assert.ok(observedEntry, "the fixture server never observed the request-normalization request");
  assert.equal(observedEntry.method, "GET", "the observed request was not a GET");
  const observedUrl = new URL(observedEntry.url);

  const policy = JSON.parse(
    readFileSync(join(dirname(harPath), "request-normalization.json"), "utf8"),
  ) as { query: { volatileKeys: string[] } };
  assert.deepEqual(policy.query.volatileKeys, ["_t"]);

  // The raw HAR retains the full observed URL, including the volatile `_t` value.
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const entries = har.log.entries as HarEntry[];
  const requestEntry = entries.find((entry) => entry.request.url === observedEntry.url);
  assert.ok(requestEntry, "the HAR is missing the server-observed request");
  const observedT = observedUrl.searchParams.get("_t");
  assert.ok(observedT, "observed request is missing the volatile _t value");
  assert.ok(requestEntry.request.url.includes(`_t=${observedT}`), "raw HAR URL lost the volatile _t value");
  assert.equal(observedUrl.searchParams.get("tag"), "capture", "stable query parameter missing from observed request");

  // The pure normalizer (the same one replay will use) removes exactly `_t` and nothing else.
  const { normalizeRequestUrl } = await import("../../src/capture/request-normalization.ts");
  assert.equal(
    normalizeRequestUrl(observedEntry.url, ["_t"]),
    `${observedUrl.origin}/request-normalization-endpoint?tag=capture`,
    "normalization must remove only the allowlisted _t parameter",
  );
});
