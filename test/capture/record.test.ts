import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
        path: harPath,
        mode: "full",
        content: "attach",
      },
    });
    expect(gotoCall).toEqual({ url, options: { waitUntil: "load" } });
    expect(contextClosed).toBe(true);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
