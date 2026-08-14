import { describe, expect, test } from "bun:test";
import { assertOriginsAllowed, originsInRedirectChain } from "../../src/capture/environment.ts";

/**
 * #157. `assertFinalOrigin` sees only where the page ended up. A chain that goes
 * public -> link-local -> public passes that check while the middle hop's request and response are
 * already in the HAR, and the refusal this replaced would have aborted the whole capture. The
 * policy has to see every hop, so something has to enumerate them.
 */
function request(url: string, from?: unknown): unknown {
  return { url: () => url, redirectedFrom: () => from ?? null };
}

describe("originsInRedirectChain", () => {
  test("returns the single origin when nothing redirected", () => {
    const navigation = { request: () => request("https://example.com/page") };
    expect(originsInRedirectChain(navigation)).toEqual(["https://example.com"]);
  });

  test("walks the whole chain, oldest hop first", () => {
    const first = request("https://apex.example/");
    const middle = request("http://169.254.169.254/latest/meta-data/", first);
    const last = request("https://www.apex.example/", middle);
    expect(originsInRedirectChain({ request: () => last })).toEqual([
      "https://apex.example",
      "http://169.254.169.254",
      "https://www.apex.example",
    ]);
  });

  test("collapses repeated origins so a policy is not asked the same question twice", () => {
    const first = request("https://example.com/a");
    const last = request("https://example.com/b", first);
    expect(originsInRedirectChain({ request: () => last })).toEqual(["https://example.com"]);
  });

  // A fake browser's `goto` returns nothing, and the structural interface types it `unknown`.
  // Returning an empty chain rather than throwing keeps that a test-infrastructure fact instead
  // of a capture failure — the final-origin check still runs either way.
  test("returns nothing for a navigation that exposes no request", () => {
    expect(originsInRedirectChain(undefined)).toEqual([]);
    expect(originsInRedirectChain({})).toEqual([]);
    expect(originsInRedirectChain({ request: () => ({}) })).toEqual([]);
  });

  test("stops on a cycle rather than looping forever", () => {
    const looping: { url(): string; redirectedFrom(): unknown } = {
      url: () => "https://example.com/",
      redirectedFrom: () => looping,
    };
    expect(originsInRedirectChain({ request: () => looping })).toEqual(["https://example.com"]);
  });
});

describe("assertOriginsAllowed", () => {
  test("asks the policy about every origin that is not the requested one", async () => {
    const asked: string[] = [];
    await assertOriginsAllowed(
      ["https://apex.example", "http://169.254.169.254", "https://www.apex.example"],
      "https://apex.example",
      async (origin) => {
        asked.push(origin);
      },
    );
    // The middle hop is the one a final-origin check never sees, and it is in the list.
    expect(asked).toEqual(["http://169.254.169.254", "https://www.apex.example"]);
  });

  test("propagates the policy's refusal", async () => {
    await expect(
      assertOriginsAllowed(["https://other.example"], "https://apex.example", async (origin) => {
        throw new Error(`refused ${origin}`);
      }),
    ).rejects.toThrow(/refused https:\/\/other.example/);
  });

  // Default-deny. Before #157 `captureHar` aborted any capture whose origin changed, and a
  // library caller that never opted into a policy has to keep that rather than silently lose it.
  test("refuses an origin change when no policy was supplied", async () => {
    await expect(
      assertOriginsAllowed(["https://www.apex.example"], "https://apex.example", undefined),
    ).rejects.toThrow(/no network policy was supplied/);
  });

  test("says nothing about the requested origin, with or without a policy", async () => {
    await assertOriginsAllowed(["https://apex.example"], "https://apex.example", undefined);
  });
});
