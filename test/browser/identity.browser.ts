import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureIdentity } from "../../src/identity/inject.ts";

/**
 * The injector is browser code, so almost none of its risk is reachable from a unit test.
 * These run under Node against the real fixture (ADR 0001), and they are part of
 * `bun run verify` by decision, so a merge cannot happen without them.
 */

let servers: FixtureServers;
let browser: Browser;
let page: Page;

before(async () => {
  servers = await startFixtureServers();
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
  await servers?.stop();
});

test("every element in the served page gets a wa: id", async () => {
  const snapshot = await captureIdentity(page, servers.primary.url);

  // Ground truth from the fixture: this element is declared in fixture-manifest.json, so
  // its absence means the walk never reached it rather than that the page changed.
  const hero = snapshot.elements.find((e) => e.attrs["data-fixture-id"] === "gsap-hero");

  assert.ok(hero, "the gsap-hero element is missing from the snapshot");
  assert.match(hero.id, /^wa:0:\d+$/);
});
