import { describe, expect, test } from "bun:test";
import { harResourceUrls } from "../../src/capture/har.ts";

describe("harResourceUrls", () => {
  test("returns three URLs in entry order", () => {
    const har = {
      log: {
        entries: [
          { request: { url: "https://example.com/index.html" } },
          { request: { url: "https://example.com/styles.css" } },
          { request: { url: "https://example.com/app.js" } },
        ],
      },
    };

    expect(harResourceUrls(har)).toEqual([
      "https://example.com/index.html",
      "https://example.com/styles.css",
      "https://example.com/app.js",
    ]);
  });

  test("returns an empty array for no entries", () => {
    const har = { log: { entries: [] } };

    expect(harResourceUrls(har)).toEqual([]);
  });

  test("does not deduplicate repeated URLs", () => {
    const har = {
      log: {
        entries: [
          { request: { url: "https://example.com/app.js" } },
          { request: { url: "https://example.com/app.js" } },
        ],
      },
    };

    expect(harResourceUrls(har)).toEqual([
      "https://example.com/app.js",
      "https://example.com/app.js",
    ]);
  });

  test("does not mutate the input", () => {
    const entries = [
      { request: { url: "https://example.com/index.html" } },
      { request: { url: "https://example.com/app.js" } },
    ];
    const har = {
      log: {
        entries,
      },
    };

    harResourceUrls(har);

    expect(har.log.entries).toBe(entries);
  });
});
