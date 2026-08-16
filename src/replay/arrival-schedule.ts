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
  url: string;
  startedMs: number;
  durationMs: number;
}

function arrivalOf(entry: unknown): RecordedArrival | undefined {
  const record = entry as {
    request?: { url?: unknown };
    startedDateTime?: unknown;
    time?: unknown;
  };
  const url = record.request?.url;
  if (typeof url !== "string" || url.length === 0) return undefined;
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
  return { url, startedMs, durationMs: record.time };
}

/**
 * `url` → milliseconds after the earliest recorded request at which its response finished.
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
    const known = schedule.get(arrival.url);
    if (known === undefined || offset < known) schedule.set(arrival.url, offset);
  }
  return schedule;
}
