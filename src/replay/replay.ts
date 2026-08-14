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

export interface ReplayArchiveOptions {
  /** Path to a published archive directory. */
  archive: string;
  browser: ReplayBrowser;
}

/** The structural slice of Playwright's Browser this needs. */
export interface ReplayBrowser {
  newContext(options: Record<string, unknown>): Promise<ReplayBrowserContext>;
}

export interface ReplayBrowserContext {
  routeFromHAR(har: string, options: { notFound: "abort"; url?: string }): Promise<void>;
  newPage(): Promise<ReplayPage>;
  close(): Promise<void>;
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
  page: ReplayPage;
  close(): Promise<void>;
}

/**
 * The URL to navigate. It comes from the HAR's first document entry rather than from a field
 * someone wrote down: the HAR is what `routeFromHAR` will match against, so taking the URL from
 * anywhere else can produce a navigation the router cannot answer. Redaction rewrites request URLs
 * in the published HAR (ADR 0003), and this reads the same rewritten value the router will.
 */
function documentUrlFrom(har: unknown): string {
  const entries =
    typeof har === "object" && har !== null
      ? ((har as { log?: { entries?: unknown[] } }).log?.entries ?? [])
      : [];
  for (const entry of entries) {
    const url = (entry as { request?: { url?: unknown } }).request?.url;
    if (typeof url === "string" && url.length > 0) return url;
  }
  throw new Error("replay: the archive's HAR has no request to navigate");
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

  const page = await context.newPage();
  const aborted: string[] = [];
  page.on("requestfailed", (request) => {
    aborted.push(request.url());
  });

  await page.goto(url, { waitUntil: "load" });

  return {
    url,
    aborted,
    page,
    close: () => context.close(),
  };
}
