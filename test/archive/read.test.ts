import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureHar } from "../../src/capture/record.ts";
import { readArchive } from "../../src/archive/read.ts";

const SWEEP_EVALUATE_RESULT = {
  sweepCheckpoints: 2,
  scrolls: 4,
  wallClockMs: 1200,
  height: 2400,
  quietWindow: false,
} as const;

const ENV_EVALUATE_RESULT = {
  origin: "https://example.com",
  viewport: { width: 1280, height: 720 },
  devicePixelRatio: 1,
  locale: "en-US",
  locales: ["en-US"],
  timezoneId: "UTC",
  reducedMotion: "no-preference",
  colorScheme: "light",
  userAgent: "FixtureAgent/1.0",
  fontFaces: { entries: [], truncated: false },
} as const;

/**
 * The archive under test is produced by `captureHar`, not hand-written. A hand-written fixture
 * would assert the reader against this file's idea of the layout rather than against the layout
 * capture actually publishes, which is the one thing the reader has to be right about.
 */
function fakeBrowser(har: unknown) {
  let harPath: string;
  const context = {
    request: { async get() {} },
    newCDPSession: async () => ({
      send: async (method: string) => {
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { loaderId: "A1B2C3D4E5F60718293A4B5C6D7E8F90" } } };
        }
        if (method === "DOM.getDocument") return { root: {} };
        return {};
      },
      on() {},
    }),
    async newPage() {
      let pageUrl = "";
      let evaluation = 0;
      return {
        localStorage: { async items() { return []; } },
        sessionStorage: { async items() { return []; } },
        async goto(url: string) {
          pageUrl = url;
        },
        on() {},
        url() {
          return pageUrl;
        },
        async evaluate<Result>() {
          evaluation += 1;
          if (evaluation === 1) return SWEEP_EVALUATE_RESULT as Result;
          return ENV_EVALUATE_RESULT as Result;
        },
      };
    },
    async close() {
      writeFileSync(harPath, JSON.stringify(har));
    },
  };
  return {
    version() {
      return "Chromium/140.0.0.0";
    },
    async newContext(options: { recordHar: { path: string } }) {
      harPath = options.recordHar.path;
      return context;
    },
  };
}

async function captureFixtureArchive(): Promise<string> {
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-archive-")), "archive");
  await captureHar({
    browser: fakeBrowser({ log: { entries: [] } }),
    url: "https://example.com",
    outDir,
  });
  return outDir;
}

test("readArchive refuses an association that resolves outside the archive root", async () => {
  const root = await captureFixtureArchive();
  try {
    // `checkpoints.json` is what names the other files, so a tampered association is the way an
    // archive points a reader at something it does not own. Publication applies this rule; a
    // reader that trusts the document instead re-opens the hole on every read.
    const checkpointsPath = join(root, "checkpoints.json");
    const doc = JSON.parse(readFileSync(checkpointsPath, "utf8"));
    doc.har = { path: "../outside.har", scope: "run" };
    writeFileSync(checkpointsPath, JSON.stringify(doc));

    await expect(readArchive(root)).rejects.toThrow(/outside the archive root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readArchive returns every document capture published, parsed", async () => {
  const root = await captureFixtureArchive();
  try {
    const archive = await readArchive(root);

    expect(archive.root).toBe(root);
    // The eight files `captureHar` writes. Naming them here is the point: a reader that silently
    // skipped one would otherwise look correct.
    expect(Object.keys(archive.documents).sort()).toEqual([
      "capabilities",
      "checkpoints",
      "commit",
      "environment",
      "requestNormalization",
      "targets",
      "termination",
    ]);
    expect(archive.documents.checkpoints).toMatchObject({ schemaVersion: 1 });
    expect(archive.documents.commit).toMatchObject({ schemaVersion: 1 });
    // The HAR is not JSON and is reported by path, not parsed into memory.
    expect(archive.harPath).toBe(join(root, "network.har"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
