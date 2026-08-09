import { describe, expect, test } from "bun:test";
import {
  normalizePolicyKeys,
  normalizeRequestUrl,
  requestKey,
  type NormalizationOutcome,
} from "../../src/capture/request-normalization.ts";

describe("normalizePolicyKeys", () => {
  test("undefined input becomes an empty list", () => {
    expect(normalizePolicyKeys(undefined)).toEqual([]);
  });

  test("keys are lowercased and sorted deterministically", () => {
    expect(normalizePolicyKeys(["Timestamp", "_t", "Nonce", "ts"])).toEqual(["_t", "nonce", "timestamp", "ts"]);
  });

  test("rejects an empty key", () => {
    expect(() => normalizePolicyKeys(["_t", ""])).toThrow(/empty volatile query key/);
  });

  test("rejects a duplicate key after lowercasing", () => {
    expect(() => normalizePolicyKeys(["_t", "_T"])).toThrow(/duplicate volatile query key: _t/);
  });

  test("keeps separator-distinct keys apart (_t vs t, x-t vs xt)", () => {
    expect(normalizePolicyKeys(["_t", "t"])).toEqual(["_t", "t"]);
    expect(normalizePolicyKeys(["x-t", "xt"])).toEqual(["x-t", "xt"]);
  });

  test("does not mutate the input array", () => {
    const input = ["Nonce", "_t"];
    normalizePolicyKeys(input);
    expect(input).toEqual(["Nonce", "_t"]);
  });
});

describe("normalizeRequestUrl", () => {
  test("removes every occurrence of an allowlisted key and preserves relative order", () => {
    expect(normalizeRequestUrl("https://example.com/api?tag=capture&_t=1&a=2&_t=3&b=4", ["_t"])).toBe(
      "https://example.com/api?tag=capture&a=2&b=4",
    );
  });

  test("preserves scheme, host, port, path and non-allowlisted values", () => {
    expect(normalizeRequestUrl("https://sub.example.com:8443/path?keep=yes&v=7", ["v"])).toBe(
      "https://sub.example.com:8443/path?keep=yes",
    );
  });

  test("matches keys case-insensitively and exactly", () => {
    expect(normalizeRequestUrl("https://example.com/api?Token=abc&_t=1", ["token"])).toBe(
      "https://example.com/api?_t=1",
    );
    // `t` must NOT strip `_t` and vice versa
    expect(normalizeRequestUrl("https://example.com/api?t=1&_t=2", ["t"])).toBe(
      "https://example.com/api?_t=2",
    );
  });

  test("returns the URL unchanged when no allowlisted key is present", () => {
    const url = "https://example.com/api?a=1&b=2";
    expect(normalizeRequestUrl(url, ["_t"])).toBe(url);
  });

  test("does not canonicalize host, port, path or encoding (PRD out-of-scope)", () => {
    // Default port, empty path, dot-segment and percent-encoding must survive verbatim.
    expect(normalizeRequestUrl("https://example.com:443/api?x=1&_t=2", ["_t"])).toBe(
      "https://example.com:443/api?x=1",
    );
    expect(normalizeRequestUrl("https://example.com?a=1&_t=1", ["_t"])).toBe(
      "https://example.com?a=1",
    );
    expect(normalizeRequestUrl("https://example.com/a/./b?x=%20&_t=1", ["_t"])).toBe(
      "https://example.com/a/./b?x=%20",
    );
  });

  test("drops the query entirely when every parameter was allowlisted", () => {
    expect(normalizeRequestUrl("https://example.com/api?_t=1", ["_t"])).toBe(
      "https://example.com/api",
    );
    // When other params remain, the query string survives with the `?`.
    expect(normalizeRequestUrl("https://example.com/api?x=1&_t=2", ["_t"])).toBe(
      "https://example.com/api?x=1",
    );
  });

  test("preserves a fragment", () => {
    expect(normalizeRequestUrl("https://example.com/api?x=1&_t=2#section", ["_t"])).toBe(
      "https://example.com/api?x=1#section",
    );
  });

  test("handles an empty key list", () => {
    const url = "https://example.com/api?_t=1";
    expect(normalizeRequestUrl(url, [])).toBe(url);
  });

  test("fails closed on an invalid absolute URL without echoing it", () => {
    expect(() => normalizeRequestUrl("https://[broken", ["_t"])).toThrow(/invalid request URL/);
    // The raw URL must not appear in the error — it may carry the credentials being stripped.
    expect(() => normalizeRequestUrl("https://[broken?token=SECRET", ["_t"])).not.toThrow(
      /SECRET/,
    );
  });

  test("does not mutate the input URL string", () => {
    const url = "https://example.com/api?_t=1&a=2";
    normalizeRequestUrl(url, ["_t"]);
    expect(url).toBe("https://example.com/api?_t=1&a=2");
  });
});

describe("requestKey", () => {
  test("produces distinct keys for distinct method + normalized URL pairs", () => {
    const a = requestKey("GET", "https://example.com/api?a=1");
    const b = requestKey("POST", "https://example.com/api?a=1");
    const c = requestKey("GET", "https://example.com/api?a=2");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  test("cannot collide across URL/method strings that share a delimiter", () => {
    // The naive `method|url` join collides when one pair's method+URL spells another pair's URL.
    // With `("GET", "a|b")` vs `("GET|a", "b")`, both naive-join to `GET|a|b`.
    const a = requestKey("GET", "a|b");
    const b = requestKey("GET|a", "b");
    expect(a).not.toBe(b);
  });

  test("uses the HAR method as recorded, case-sensitively", () => {
    expect(requestKey("get", "https://example.com/api")).not.toBe(
      requestKey("GET", "https://example.com/api"),
    );
  });
});

describe("outcome types", () => {
  test("exposes the documented taxonomy", () => {
    const outcomes: NormalizationOutcome[] = [
      "normalized-match",
      "ambiguous-normalized-match",
      "redacted-post-body",
      "not-in-archive",
    ];
    expect(outcomes).toHaveLength(4);
  });
});
