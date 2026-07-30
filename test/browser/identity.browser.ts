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

test("an element inserted after load still gets an id", async () => {
  // The fixture's `dynamic-late-block` host is empty in the served HTML and receives a <p>
  // 600ms later. A preorder walk at `load` cannot see it, so this is what forces the
  // MutationObserver to exist — and what shows that the previous test's stability came
  // partly from never observing the dynamic half of the page.
  const snapshot = await captureIdentity(page, servers.primary.url, { settleMs: 1500 });

  const late = snapshot.elements.find((e) => e.tag === "p" && e.textHash?.includes("600ms"));

  assert.ok(late, "the element inserted 600ms after load is missing from the snapshot");
  assert.match(late.id, /^wa:0:\d+$/);
});

test("the same page loaded twice produces the same ids", async () => {
  // Everything downstream assumes two runs are comparable. If the walk is not deterministic
  // there is nothing for the ตัวจับคู่ to reconcile, and every later slice is meaningless.
  const first = await captureIdentity(page, servers.primary.url, { settleMs: 1500 });
  const second = await captureIdentity(page, servers.primary.url, { settleMs: 1500 });

  const shape = (s: Awaited<ReturnType<typeof captureIdentity>>) =>
    s.elements.map((e) => `${e.id} ${e.tag} ${e.siblingOrdinal} ${JSON.stringify(e.attrs)}`);

  assert.deepEqual(shape(second), shape(first));
});

test("every element in the served page gets a wa: id", async () => {
  const snapshot = await captureIdentity(page, servers.primary.url);

  // Ground truth from the fixture: this element is declared in fixture-manifest.json, so
  // its absence means the walk never reached it rather than that the page changed.
  const hero = snapshot.elements.find((e) => e.attrs["data-fixture-id"] === "gsap-hero");

  assert.ok(hero, "the gsap-hero element is missing from the snapshot");
  assert.match(hero.id, /^wa:0:\d+$/);
});
