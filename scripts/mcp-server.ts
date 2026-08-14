/**
 * The stdio entry point an agent connects to (#124).
 *
 * Thin on purpose, like `src/serve/mcp.ts`: pick the transport, connect, and let the registry
 * decide what exists. Node rather than Bun, because `capture_page` launches Chromium (ADR 0001).
 *
 *   node scripts/mcp-server.ts
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../src/serve/mcp.ts";
import { ALL_TOOLS } from "../src/serve/node-tools.ts";

const server = createServer(ALL_TOOLS);
await server.connect(new StdioServerTransport());
