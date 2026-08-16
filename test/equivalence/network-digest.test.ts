import { describe, expect, test } from "bun:test";
import { networkDigest } from "../../src/equivalence/network-digest.ts";

/**
 * #171's v1 scope, from the body rather than the checkboxes:
 *
 * > In: the field digest this repo can already produce — behaviour multiset, **network attempt set
 * > with its ADR 0007 classification**, and the motion counts, sampled at more than one point.
 *
 * The digest had no network field at all, so **the gate could return `PASS` on a clone that fetched
 * an entirely different set of things** — which is the opposite of the north-star's claim. The
 * issue also names the concrete case it cares about: `www.chaingpt.org` cannot serve
 * `Cannon_Exterior.hdr`, its 3D scene's environment map, so an API-level comparison passes while
 * the scene renders unlit.
 *
 * The attempt set is reduced to counts because the digest compares scalars with `Object.is`. Two
 * counts rather than one: a clone that fetches the same number of things from a different place is
 * a different failure from one that fetches a different number.
 */
describe("networkDigest", () => {
  test("counts distinct requests and the origins they went to", () => {
    expect(
      networkDigest([
        "https://a.example/one.js",
        "https://a.example/two.js",
        "https://cdn.example/lib.js",
      ]),
    ).toEqual({ requests: 3, origins: 2 });
  });

  test("the same url twice is one attempt", () => {
    // A page that re-fetches an asset has not widened its dependency surface, and counting the
    // repeat would make a retry look like a difference between the two sides.
    expect(networkDigest(["https://a.example/x.js", "https://a.example/x.js"])).toEqual({
      requests: 1,
      origins: 1,
    });
  });

  /**
   * ADR 0007. A cache-busting parameter makes two logically identical requests look different, and
   * a gate that counted them apart would report a difference on every single run.
   *
   * **The volatile keys are the caller's, not a guess.** `defaultRequestNormalization()` ships an
   * empty list on purpose — that ADR refuses ambiguity rather than inventing a policy — so this
   * function takes the list and normalizes nothing without one.
   */
  test("volatile query keys the caller named are normalized away before counting", () => {
    const urls = [
      "https://a.example/x.js?_=1730000000000",
      "https://a.example/x.js?_=1730000000001",
    ];
    expect(networkDigest(urls, ["_"])).toEqual({ requests: 1, origins: 1 });
  });

  test("with no policy, nothing is normalized away", () => {
    // Silently dropping a parameter nobody declared volatile would be the gate excusing a
    // difference on a rule it invented.
    const urls = [
      "https://a.example/x.js?_=1730000000000",
      "https://a.example/x.js?_=1730000000001",
    ];
    expect(networkDigest(urls)).toEqual({ requests: 2, origins: 1 });
  });

  test("a query key that is not volatile still separates two requests", () => {
    // The normalization is a named list, not "drop every query string" — two genuinely different
    // resources must stay two.
    expect(
      networkDigest(["https://a.example/api?id=1", "https://a.example/api?id=2"], ["_"]),
    ).toEqual({ requests: 2, origins: 1 });
  });

  test("a url the browser reported but nothing can parse is dropped rather than counted", () => {
    // `performance.getEntriesByType("resource")` can carry a `blob:` or `data:` entry, which is not
    // a network attempt at all. Counting them would make the field measure the page's own object
    // URLs rather than what it asked the network for.
    expect(networkDigest(["data:text/plain,x", "blob:https://a.example/abc", "not a url"])).toEqual({
      requests: 0,
      origins: 0,
    });
  });

  test("nothing fetched is zero, not an absent measurement", () => {
    // A page that fetched nothing is a real reading. The caller decides whether to publish it; the
    // function does not get to omit it.
    expect(networkDigest([])).toEqual({ requests: 0, origins: 0 });
  });
});
