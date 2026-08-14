import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { repoRoot } from "../../scripts/repo-root.ts";
import { inspectArchive } from "../../src/serve/tools/inspect-archive.ts";
import { captureFixtureArchive } from "../serve/fixture-archive.ts";

/**
 * The entry point an agent actually connects to (#129).
 *
 * `test/serve/mcp.test.ts` already proves the protocol surface against a linked pair in one
 * process, and that is the faster and broader test. It cannot see anything that only goes wrong
 * across a process boundary: a stray stdout write corrupting the framing, a startup path that
 * throws before `connect`, a Node-only import that fails under the real argv, a server that never
 * exits. Those are exactly the failures that reach a user and nobody else.
 */
let client: Client;
let archive: string;

before(async () => {
  archive = await captureFixtureArchive();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/mcp-server.ts"],
    cwd: repoRoot,
  });
  client = new Client({ name: "stdio-test", version: "0" });
  await client.connect(transport);
});

after(async () => {
  // Closing the client terminates the child. Without this the suite leaves a server behind, which
  // is a failure mode a test for a long-lived process ought not to introduce.
  await client?.close();
  if (archive) rmSync(archive, { recursive: true, force: true });
});

test("the stdio server lists both browser tools and the browserless one", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["capture_page", "extract_behaviour", "inspect_archive", "replay_page"]);

  const capture = tools.find((tool) => tool.name === "capture_page");
  // The schema crosses the process boundary as JSON Schema, not as the Zod shape it was declared
  // with. A tool whose parameters do not survive that trip is unusable by an agent.
  const schema = capture?.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
  assert.deepEqual(schema.required?.sort(), ["outDir", "url"]);
  assert.ok(schema.properties?.allowPrivateNetwork, "allowPrivateNetwork did not survive the trip");
});

test("a tool over stdio returns what the plain function returns", async () => {
  const direct = await inspectArchive({ path: archive });
  const result = await client.callTool({ name: "inspect_archive", arguments: { path: archive } });

  assert.equal(result.isError, undefined);
  const content = result.content as { text: string }[];
  assert.deepEqual(JSON.parse(content[0]!.text), JSON.parse(JSON.stringify(direct)));
});

test("a refused call comes back as an error result and the connection survives", async () => {
  const result = await client.callTool({
    name: "capture_page",
    arguments: { url: "http://127.0.0.1:9/", outDir: "does-not-matter" },
  });

  assert.equal(result.isError, true);
  const content = result.content as { text: string }[];
  assert.match(content[0]!.text, /loopback/);
  // The next call still works: the failure was mapped to a result, not thrown across the transport.
  assert.ok((await client.listTools()).tools.length > 0);
});
