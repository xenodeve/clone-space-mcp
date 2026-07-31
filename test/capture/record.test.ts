import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureHar } from "../../src/capture/record.ts";

test("captureHar configures and drives a browser context", async () => {
  let contextOptions: unknown;
  let gotoCall: unknown;
  let contextClosed = false;
  let harPath: string | undefined;
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-unit-"));

  const context = {
    request: {
      async get() {},
    },
    async newPage() {
      return {
        async goto(url: string, options: { waitUntil: "load" }) {
          gotoCall = { url, options };
        },
        on() {},
        async evaluate<Result>() {
          return undefined as Result;
        },
      };
    },
    async close() {
      contextClosed = true;
      writeFileSync(harPath!, '{"log":{"entries":[]}}');
    },
  };

  const browser = {
    async newContext(options: { recordHar: { path: string } }) {
      contextOptions = options;
      harPath = options.recordHar.path;
      return context;
    },
  };

  const url = "https://example.com";
  try {
    harPath = await captureHar({ browser, url, outDir });

    expect(harPath.endsWith("network.har")).toBe(true);
    expect(contextOptions).toEqual({
      recordHar: {
        path: expect.any(String),
        mode: "full",
        content: "attach",
      },
    });
    expect((contextOptions as { recordHar: { path: string } }).recordHar.path).not.toBe(harPath);
    expect(gotoCall).toEqual({ url, options: { waitUntil: "load" } });
    expect(contextClosed).toBe(true);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar refuses to mix a new capture with existing archive files", async () => {
  const root = mkdtempSync(join(tmpdir(), "clone-space-record-existing-"));
  const outDir = join(root, "archive");
  const existing = join(outDir, "old-sidecar.txt");
  let browserCalled = false;
  mkdirSync(outDir);
  writeFileSync(existing, "EXISTING_SENTINEL");

  try {
    await expect(
      captureHar({
        browser: {
          async newContext() {
            browserCalled = true;
            throw new Error("browser must not be called");
          },
        },
        url: "https://example.com",
        outDir,
      }),
    ).rejects.toThrow(/output directory must be empty/);
    expect(browserCalled).toBe(false);
    expect(readFileSync(existing, "utf8")).toBe("EXISTING_SENTINEL");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
