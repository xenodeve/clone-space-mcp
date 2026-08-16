/**
 * When each response finished, relative to the start of the recorded page load (#187).
 *
 * **The defect this exists for.** `routeFromHAR` serves a recorded body as fast as the route
 * handler can be called and discards the recorded timing. Measured on `/measure-and-freeze.html`:
 * an image whose `responseEnd` was 71–83 ms live arrives at 8–11 ms in replay. A page that
 * measures an element on a timer and freezes the result therefore reads a **different world**
 * offline — same bytes, same DOM, different layout. Nothing in the archive is wrong; the schedule
 * is simply not part of what gets replayed.
 *
 * **Why an offset and not a duration.** The first attempt on #187 delayed each entry by its own
 * recorded `time`. That stacks a delay on top of a request that has already started, so the cost
 * is the *sum* of every entry's duration and `page.goto(..., waitUntil: "load")` timed out on a
 * real site with hundreds of entries. An offset from a common origin is bounded by the recorded
 * page load however many entries there are, because entries that overlapped in the recording
 * overlap again in the replay.
 *
 * This module is a pure function over a parsed HAR so it can be tested without a browser. Whether
 * the schedule is *applied* is `replayArchive`'s decision — see `restoreTiming`.
 */

function entriesOf(har: unknown): unknown[] {
  return typeof har === "object" && har !== null
    ? ((har as { log?: { entries?: unknown[] } }).log?.entries ?? [])
    : [];
}

interface RecordedArrival {
  key: string;
  startedMs: number;
  durationMs: number;
}

/**
 * How the schedule is keyed: **method and URL**, the same pair `routeFromHAR` matches a body on.
 *
 * Keying on the URL alone was the first shape and a delegated review refuted it. A `POST /submit`
 * that 302s at 10 ms and the redirected `GET /submit` that carries the document at 110 ms are one
 * URL and two arrivals; the earliest-arrival rule then serves the document 100 ms early, which is
 * precisely the divergence this module exists to remove. Aligning with the layer that picks the
 * body means a redirect and its target can no longer share one arrival.
 *
 * **It does not make the two inseparable, and an outside reader caught the overstatement.** Two
 * entries with the *same* method and URL — a cache-busting refetch, a retry — still collapse to the
 * earliest arrival, so a second fetch is served at the first one's offset. That is deliberate (see
 * below) and it is a remaining known gap, not a property this key removes.
 */
export function scheduleKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

function arrivalOf(entry: unknown): RecordedArrival | undefined {
  const record = entry as {
    request?: { url?: unknown; method?: unknown };
    startedDateTime?: unknown;
    time?: unknown;
  };
  const url = record.request?.url;
  if (typeof url !== "string" || url.length === 0) return undefined;
  const method = record.request?.method;
  if (typeof method !== "string" || method.length === 0) return undefined;
  if (typeof record.startedDateTime !== "string") return undefined;
  const startedMs = Date.parse(record.startedDateTime);
  if (Number.isNaN(startedMs)) return undefined;
  // `time: -1` is what Playwright writes for a request that never completed. Adding it would
  // schedule the response *before* its own request — a timing nobody recorded — so an entry
  // without a usable duration is left out entirely rather than given a zero. An absent key means
  // "not recorded" and the caller serves it at once; a zero would mean "recorded as instant",
  // which is the behaviour under test and must stay distinguishable from it.
  if (typeof record.time !== "number" || !Number.isFinite(record.time) || record.time < 0) {
    return undefined;
  }
  return { key: scheduleKey(method, url), startedMs, durationMs: record.time };
}

/**
 * `"<METHOD> <url>"` → milliseconds after the earliest recorded request at which its response
 * finished.
 *
 * The origin is the **earliest entry**, not the document. A preconnect or a redirect can be
 * recorded before the document, and anchoring on the document would make those offsets negative
 * and every other offset too small by the same amount.
 *
 * A URL fetched more than once keeps its **earliest** arrival: what a page's first measurement
 * races against is the first time those bytes landed, and holding it back to a later fetch would
 * delay a resource past the moment it actually became available.
 */
export function arrivalScheduleFrom(har: unknown): Map<string, number> {
  const arrivals: RecordedArrival[] = [];
  for (const entry of entriesOf(har)) {
    const arrival = arrivalOf(entry);
    if (arrival !== undefined) arrivals.push(arrival);
  }
  if (arrivals.length === 0) return new Map();

  const origin = Math.min(...arrivals.map((arrival) => arrival.startedMs));
  const schedule = new Map<string, number>();
  for (const arrival of arrivals) {
    const offset = arrival.startedMs - origin + arrival.durationMs;
    const known = schedule.get(arrival.key);
    if (known === undefined || offset < known) schedule.set(arrival.key, offset);
  }
  return schedule;
}

/**
 * How long to hold a response, given when the archive says it arrived and when this replay's
 * navigation started. Zero means serve it now.
 *
 * **Every non-answer is zero, and none of them may be infinite.** A delegated review found the
 * case: with `navigationStartedAt` initialised to `Number.POSITIVE_INFINITY` so that "the clock has
 * not started" is representable, `arrivesAt - (now - start)` evaluates to `Infinity`. Measured on
 * this machine —
 *
 *     TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.
 *     Timeout duration was set to 1.
 *
 * — so the request was served almost immediately *and* printed a warning. The behaviour was right
 * by accident, reached through a clamp nobody chose, and it announced itself in the output of every
 * replay that raced the assignment. A request the navigation clock cannot place is served at once,
 * deliberately: holding it back would be scheduling against a start time that does not exist yet.
 */
export function delayBefore(
  arrivesAt: number | undefined,
  navigationStartedAt: number,
  now: number,
): number {
  if (arrivesAt === undefined) return 0;
  const remaining = arrivesAt - (now - navigationStartedAt);
  // `Number.isFinite` here is doing two jobs and the second is the one that matters: it is also
  // what answers a non-finite `navigationStartedAt`. A separate guard for that was written first
  // and `bun run mutate` reported it SURVIVED — removing it changed no behaviour, because
  // `Infinity - (-Infinity)` is `Infinity` and lands here anyway. Deleting the write rather than
  // guarding it, per `remove-the-write-dont-guard-it`.
  return Number.isFinite(remaining) && remaining > 0 ? remaining : 0;
}
