/**
 * The MCP layer (#124), and the constraint #8 exists to lock in: **this file owns no logic.**
 *
 * It registers what `src/serve/tools/` defines, turns a thrown error into a protocol error, and
 * stops. If behaviour appears here, nothing below can reach it and the only way to test it is
 * through an agent — which is the failure #8 was written before any MCP code existed to prevent.
 *
 * A reviewer should be able to confirm that by reading this file top to bottom.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findTool, type ToolDefinition } from "./tools/index.ts";

export const SERVER_INFO = { name: "clone-space-mcp", version: "0.1.0-alpha.0" } as const;

export function createServer(tools: readonly ToolDefinition[]): McpServer {
  const server = new McpServer(SERVER_INFO);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (params: Record<string, unknown>) => {
        try {
          const result = await findTool(tool.name, tools).run(params);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          // The protocol carries the failure as a tool result rather than a transport error, so a
          // caller sees which tool failed and why instead of a dead connection.
          return {
            isError: true,
            content: [
              { type: "text" as const, text: error instanceof Error ? error.message : String(error) },
            ],
          };
        }
      },
    );
  }

  return server;
}
