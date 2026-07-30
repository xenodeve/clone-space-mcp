import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureIdentity } from "../../src/identity/inject.ts";
import { reconcile } from "../../src/identity/reconcile.ts";

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

test("an element inside an open shadow root gets an id", async () => {
  // The fixture's <shadow-card> attaches an open root containing <div part="mark">. A walk
  // over children alone never enters it — element.children stops at the shadow boundary.
  const snapshot = await captureIdentity(page, servers.primary.url, { settleMs: 1500 });

  const mark = snapshot.elements.find((e) => e.attrs["part"] === "mark");

  assert.ok(mark, "the element inside the open shadow root is missing from the snapshot");
  const host = snapshot.elements.find((e) => e.id === mark.parentId);
  assert.equal(host?.attrs["data-identity-case"], "shadow-dom", "its parent should be the host");
});

test("an element inside a same-origin iframe gets an id in its own frame namespace", async () => {
  // The fixture's iframe loads /frame.html, which contains a <div class="dot"> with its own
  // animation. It is a separate document, so a walk of the top document cannot reach it.
  const snapshot = await captureIdentity(page, servers.primary.url, { settleMs: 1500 });

  const inFrame = snapshot.elements.filter((e) => e.frameKey !== "0");

  assert.ok(inFrame.length > 0, "no element from the iframe reached the snapshot");
  assert.ok(
    inFrame.some((e) => e.tag === "div"),
    "the iframe's animated .dot is missing",
  );
});

test("the frame key does not depend on the frame's position among its siblings", async () => {
  // ADR 0002 records the flaw this pins: an occurrence index is positional, so reordering
  // two frames swaps their namespaces silently. The key is derived from the owning
  // element's fingerprint instead, so it survives a reload that renumbers ids.
  const first = await captureIdentity(page, servers.primary.url, { settleMs: 1500 });
  const second = await captureIdentity(page, servers.primary.url, { settleMs: 1500 });

  const keys = (s: Awaited<ReturnType<typeof captureIdentity>>) =>
    [...new Set(s.elements.map((e) => e.frameKey))].sort();

  assert.deepEqual(keys(second), keys(first));
  assert.ok(keys(first).length >= 2, `expected a nested frame key, got ${keys(first).join(", ")}`);
});

test("an element removed before the snapshot is still known", async () => {
  // The fixture's delete-and-reinsert case takes .flicker out of the tree and puts it back
  // on a timer. A walk performed at snapshot time sees whichever side of that toggle it
  // lands on, so the element's presence in the archive would be a coin flip. Here the
  // removal is done deliberately so the property is tested rather than raced.
  await captureIdentity(page, servers.primary.url, { settleMs: 300 });
  await page.evaluate<void>(
    `document.querySelector("[data-identity-case='delete-and-reinsert'] .flicker")?.remove()`,
  );

  const after = await captureIdentity(page, servers.primary.url, { settleMs: 0, reuse: true });
  const flicker = after.elements.filter((e) => e.tag === "span" && e.parentId !== null);

  assert.ok(
    flicker.some((e) => {
      const parent = after.elements.find((p) => p.id === e.parentId);
      return parent?.attrs["data-identity-case"] === "delete-and-reinsert";
    }),
    "the removed .flicker is absent — the snapshot only knows what is attached right now",
  );
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

test("capture and replay reconcile completely across all five identity hard cases", async () => {
  // The exit criterion for #9. Two independent runs of the same page stand in for capture
  // and replay until the replay stage exists — they are already two separate constructions
  // of the DOM, which is the property that matters.
  const capture = await captureIdentity(page, servers.primary.url, { settleMs: 1500 });
  const replay = await captureIdentity(page, servers.primary.url, { settleMs: 1500 });

  const result = reconcile(capture, replay);
  const matched = new Set(result.matched.map((m) => m.captureId));

  assert.deepEqual(
    result.unresolved,
    [],
    `unresolved: ${JSON.stringify(result.unresolved.slice(0, 3))}`,
  );

  // Ground truth from fixture-manifest.json — each hard case must be matched, not merely
  // absent from the unresolved list.
  for (const kind of [
    "duplicate-siblings",
    "shadow-dom",
    "iframe",
    "delayed-insertion",
    "delete-and-reinsert",
  ]) {
    const el = capture.elements.find((e) => e.attrs["data-identity-case"] === kind);
    assert.ok(el, `${kind} is missing from the capture snapshot`);
    assert.ok(matched.has(el.id), `${kind} was captured but never matched`);
  }
});
