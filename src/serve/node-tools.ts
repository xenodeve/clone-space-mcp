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
import { replayPage } from "./tools/replay-page.ts";
import { extractBehaviourFromArchive } from "./tools/extract-behaviour.ts";
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

export const REPLAY_TOOL: ToolDefinition = {
  name: "replay_page",
  title: "Replay an archived page",
  description:
    "Open an archived page again with the network unplugged: the archive is the only source, and a request it cannot serve fails rather than reaching the internet. Returns the URL, anything the archive could not serve (empty is what you want), and counts of the motion actually running - CSS keyframes, WAAPI, GSAP tweens and ScrollTriggers. It answers whether the page still moves, not how; describing the motion is the extract stage.",
  inputSchema: { archive: z.string().describe("Path to a published archive directory") },
  run: (params) =>
    replayPage({ archive: String(params.archive) }, { launch: () => chromium.launch() as never }),
};

export const EXTRACT_TOOL: ToolDefinition = {
  name: "extract_behaviour",
  title: "Extract the behaviour graph",
  description:
    "Replay the archive and report what moves on the page, what drives it, and what the page DID while running. Per animation: mechanism (CSS keyframes, WAAPI, GSAP timeline, GSAP ScrollTrigger), a selector for its target, timing, easing, and the owning library. Plus an observation summary recovered by instrumenting the replay: every shader the page compiled with its GLSL and the script coordinate that compiled it, the canvas realms it opened by kind, and its interaction surface counted by event type. A shader assembled at runtime exists in no archived file, so this is the only way to read it. Listener counts are REGISTRATION evidence, never proof a handler ever ran. It also returns anything the archive could not serve — a graph from an incomplete replay describes a page that did not fully run.",
  inputSchema: { archive: z.string().describe("Path to a published archive directory") },
  run: (params) =>
    extractBehaviourFromArchive({ archive: String(params.archive) }, {
      launch: () => chromium.launch() as never,
    }),
};

export const ALL_TOOLS: readonly ToolDefinition[] = [
  ...BROWSERLESS_TOOLS,
  CAPTURE_TOOL,
  REPLAY_TOOL,
  EXTRACT_TOOL,
];
