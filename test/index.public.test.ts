import { expect, test } from "bun:test";
import * as api from "../src/index.ts";

/**
 * The package's own entry point. Everything the alpha can do has to be reachable from here, or the
 * package exports a pipeline nobody can call: before #130 this file exported element identity and
 * nothing else, while capture, the archive reader and the MCP server all existed.
 */
test("the package entry point exposes the alpha surface", () => {
  for (const name of [
    "captureHar",
    "readArchive",
    "inspectArchive",
    "createServer",
    "BROWSERLESS_TOOLS",
    "findTool",
    "SERVER_INFO",
    "reconcile",
    "fingerprintKey",
  ]) {
    expect(api[name as keyof typeof api]).toBeDefined();
  }
});

test("the entry point stays reachable from Bun", () => {
  // `capture_page` is deliberately absent: it imports Playwright, whose client does not complete
  // its handshake under Bun (ADR 0001), and an import failure here would take every Bun test with
  // it rather than one. It is registered by the Node entry point instead.
  expect(Object.keys(api)).not.toContain("capturePage");
  expect(Object.keys(api)).not.toContain("ALL_TOOLS");
  expect(api.BROWSERLESS_TOOLS.map((tool) => tool.name)).toEqual(["inspect_archive"]);
});
