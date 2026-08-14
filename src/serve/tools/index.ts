/**
 * The tool registry (#124). One entry per tool: its name, what it is for, the shape of its input,
 * and the plain function that does the work.
 *
 * Everything above this — the MCP server, the CLI harness, a future inspector — reads this table.
 * That is what keeps `mcp.ts` free of behaviour: a tool added here is reachable from every layer
 * at once, and a tool added anywhere else is reachable from exactly one.
 */

import { z } from "zod";
import { inspectArchive } from "./inspect-archive.ts";

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /**
   * The parameter shape, as a Zod raw shape — the SDK's own schema language, handed to
   * `registerTool` verbatim. Declaring it here rather than in `mcp.ts` is what lets the CLI
   * harness validate the same way the protocol does without importing the server.
   */
  inputSchema: z.ZodRawShape;
  run(params: Record<string, unknown>): Promise<unknown>;
}

/**
 * Tools reachable without a browser. `capture_page` is not here: it imports Playwright through
 * `captureHar`'s launcher and must run under Node (ADR 0001), so it is registered by the Node
 * entry point rather than by this Bun-reachable table.
 */
export const BROWSERLESS_TOOLS: readonly ToolDefinition[] = [
  {
    name: "inspect_archive",
    title: "Inspect an archive",
    description:
      "Report whether a published archive is complete: which §6.x contracts it carries, whether its commit still verifies, and how the capture terminated. Reads only; needs no browser and no network.",
    inputSchema: { path: z.string().describe("Path to a published archive directory") },
    run: (params) => inspectArchive({ path: String(params.path) }),
  },
];

export function findTool(name: string, tools: readonly ToolDefinition[]): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`unknown tool: ${name} — known tools are ${tools.map((t) => t.name).join(", ")}`);
  }
  return tool;
}
