import { describe, expect, test } from "bun:test";
import { findAmbiguousNormalizedRequests } from "../../src/capture/request-normalization.ts";

type HarEntry = {
  _resourceType?: string;
  request?: { url?: unknown; method?: unknown };
};

function entry(url: string, method: string, resourceType?: string): HarEntry {
  return { _resourceType: resourceType, request: { url, method } };
}

describe("findAmbiguousNormalizedRequests", () => {
  test("returns an empty list when no group has more than one distinct raw URL", () => {
    const entries: HarEntry[] = [
      entry("https://example.com/a?_t=1", "GET"),
      entry("https://example.com/b?x=2", "GET"),
      entry("https://example.com/a?_t=1", "GET"), // exact duplicate raw URL
    ];
    expect(findAmbiguousNormalizedRequests(entries, ["_t"])).toEqual([]);
  });

  test("flags two distinct raw URLs that collapse under the policy", () => {
    const entries: HarEntry[] = [
      entry("https://example.com/dup?_t=aaa", "GET"),
      entry("https://example.com/dup?_t=bbb", "GET"),
    ];
    const ambiguous = findAmbiguousNormalizedRequests(entries, ["_t"]);
    expect(ambiguous.length).toBe(1);
    expect(ambiguous[0]).toContain("https://example.com/dup");
  });

  test("does not flag exact-duplicate raw URLs", () => {
    const entries: HarEntry[] = [
      entry("https://example.com/a?_t=1", "GET"),
      entry("https://example.com/a?_t=1", "GET"),
    ];
    expect(findAmbiguousNormalizedRequests(entries, ["_t"])).toEqual([]);
  });

  test("treats different methods as separate groups", () => {
    const entries: HarEntry[] = [
      entry("https://example.com/a?_t=1", "GET"),
      entry("https://example.com/a?_t=2", "POST"),
    ];
    expect(findAmbiguousNormalizedRequests(entries, ["_t"])).toEqual([]);
  });

  test("ignores WebSocket entries", () => {
    const entries: HarEntry[] = [
      entry("wss://example.com/socket", "GET", "websocket"),
      entry("https://example.com/a?_t=1", "GET"),
      entry("https://example.com/a?_t=2", "GET"),
    ];
    const ambiguous = findAmbiguousNormalizedRequests(entries, ["_t"]);
    expect(ambiguous.length).toBe(1);
  });

  test("ignores a WebSocket entry even without a request object", () => {
    const entries: HarEntry[] = [{ _resourceType: "websocket" }];
    expect(findAmbiguousNormalizedRequests(entries, ["_t"])).toEqual([]);
  });

  test("fails closed on a malformed entry", () => {
    expect(() => findAmbiguousNormalizedRequests([entry("https://example.com/a", "GET"), {}], ["_t"])).toThrow(
      /malformed HAR request entry/,
    );
    expect(() => findAmbiguousNormalizedRequests([{ request: { url: "https://example.com/a" } }], ["_t"])).toThrow(
      /malformed HAR request entry/,
    );
  });

  test("fails closed on an invalid URL", () => {
    expect(() => findAmbiguousNormalizedRequests([entry("not a url", "GET")], ["_t"])).toThrow(
      /invalid request URL/,
    );
  });
});
