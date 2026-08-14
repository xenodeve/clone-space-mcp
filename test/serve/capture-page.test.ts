import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturePage } from "../../src/serve/tools/capture-page.ts";
import { fakeBrowser } from "./fixture-archive.ts";

/**
 * `capturePage` takes its launcher, so layer 1 can exercise the tool with no browser at all. The
 * production launcher is Playwright's `chromium.launch()`, wired in `src/serve/node-tools.ts`.
 */
function fakeLauncher() {
  let closed = false;
  return {
    wasClosed: () => closed,
    launch: async () => ({
      ...fakeBrowser({ log: { entries: [] } }),
      async close() {
        closed = true;
      },
    }),
  };
}

test("capturePage returns the archive directory, not the HAR path inside it", async () => {
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-capture-tool-")), "archive");
  const launcher = fakeLauncher();
  try {
    const result = await capturePage({ url: "https://example.com", outDir, resolveHost: async () => ["93.184.216.34"] }, launcher as never);

    // `captureHar` returns the HAR. A caller handed that path and told it was the archive would
    // pass it straight to `inspect_archive`, which would refuse it as "not an archive".
    expect(result.archive).toBe(outDir);
    expect(result.har).toBe(join(outDir, "network.har"));
    expect(existsSync(join(outDir, "commit.json"))).toBe(true);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("capturePage closes the browser it launched, even when capture fails", async () => {
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-capture-tool-fail-")), "archive");
  const launcher = fakeLauncher();
  try {
    // An empty HAR path is not the failure; a browser that throws during capture is. The fake
    // browser writes its HAR on close, so pointing capture at a URL it refuses is enough.
    await expect(
      capturePage({ url: "ftp://example.com", outDir, resolveHost: async () => ["93.184.216.34"] }, launcher as never),
    ).rejects.toThrow(/unsupported protocol/);
    // Refused before launching: nothing to close, and no browser process is left behind.
    expect(launcher.wasClosed()).toBe(false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("capturePage releases the browser after a successful capture", async () => {
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-capture-tool-close-")), "archive");
  const launcher = fakeLauncher();
  try {
    await capturePage({ url: "https://example.com", outDir, resolveHost: async () => ["93.184.216.34"] }, launcher as never);
    // Without this the MCP server leaks a Chromium process per call, which a long-lived agent
    // session turns into a machine with no memory left.
    expect(launcher.wasClosed()).toBe(true);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
