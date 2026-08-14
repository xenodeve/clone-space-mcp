import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/serve/mcp.ts";
import { BROWSERLESS_TOOLS } from "../../src/serve/tools/index.ts";
import { inspectArchive } from "../../src/serve/tools/inspect-archive.ts";
import { captureFixtureArchive } from "./fixture-archive.ts";

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(BROWSERLESS_TOOLS);
  const client = new Client({ name: "test-client", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

test("a real client handshake lists the tools the registry declares", async () => {
  const { client, server } = await connectedClient();
  try {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(BROWSERLESS_TOOLS.map((tool) => tool.name));
  } finally {
    await server.close();
  }
});

test("a tool called over the protocol returns what the plain function returns", async () => {
  const root = await captureFixtureArchive();
  const { client, server } = await connectedClient();
  try {
    const direct = await inspectArchive({ path: root });
    const overProtocol = await client.callTool({ name: "inspect_archive", arguments: { path: root } });

    // Layer 1 and layer 3 must agree. If they can disagree, behaviour has leaked into mcp.ts —
    // which is exactly what #8's constraint forbids, and what a layer-1-only suite cannot see.
    const content = overProtocol.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]!.text)).toEqual(JSON.parse(JSON.stringify(direct)));
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failing tool comes back as an error result, not a dead connection", async () => {
  const { client, server } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "inspect_archive",
      arguments: { path: "definitely-not-an-archive" },
    });

    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0]!.text).toMatch(/not an archive/);
    // The connection survives: the next call still works, which is the whole reason the failure is
    // mapped to a result rather than thrown across the transport.
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  } finally {
    await server.close();
  }
});
