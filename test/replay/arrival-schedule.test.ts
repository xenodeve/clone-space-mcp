import { describe, expect, test } from "bun:test";
import { arrivalScheduleFrom, delayBefore } from "../../src/replay/arrival-schedule.ts";

/**
 * #187. A HAR records **when** each response finished, and `routeFromHAR` discards it — measured
 * on the fixture: an image that finished at ≈ 75 ms live is served at ≈ 9 ms in replay, so a page
 * that measures itself on a timer reads a different world offline.
 *
 * The schedule is *when each response finished, relative to the start of the page load* — not how
 * long each request took. That distinction is the whole design: the first attempt on this issue
 * delayed every entry by its own duration, which stacks a delay on top of a request that has
 * already started and made `waitUntil: "load"` time out. An offset from a common origin instead
 * bounds the whole replay at the recorded page load, however many entries there are.
 */
const entry = (url: string, startedDateTime: string, time: number) => ({
  request: { url, method: "GET" },
  response: { status: 200 },
  startedDateTime,
  time,
});

const har = (...entries: unknown[]) => ({ log: { entries } });

describe("arrivalScheduleFrom", () => {
  test("offsets each response end from the earliest request in the archive", () => {
    const schedule = arrivalScheduleFrom(
      har(
        entry("https://example.com/", "2026-08-16T10:00:00.000Z", 20),
        entry("https://example.com/late.svg", "2026-08-16T10:00:00.050Z", 300),
      ),
    );

    expect(schedule.get("GET https://example.com/")).toBe(20);
    expect(schedule.get("GET https://example.com/late.svg")).toBe(350);
  });

  test("the document does not have to be the earliest entry for the origin to be right", () => {
    // A preconnect or a redirect can be recorded before the document. Anchoring on "the first
    // entry" would then make the document's own offset negative and every other offset too small.
    const schedule = arrivalScheduleFrom(
      har(
        entry("https://example.com/early.css", "2026-08-16T10:00:00.000Z", 10),
        entry("https://example.com/", "2026-08-16T10:00:00.100Z", 5),
      ),
    );

    expect(schedule.get("GET https://example.com/early.css")).toBe(10);
    expect(schedule.get("GET https://example.com/")).toBe(105);
  });

  test("a URL fetched twice keeps its earliest arrival", () => {
    // What the page's first measurement races against is the first time the bytes landed. Keeping
    // the later one would hold a resource back past the moment it actually became available.
    const schedule = arrivalScheduleFrom(
      har(
        entry("https://example.com/a.js", "2026-08-16T10:00:00.000Z", 40),
        entry("https://example.com/a.js", "2026-08-16T10:00:01.000Z", 40),
      ),
    );

    expect(schedule.get("GET https://example.com/a.js")).toBe(40);
  });

  test("an entry with no usable timing is left out rather than given a zero", () => {
    // Zero is a decision — "serve it immediately" — and it is exactly the behaviour under test.
    // An absent key lets the caller tell "recorded as instant" from "not recorded", which is the
    // same reason the equivalence gate has `unobserved` rather than folding it into `equal`.
    const schedule = arrivalScheduleFrom(
      har(
        { request: { url: "https://example.com/no-time", method: "GET" }, startedDateTime: "2026-08-16T10:00:00.000Z" },
        { request: { url: "https://example.com/no-date", method: "GET" }, time: 10 },
        entry("https://example.com/ok", "2026-08-16T10:00:00.000Z", 10),
      ),
    );

    expect(schedule.has("GET https://example.com/no-time")).toBe(false);
    expect(schedule.has("GET https://example.com/no-date")).toBe(false);
    expect(schedule.get("GET https://example.com/ok")).toBe(10);
  });

  test("a negative recorded duration cannot pull an arrival before its own request", () => {
    // Playwright writes `time: -1` for a request that never completed. Adding it would schedule
    // the response *earlier* than the request, which is not a timing anyone recorded.
    const schedule = arrivalScheduleFrom(
      har(entry("https://example.com/pending", "2026-08-16T10:00:00.000Z", -1)),
    );

    expect(schedule.has("GET https://example.com/pending")).toBe(false);
  });

  test("a HAR with no entries is an empty schedule rather than a throw", () => {
    expect(arrivalScheduleFrom({ log: { entries: [] } }).size).toBe(0);
    expect(arrivalScheduleFrom(undefined).size).toBe(0);
  });
});

/**
 * Found by a delegated adversarial review (`codex`, refutation-framed) after the option had already
 * merged, and both are defects the author's own tests encoded as intended behaviour.
 */
describe("the schedule keys on method as well as url", () => {
  test("a redirect and its target do not share one arrival", () => {
    // The reviewer's scenario. `POST /submit` 302s at 10 ms and the redirected `GET /submit`
    // carries the document at 110 ms. Keyed by URL alone, the earliest-arrival rule gives both
    // 10 ms — so the document is served 100 ms early, which is exactly the class of divergence
    // `restoreTiming` exists to remove. `routeFromHAR` already matches on method, so keying on it
    // here aligns the timing layer with the layer that picks the body.
    const schedule = arrivalScheduleFrom(
      har(
        { request: { url: "https://example.com/submit", method: "POST" }, startedDateTime: "2026-08-16T10:00:00.000Z", time: 10 },
        { request: { url: "https://example.com/submit", method: "GET" }, startedDateTime: "2026-08-16T10:00:00.010Z", time: 100 },
      ),
    );

    expect(schedule.get("POST https://example.com/submit")).toBe(10);
    expect(schedule.get("GET https://example.com/submit")).toBe(110);
  });

  test("an entry with no method is left out, like one with no url", () => {
    const schedule = arrivalScheduleFrom(
      har({ request: { url: "https://example.com/x" }, startedDateTime: "2026-08-16T10:00:00.000Z", time: 5 }),
    );
    expect(schedule.size).toBe(0);
  });
});

describe("delayBefore", () => {
  test("waits the remainder of the recorded offset", () => {
    expect(delayBefore(300, 1000, 1120)).toBe(180);
  });

  test("is zero once the recorded arrival has already passed", () => {
    expect(delayBefore(300, 1000, 1400)).toBe(0);
  });

  test("is zero for a url the archive recorded no timing for", () => {
    expect(delayBefore(undefined, 1000, 1100)).toBe(0);
  });

  test("is zero before the navigation clock starts, rather than infinite", () => {
    // Measured on this machine: `Number.POSITIVE_INFINITY` as the start time makes
    // `arrivesAt - (now - start)` evaluate to `Infinity`, and `setTimeout` answers with
    // `TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer. Timeout
    // duration was set to 1.` So the request was served immediately *and* printed a warning —
    // the right behaviour reached by a clamp nobody chose.
    expect(delayBefore(300, Number.POSITIVE_INFINITY, 1100)).toBe(0);
    expect(delayBefore(300, Number.NaN, 1100)).toBe(0);
  });
});
