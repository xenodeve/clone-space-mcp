/**
 * The `capture_page` tool (#124). Owns launching the browser, which is the one thing `captureHar`
 * deliberately does not do — it takes a browser so a unit test can hand it a fake.
 *
 * **This runs under Node, not Bun.** Playwright's client does not complete its handshake under
 * Bun, measured on both transports (ADR 0001). Anything that imports this module inherits that
 * constraint, which is why the MCP server and its CLI harness are Node entry points and the
 * archive tool — which needs no browser — stays reachable from `bun test`.
 */

import { existsSync } from "node:fs";
import { captureHar } from "../../capture/record.ts";
import { assertReachableUrl, assertWritableOutDir, type HostResolver } from "./capture-guards.ts";

export interface CapturePageParams {
  /** The page to archive. Must be an absolute http(s) URL. */
  url: string;
  /** Where to write the archive. Must not exist: the tool refuses an existing path. */
  outDir: string;
  /** Explicit volatile query keys (ADR 0007). Defaults to none. */
  volatileQueryKeys?: string[];
  /**
   * Allow the URL to resolve to a loopback, link-local or private address. Off by default: this
   * process has the host's network position, not the caller's. The fixture site this repo tests
   * against is on localhost, so the hatch has to exist — making it explicit is what turns reaching
   * inside a network into a stated choice rather than an accident.
   */
  allowPrivateNetwork?: boolean;
  /** Injected so a unit test does not depend on live DNS. Production uses the system resolver. */
  resolveHost?: HostResolver;
}

export interface CapturePageResult {
  /** The archive directory — the path `inspect_archive` takes. */
  archive: string;
  /** The HAR inside it. `captureHar` returns this, and it is not the archive root. */
  har: string;
  url: string;
}

/** Injected so a test can drive this without launching Chromium; production passes Playwright's. */
export interface BrowserLauncher {
  launch(): Promise<{
    newContext: unknown;
    version: unknown;
    close(): Promise<void>;
  }>;
}

/**
 * One capture at a time, process-wide.
 *
 * An MCP server is long-lived and an agent can call a tool as often as it likes. Unbounded, every
 * concurrent call launches its own Chromium, and a handful of them is a host with no memory left —
 * a failure that belongs to the machine rather than to any archive, so nothing that inspects an
 * archive would ever see it.
 *
 * A queue rather than a rejection: a caller that asked for two captures wants two archives, and
 * making the second wait costs it time where refusing costs it the result. Capture is already
 * bounded in wall-clock by §6.10's budget, so the wait cannot be unbounded either.
 */
let captureQueue: Promise<unknown> = Promise.resolve();

export async function capturePage(
  params: CapturePageParams,
  launcher: BrowserLauncher,
): Promise<CapturePageResult> {
  // Both refusals happen before anything is launched or created: a rejected call leaves no
  // browser process and no directory behind.
  const outDir = assertWritableOutDir(params.outDir, existsSync);
  await assertReachableUrl(params.url, params.allowPrivateNetwork === true, params.resolveHost);

  const run = captureQueue.then(async () => {
    const browser = await launcher.launch();
    try {
    const har = await captureHar({
      // The launcher's structural type is deliberately loose: Playwright's Browser is not
      // assignable to the structural interface `captureHar` declares, and narrowing it here would
      // make the real browser unusable rather than making anything safer.
      browser: browser as never,
      url: params.url,
      outDir,
      volatileQueryKeys: params.volatileQueryKeys,
      // The same policy, applied again to every origin the navigation touched (#157). The
      // pre-flight check above only sees the URL the caller asked for; without this, a public URL
      // redirecting through a link-local address would be archived rather than refused.
      assertOriginAllowed: async (origin) => {
        await assertReachableUrl(origin, params.allowPrivateNetwork === true, params.resolveHost);
      },
    });
      return { archive: outDir, har, url: params.url };
    } finally {
      await browser.close();
    }
  });
  // The queue must not stop on a failed capture, and it must not swallow that failure either.
  captureQueue = run.catch(() => undefined);
  return run;
}
