import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureHar } from "../../src/capture/record.ts";
import { validateTargets, type TargetsV1 } from "../../src/capture/targets.ts";

let browser: Browser;
let tempDir: string;
let inventory: TargetsV1;

before(async () => {
  browser = await chromium.launch();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-targets-"));
  const servers: FixtureServers = await startFixtureServers();
  const archive = join(tempDir, "archive");
  try {
    await captureHar({ allowPrivateNetwork: true, browser: browser as never, url: servers.primary.url, outDir: archive });
  } finally {
    await servers.stop();
  }
  inventory = JSON.parse(readFileSync(join(archive, "targets.json"), "utf8")) as TargetsV1;
});

after(async () => {
  await browser?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/**
 * §6.9 against real Chromium. Everything before this exercised the inventory through a fake
 * browser, which can only ever confirm that the code does what its author expected — the
 * producer/validator contradiction that blocked #117 was exactly that shape and survived a full
 * unit suite.
 */
test("publishes an inventory that validates, from a real browser session", () => {
  assert.deepEqual(validateTargets(inventory), { ok: true });
  assert.ok(inventory.targets.length > 0, "no target was discovered at all");
});

test("reports the page target with a real Chromium id", () => {
  const page = inventory.targets.find((target) => target.type === "page");
  assert.ok(page, `no page target; types were ${inventory.targets.map((t) => t.type).join(",")}`);
  // Chromium ids are 32 hex characters. A synthetic id would mean the inventory is reporting
  // something this repo invented rather than something the browser did.
  assert.match(page.targetId, /^[0-9A-F]{32}$/);
  assert.ok(page.openedAt >= 0, "a capture-relative timestamp cannot be negative");
});

test("does not report targets from a concurrent capture sharing the browser", async () => {
  // Discovery is browser-wide. A second context open at the same time reports its targets to this
  // session too, and without context scoping the archive would describe a page it never visited.
  const other = await browser.newContext();
  try {
    await (await other.newPage()).goto("about:blank");
    const servers: FixtureServers = await startFixtureServers();
    const archive = join(tempDir, "scoped");
    try {
      await captureHar({ allowPrivateNetwork: true, browser: browser as never, url: servers.primary.url, outDir: archive });
    } finally {
      await servers.stop();
    }
    const scoped = JSON.parse(readFileSync(join(archive, "targets.json"), "utf8")) as TargetsV1;
    assert.ok(
      !scoped.targets.some((target) => target.url === "about:blank"),
      `the other context leaked in: ${scoped.targets.map((t) => t.url ?? t.type).join(",")}`,
    );
  } finally {
    await other.close();
  }
});

test("reports the dedicated worker the page created", () => {
  // The fixture declares `dedicated-worker`. A worker is invisible to the page CDP session, so
  // this is the case that distinguishes a browser-level inventory from one that only sees the
  // page — the entire reason §6.9 opens a second session.
  // Measured: removing `Target.setDiscoverTargets` leaves this test green, because the boundary
  // snapshot from #117 deliverable 2 reports the worker anyway. The two paths are redundant by
  // design for a target that still exists at the boundary, so neither is isolated by a target that
  // outlives the run. Isolating either needs one that comes and goes during it — #122.
  const workers = inventory.targets.filter((target) => target.type.includes("worker"));
  assert.ok(
    workers.length > 0,
    `no worker target; the inventory held ${inventory.targets.map((t) => t.type).join(",")}`,
  );
});
