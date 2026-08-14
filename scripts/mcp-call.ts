/**
 * Layer 2 of #8: call a tool with no transport, no server and no agent.
 *
 *   node scripts/mcp-call.ts inspect_archive '{"path":"./out/archive"}'
 *
 * Its whole reason to exist is that a bug reproduced here needs nobody else in the room. It goes
 * through the same registry and the same functions the MCP server does, so a result that differs
 * between the two means behaviour leaked into the server layer — which is what #8 forbids and what
 * `test/serve/mcp.test.ts` asserts.
 *
 * Node rather than Bun, because the registry it loads includes `capture_page`, which launches
 * Chromium (ADR 0001).
 */

import { findTool } from "../src/serve/tools/index.ts";
import { ALL_TOOLS } from "../src/serve/node-tools.ts";

function usage(): never {
  process.stderr.write(
    [
      "usage: node scripts/mcp-call.ts <tool> '<json params>'",
      "",
      "tools:",
      ...ALL_TOOLS.map((tool) => `  ${tool.name.padEnd(16)} ${tool.description.split(".")[0]}.`),
      "",
    ].join("\n"),
  );
  process.exit(2);
}

const [name, rawParams] = process.argv.slice(2);
if (name === undefined) usage();

let params: Record<string, unknown>;
try {
  params = rawParams === undefined ? {} : (JSON.parse(rawParams) as Record<string, unknown>);
} catch (error) {
  process.stderr.write(`mcp-call: params are not JSON: ${(error as Error).message}\n`);
  process.exit(2);
}

try {
  const tool = findTool(name, ALL_TOOLS);
  const result = await tool.run(params);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  // A tool failure exits non-zero and prints only the message: this is meant to be readable in a
  // terminal and usable in a shell pipeline, not to look like a protocol response.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
