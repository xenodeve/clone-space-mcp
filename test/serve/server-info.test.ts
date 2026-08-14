import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_INFO } from "../../src/serve/mcp.ts";
import { repoRoot } from "../../scripts/repo-root.ts";

test("the version the server reports is the version the package declares", () => {
  // `SERVER_INFO` crosses the protocol: a client reads it during the handshake and may key
  // behaviour or bug reports off it. A second copy of the version is a second source of truth, and
  // this one was already wrong — the server announced 0.1.0-alpha.0 while the package said 0.0.0.
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    version: string;
    name: string;
  };

  expect(SERVER_INFO.version).toBe(pkg.version);
  expect(SERVER_INFO.name).toBe(pkg.name);
});
