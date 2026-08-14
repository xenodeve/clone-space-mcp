import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturePage } from "../../src/serve/tools/capture-page.ts";
import { fakeBrowser } from "./fixture-archive.ts";

test("capturePage never runs two browsers at once", async () => {
  // An MCP server is long-lived and an agent can call a tool as often as it likes. Without a bound
  // every concurrent call launches its own Chromium, and a handful of them is a machine with no
  // memory left. The failure is the host's, not the archive's, so no test on an archive sees it.
  let live = 0;
  let peak = 0;
  const launcher = {
    launch: async () => {
      live += 1;
      peak = Math.max(peak, live);
      return {
        ...fakeBrowser({ log: { entries: [] } }),
        async close() {
          live -= 1;
        },
      };
    },
  };

  const roots = [1, 2, 3, 4].map(() => join(mkdtempSync(join(tmpdir(), "clone-space-conc-")), "a"));
  try {
    await Promise.all(
      roots.map((outDir) =>
        capturePage(
          { url: "https://example.com", outDir, resolveHost: async () => ["93.184.216.34"] },
          launcher as never,
        ),
      ),
    );
    expect(peak).toBe(1);
    expect(live).toBe(0);
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
