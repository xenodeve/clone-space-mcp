/**
 * The tool registry as a **Node** entry point sees it (#124).
 *
 * `capture_page` lives here rather than in `tools/index.ts` because it launches Chromium, and
 * Playwright's client does not complete its handshake under Bun (ADR 0001). Splitting the table
 * this way is what keeps `bun test` able to cover every browserless tool directly: importing the
 * browser tools from a Bun test would fail at import time, not at call time, and would take the
 * whole suite with it.
 */

import { chromium } from "playwright";
import { z } from "zod";
import { capturePage } from "./tools/capture-page.ts";
import { BROWSERLESS_TOOLS, type ToolDefinition } from "./tools/index.ts";

export const CAPTURE_TOOL: ToolDefinition = {
  name: "capture_page",
  title: "Capture a page",
  description:
    "Archive a live web page into a directory that replays offline: the HAR plus the §6.x evidence artifacts. Launches a browser with this host's network position. WARNING: the archive contains the page — response bodies included. Credentials, cookies and known-sensitive headers are redacted, but anything the page itself renders or returns is written to disk in plain form, so do not point this at an authenticated or internal page you would not hand to whoever can read the output directory.",
  inputSchema: {
    url: z.string().describe("Absolute http(s) URL of the page to archive"),
    outDir: z.string().describe("Directory to write the archive into; must not already exist"),
    volatileQueryKeys: z
      .array(z.string())
      .optional()
      .describe("Query keys whose values vary per request and must not defeat replay matching"),
    allowPrivateNetwork: z
      .boolean()
      .optional()
      .describe(
        "Allow the URL to resolve to a loopback, link-local or private address. Off by default, because this process has the host's network position and not the caller's.",
      ),
  },
  run: (params) =>
    capturePage(
      {
        url: String(params.url),
        outDir: String(params.outDir),
        volatileQueryKeys: Array.isArray(params.volatileQueryKeys)
          ? params.volatileQueryKeys.map(String)
          : undefined,
        allowPrivateNetwork: params.allowPrivateNetwork === true,
      },
      { launch: () => chromium.launch() as never },
    ),
};

export const ALL_TOOLS: readonly ToolDefinition[] = [...BROWSERLESS_TOOLS, CAPTURE_TOOL];
