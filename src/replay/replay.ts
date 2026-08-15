/**
 * Replay — open an archived page again with the network unplugged (#133, P3).
 *
 * The load-bearing commitment, decided before any replay code existed: **navigate the original
 * URL with the original document HTML, served from the HAR**, so the page's real JavaScript
 * re-executes. Serializing the hydrated DOM as the executable bootstrap is the approach this
 * project rejects — it breaks hydration and entry animations, which is the fidelity being chased.
 *
 * `notFound: "abort"` is not a detail. A request the archive cannot serve has to fail loudly,
 * because a replay that quietly reaches the live network proves nothing about the archive.
 *
 * Like `captureHar`, this takes its browser rather than launching one, so a test can drive it and
 * the caller decides the runtime (ADR 0001).
 */

import { readArchive } from "../archive/read.ts";
import type { ReplayContext } from "../capture/environment.ts";
import {
  drainedObservations,
  INSTRUMENT_DRAIN_SCRIPT,
  INSTRUMENT_INIT_SCRIPT,
  type Observation,
} from "../capture/instrument.ts";

export interface ReplayArchiveOptions {
  /** Path to a published archive directory. */
  archive: string;
  browser: ReplayBrowser;
  /**
   * Install the observation layer (#173) before any page script, so the replay records what the
   * page *does* — shaders assembled at runtime, canvas realms, the listener surface — rather than
   * only what it shipped.
   *
   * **Off by default.** Hooks change what they observe, and a caller comparing a replay against a
   * live page must decide for itself whether both sides carry them; silently instrumenting one
   * side would make the two incomparable without anything saying so.
   */
  instrument?: boolean;
}

/** The structural slice of Playwright's Browser this needs. */
export interface ReplayBrowser {
  newContext(options: Record<string, unknown>): Promise<ReplayBrowserContext>;
}

export interface ReplayBrowserContext {
  routeFromHAR(har: string, options: { notFound: "abort"; url?: string }): Promise<void>;
  addInitScript(script: { content: string }): Promise<void>;
  route(url: string, handler: (route: ReplayRoute) => Promise<void>): Promise<void>;
  newPage(): Promise<ReplayPage>;
  close(): Promise<void>;
}

/** The slice of Playwright's Route this needs to abort one request and defer the rest. */
export interface ReplayRoute {
  request(): { url(): string };
  abort(): Promise<void>;
  fallback(): Promise<void>;
}

export interface ReplayPage {
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
  on(event: "requestfailed", handler: (request: { url(): string }) => void): void;
  evaluate<Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
}

export interface ReplayHandle {
  /** The URL that was navigated — the original one, from the archive. */
  url: string;
  /** Requests the archive could not serve. Empty is P3's exit criterion. */
  aborted: string[];
  /**
   * How many distinct **URLs** the archive holds no usable response for (#155) — not a count of
   * HAR entries, because one URL can carry several. Archive quality rather than replay failure:
   * capture published a request it never got an answer for, so the page cannot get one either.
   * Non-zero means this replay is missing something the live page had.
   */
  unservable: number;
  page: ReplayPage;
  /**
   * Hand over what the observation layer recorded since the last call (#173). Empty when the
   * replay was not instrumented — an honest empty rather than a thrown error, because "this
   * replay carries no hooks" is a legitimate state a caller may not have chosen deliberately.
   */
  drainObservations(): Promise<{ observations: Observation[]; dropped: number }>;
  close(): Promise<void>;
}

/**
 * The URL to navigate. It comes from the HAR's first document entry rather than from a field
 * someone wrote down: the HAR is what `routeFromHAR` will match against, so taking the URL from
 * anywhere else can produce a navigation the router cannot answer. Redaction rewrites request URLs
 * in the published HAR (ADR 0003), and this reads the same rewritten value the router will.
 */
function entriesOf(har: unknown): unknown[] {
  return typeof har === "object" && har !== null
    ? ((har as { log?: { entries?: unknown[] } }).log?.entries ?? [])
    : [];
}

function documentUrlFrom(har: unknown): string {
  for (const entry of entriesOf(har)) {
    const url = (entry as { request?: { url?: unknown } }).request?.url;
    if (typeof url === "string" && url.length > 0) return url;
  }
  throw new Error("replay: the archive's HAR has no request to navigate");
}

/**
 * URLs the HAR holds **no** usable response for (#155). Playwright records a request that never
 * completed with `response.status: -1`, and `routeFromHAR` **matches** such an entry — so it never
 * reaches `notFound: "abort"` — then has nothing to fulfil with and leaves the request pending
 * forever. Five of those, all `<script>`, is why `https://labs.chaingpt.org/` replayed to neither
 * `DOMContentLoaded` nor `load`.
 *
 * A URL is only refused when *every* entry for it is unusable. One URL can carry two entries — a
 * `GET` that succeeded and a `POST` still open at teardown, or a second fetch of the same asset —
 * and refusing on the bad one alone would drop an asset the archive can serve. That is a worse
 * failure than the stall: it removes working motion from a replay that previously had it.
 *
 * A real HTTP status is >= 100, so this catches Playwright's `-1` and a `0` without guessing at
 * which sentinel a future version picks.
 */
function unservableUrlsIn(har: unknown): Set<string> {
  const servable = new Set<string>();
  const unservable = new Set<string>();
  for (const entry of entriesOf(har)) {
    const record = entry as { request?: { url?: unknown }; response?: { status?: unknown } };
    const url = record.request?.url;
    if (typeof url !== "string") continue;
    const status = record.response?.status;
    (typeof status === "number" && status >= 100 ? servable : unservable).add(url);
  }
  for (const url of servable) unservable.delete(url);
  return unservable;
}

function replayContextFrom(environment: unknown): Partial<ReplayContext> {
  const replay =
    typeof environment === "object" && environment !== null
      ? (environment as { replay?: { context?: unknown } }).replay?.context
      : undefined;
  return typeof replay === "object" && replay !== null ? (replay as Partial<ReplayContext>) : {};
}

export async function replayArchive(options: ReplayArchiveOptions): Promise<ReplayHandle> {
  const archive = await readArchive(options.archive);
  if (archive.documents.commit === undefined) {
    throw new Error(`replay: ${options.archive} is not an archive — no commit.json`);
  }

  const { readFile } = await import("node:fs/promises");
  const har = JSON.parse(await readFile(archive.harPath, "utf8")) as unknown;
  const url = documentUrlFrom(har);

  // §6.2: the replay surface is the half of `environment.json` that describes what a faithful
  // replay must reproduce, as opposed to what capture merely observed.
  const context = await options.browser.newContext({ ...replayContextFrom(archive.documents.environment) });
  await context.routeFromHAR(archive.harPath, { notFound: "abort", url: "**/*" });

  if (options.instrument === true) {
    await context.addInitScript({ content: INSTRUMENT_INIT_SCRIPT });
  }

  // Registered **after** `routeFromHAR` on purpose: the later handler is offered the request first,
  // so this one aborts the entries the archive has no response for and hands everything else back
  // with `fallback()`. Filtering the HAR file instead would mean copying it, and the response
  // bodies are sibling files it references by relative name — a copy elsewhere resolves to nothing.
  const unservable = unservableUrlsIn(har);
  if (unservable.size > 0) {
    await context.route("**/*", async (route) => {
      if (unservable.has(route.request().url())) {
        await route.abort();
        return;
      }
      await route.fallback();
    });
  }

  const page = await context.newPage();
  const aborted: string[] = [];
  page.on("requestfailed", (request) => {
    aborted.push(request.url());
  });

  await page.goto(url, { waitUntil: "load" });

  return {
    url,
    aborted,
    unservable: unservable.size,
    page,
    drainObservations: async () =>
      options.instrument === true
        ? drainedObservations(
            await page.evaluate(new Function(`return ${INSTRUMENT_DRAIN_SCRIPT}`) as () => unknown),
          )
        : { observations: [], dropped: 0 },
    close: () => context.close(),
  };
}
