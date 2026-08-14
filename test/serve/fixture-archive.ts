import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureHar } from "../../src/capture/record.ts";

/**
 * Which `page.evaluate` call this is, decided by **what is being evaluated** rather than by how
 * many times it has been called (#140). A counter makes a fake's answers depend on the number of
 * `evaluate` calls production code happens to make, which is not part of any contract — adding one
 * anywhere in `captureHar` silently re-points every later one. Measured on #114: two added calls
 * broke four tests that had nothing to do with the feature.
 */
export function isSweepEvaluate(arg: unknown): boolean {
  return typeof arg === "object" && arg !== null && "budgets" in arg;
}

/** A fake handed an argument it does not recognise must fail loudly, not answer the wrong slot. */
export function refuseUnknownEvaluate(arg: unknown): never {
  throw new Error(`fake browser: unrecognised evaluate argument ${JSON.stringify(arg)}`);
}


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
export function fakeBrowser(har: unknown) {
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
        async evaluate<Result>(_fn?: unknown, arg?: unknown) {
          if (isSweepEvaluate(arg)) return SWEEP_EVALUATE_RESULT as Result;
          if (arg !== undefined) refuseUnknownEvaluate(arg);
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

export async function captureFixtureArchive(): Promise<string> {
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-archive-")), "archive");
  await captureHar({
    browser: fakeBrowser({ log: { entries: [] } }),
    url: "https://example.com",
    outDir,
  });
  return outDir;
}

