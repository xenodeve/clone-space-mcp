/**
 * The `capture_page` tool (#124). Owns launching the browser, which is the one thing `captureHar`
 * deliberately does not do — it takes a browser so a unit test can hand it a fake.
 *
 * **This runs under Node, not Bun.** Playwright's client does not complete its handshake under
 * Bun, measured on both transports (ADR 0001). Anything that imports this module inherits that
 * constraint, which is why the MCP server and its CLI harness are Node entry points and the
 * archive tool — which needs no browser — stays reachable from `bun test`.
 */

import { resolve } from "node:path";
import { captureHar } from "../../capture/record.ts";

export interface CapturePageParams {
  /** The page to archive. Must be an absolute http(s) URL. */
  url: string;
  /** Where to write the archive. Must not exist, or must be empty. */
  outDir: string;
  /** Explicit volatile query keys (ADR 0007). Defaults to none. */
  volatileQueryKeys?: string[];
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

export async function capturePage(
  params: CapturePageParams,
  launcher: BrowserLauncher,
): Promise<CapturePageResult> {
  const url = new URL(params.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`capture_page: unsupported protocol ${url.protocol}`);
  }

  const browser = await launcher.launch();
  try {
    const har = await captureHar({
      // The launcher's structural type is deliberately loose: Playwright's Browser is not
      // assignable to the structural interface `captureHar` declares, and narrowing it here would
      // make the real browser unusable rather than making anything safer.
      browser: browser as never,
      url: params.url,
      outDir: params.outDir,
      volatileQueryKeys: params.volatileQueryKeys,
    });
    return { archive: resolve(params.outDir), har, url: params.url };
  } finally {
    await browser.close();
  }
}
