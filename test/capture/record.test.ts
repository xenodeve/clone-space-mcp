import { expect, test } from "bun:test";
import { captureHar } from "../../src/capture/record.ts";

test("captureHar configures and drives a browser context", async () => {
  let contextOptions: unknown;
  let gotoCall: unknown;
  let contextClosed = false;

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
    },
  };

  const browser = {
    async newContext(options: unknown) {
      contextOptions = options;
      return context;
    },
  };

  const url = "https://example.com";
  const harPath = await captureHar({ browser, url, outDir: "test-output" });

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
});
