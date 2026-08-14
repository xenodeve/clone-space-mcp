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

test("readArchive reports contract coverage, separating not-produced from missing", async () => {
  const root = await captureFixtureArchive();
  try {
    const { contracts } = await readArchive(root);
    const status = Object.fromEntries(contracts.map((c) => [c.section, c.status]));

    // Eight contracts land in an artifact and this archive carries all eight.
    for (const section of ["§6.1", "§6.2", "§6.3", "§6.4", "§6.5", "§6.8", "§6.9", "§6.10"]) {
      expect(status[section]).toBe("present");
    }
    // The other three publish nothing today: §6.6 is a type, §6.7 and §6.11 have a schema and no
    // capture wiring. Reporting them as "missing" would call a complete archive broken.
    for (const section of ["§6.6", "§6.7", "§6.11"]) {
      expect(status[section]).toBe("not-produced");
    }

    rmSync(join(root, "targets.json"));
    const damaged = await readArchive(root);
    const after = Object.fromEntries(damaged.contracts.map((c) => [c.section, c.status]));
    expect(after["§6.9"]).toBe("missing");
    expect(after["§6.7"]).toBe("not-produced");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readArchive verifies the commit and names the artifact that no longer matches", async () => {
  const root = await captureFixtureArchive();
  try {
    const clean = await readArchive(root);
    expect(clean.integrity).toEqual({ ok: true, mismatched: [] });

    writeFileSync(join(root, "capabilities.json"), '{"schemaVersion":1,"flags":{}}');
    const tampered = await readArchive(root);
    // A verdict of "not ok" is where `validateCommit` stops, because it is a fail-closed gate.
    // A reader is a diagnostic, so it also says which file stopped being what the commit recorded.
    expect(tampered.integrity.ok).toBe(false);
    expect(tampered.integrity.mismatched).toEqual(["capabilities.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
