/**
 * Bounded interaction against a real DOM (#176).
 *
 * The pure tests judge candidate objects this file's author wrote. That proves the rules compose;
 * it cannot prove they fire on a page, because every field they read was supplied by hand. Here the
 * candidates come from `DISCOVERY_SCRIPT` running in Chromium, so a rule that only ever matched a
 * fabricated shape fails.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { driveInteraction, type DriveReport } from "../../src/capture/interaction-drive.ts";
import {
  DEFAULT_LIMITS,
  DISCOVERY_SCRIPT,
  discoveredCandidates,
  planActions,
  type InteractionPlan,
  type RefusalRule,
} from "../../src/capture/interaction.ts";

let browser: Browser;
let servers: FixtureServers;
let page: Page;
let plan: InteractionPlan;
let report: DriveReport;

before(async () => {
  browser = await chromium.launch();
  servers = await startFixtureServers();
  page = await browser.newPage();
  await page.goto(new URL("/interaction-case.html", servers.primary.url).href, {
    waitUntil: "load",
  });
  plan = planActions(discoveredCandidates(await page.evaluate(DISCOVERY_SCRIPT)), DEFAULT_LIMITS);
  report = await driveInteraction(page as never, plan, { settleMs: 40 });
});

after(async () => {
  await servers?.stop();
  await browser?.close();
});

/** The rule reported for the element carrying `id`, or "" when it was not refused at all. */
function ruleFor(id: string): RefusalRule | "" {
  return plan.refusals.find((refusal) => refusal.selector === `#${id}`)?.rule ?? "";
}

test("discovery finds the page's interactive elements", () => {
  assert.ok(plan.discovered >= 12, `only ${plan.discovered} candidates discovered`);
});

test("every discovered selector resolves to exactly one element", async () => {
  const counts = await page.evaluate(
    (selectors: string[]) => selectors.map((selector) => document.querySelectorAll(selector).length),
    plan.actions.map((action) => action.selector),
  );
  assert.deepEqual(
    counts.filter((count) => count !== 1),
    [],
    "a planned action names an ambiguous selector",
  );
});

test("a submit control is refused as a form submission", () => {
  assert.equal(ruleFor("r-submit"), "form-submission");
});

test("a typeless button in a form is refused, because it submits by default", () => {
  assert.equal(ruleFor("r-typeless"), "form-submission");
});

test("an anchor that leaves the document is refused as a navigation", () => {
  assert.equal(ruleFor("r-navigation"), "navigation");
});

test("a download attribute is refused by its own rule", () => {
  assert.equal(ruleFor("r-download"), "download");
});

test("an element opening another browsing context is refused by its own rule", () => {
  assert.equal(ruleFor("r-new-context"), "new-browsing-context");
});

test("a file input is refused, since the driver cannot dismiss a native dialog", () => {
  assert.equal(ruleFor("r-file"), "file-picker");
});

test("an off-origin anchor is refused as cross-origin, ahead of navigation", () => {
  assert.equal(ruleFor("r-cross-origin"), "cross-origin");
});

test("an authentication control is refused by its label", () => {
  assert.equal(ruleFor("r-auth"), "authentication");
});

test("a destructive control is refused by its label", () => {
  assert.equal(ruleFor("r-destructive"), "destructive-wording");
});

test("one element that throws while being read does not abort the whole discovery", () => {
  // `#throwing-element` is a custom element whose innerText getter throws. Without per-element
  // isolation the evaluate rejects and every count below would be zero.
  const named = plan.actions.map((action) => action.selector);
  assert.ok(named.includes("#ok-toggle"), "discovery returned nothing after the throwing element");
});

test("a button associated by form= submits although no form contains it", () => {
  // `closest("form")` is null here. `element.form` is not, and the button's default type is submit.
  assert.equal(ruleFor("r-form-attribute"), "form-submission");
});

test("an icon button's meaning is read from title, since it has no text to read", () => {
  assert.equal(ruleFor("r-icon-title"), "destructive-wording");
});

test("an aria-disabled control is not a candidate at all", () => {
  const named = [...plan.actions.map((a) => a.selector), ...plan.refusals.map((r) => r.selector)];
  assert.ok(!named.includes("#skip-aria-disabled"), "aria-disabled control reached the plan");
});

test("a fully transparent control is not a candidate, however clickable it is", () => {
  const named = [...plan.actions.map((a) => a.selector), ...plan.refusals.map((r) => r.selector)];
  assert.ok(!named.includes("#skip-transparent"), "opacity:0 control reached the plan");
});

test("the safe controls are not refused — a policy that refuses everything is not a policy", () => {
  const safe = ["ok-toggle", "ok-hover", "ok-scroller"];
  // Assert they were discovered first. `ruleFor` returns "" both for "judged and allowed" and for
  // "never seen at all", so without this the test passes when discovery returns nothing.
  const planned = new Set(plan.actions.map((action) => action.selector));
  assert.deepEqual(
    safe.filter((id) => !planned.has(`#${id}`)),
    [],
    "a safe control never reached the plan, so 'not refused' means nothing",
  );
  assert.deepEqual(safe.map(ruleFor), ["", "", ""]);
});

test("an inherited pointer cursor does not make every descendant its own hover target", () => {
  // `cursor` inherits, so a styled button reports a pointer cursor on its text span and on every
  // node inside its icon. Measured on www.firecrawl.dev before the fix: 10 of 32 actions timed out
  // hovering `<g>` and `<path>` that are the same target as their anchor.
  const planned = plan.actions.map((action) => action.selector);
  assert.deepEqual(
    planned.filter((selector) => selector === "#inherited-cursor" || selector === "#inherited-svg"),
    [],
  );
  assert.ok(planned.includes("#ok-hover"), "the top of the pointer-cursor subtree was dropped too");
});

test("no refused element is ever planned for a click", () => {
  const refused = new Set(plan.refusals.map((refusal) => refusal.selector));
  // The filter below is empty either way if nothing was refused, so say that first.
  assert.ok(refused.size > 0, "nothing was refused, so the invariant tests nothing");
  const clicked = plan.actions
    .filter((action) => action.kind === "click")
    .map((action) => action.selector);
  assert.deepEqual(clicked.filter((selector) => refused.has(selector)), []);
});

test("the driver actually clicked the allowed control", async () => {
  assert.equal(await page.evaluate(() => document.body.dataset.toggled), "yes");
});

test("the driver actually hovered a pointer-cursor element", async () => {
  assert.equal(await page.evaluate(() => document.body.dataset.hovered), "yes");
});

test("the driver actually scrolled a nested container", async () => {
  assert.equal(await page.evaluate(() => document.body.dataset.scrolled), "yes");
});

test("the run never navigated, and so abandoned nothing", () => {
  assert.equal(report.navigatedTo, "");
  assert.equal(report.abandoned, 0);
});

test("every planned action was performed", () => {
  const failed = report.performed.filter((result) => !result.ok);
  assert.deepEqual(failed, [], `actions failed: ${JSON.stringify(failed)}`);
  assert.equal(report.performed.length, plan.actions.length);
});
