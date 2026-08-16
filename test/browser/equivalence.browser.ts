import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { runEquivalence } from "../../src/equivalence/run.ts";

let browser: Browser;
let tempDir: string;
let counter = 0;

before(async () => {
  browser = await chromium.launch();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-equivalence-"));
});

after(async () => {
  await browser?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/**
 * #171. The gate's first real verdict: drive the LIVE page and the replayed archive with the same
 * driver, in one session, and compare. Comparing across days would measure the site's drift rather
 * than the clone's fidelity, which is why capture and comparison happen here without an interval.
 */
test("reports a verdict and a coverage vector for the fixture", async () => {
  const servers: FixtureServers = await startFixtureServers();
  try {
    const report = await runEquivalence({
      url: servers.primary.url,
      outDir: join(tempDir, `archive-${(counter += 1)}`),
      browser: browser as never,
      // The fixture servers are on loopback (#162).
      allowPrivateNetwork: true,
    });

    // The fixture serves everything it is asked for, so a residual here is a real defect in the
    // pipeline rather than a property of the page.
    assert.deepEqual(report.residual, [], `unexplained residual: ${JSON.stringify(report.fields.filter((f) => f.verdict === "different"))}`);
    assert.equal(report.verdict, "PASS");

    // Coverage travels with the verdict, always, and is a vector.
    assert.ok(report.coverage.scroll !== undefined, "coverage does not report the scroll dimension");
    assert.equal(typeof report.coverage, "object");

    // #176 is wired in: the gate drives a bounded interaction plan on both sides and reports what
    // it actually reached. This asserted 0 while the gate drove nothing; asserting it still does
    // would now be asserting that the wiring is absent.
    assert.ok(
      (report.coverage.interaction ?? 0) > 0,
      `interaction coverage is ${report.coverage.interaction} — the plan reached nothing`,
    );

    // Zero is still the honest number for this one, and saying so is the point: a driven click runs
    // the listeners on the elements the plan reached, and the gate does not yet count which of the
    // page's registered listeners those were.
    assert.equal(report.coverage.listener_execution, 0);

    // The clone resolved every selector the live page offered, and drove every planned action.
    // On a controlled fixture that is ground truth, not a tolerance: anything below 100 means the
    // archive is missing an element the live page has, which is what `interaction.stale` exists to
    // surface. The verdict `equal` alone would be satisfied by both sides failing identically.
    assert.equal(report.coverage.interaction, 100, "the clone did not drive every planned action");
    assert.equal(
      report.fields.find((field) => field.field === "interaction.stale")?.verdict,
      "equal",
    );
  } finally {
    await servers.stop();
  }
});

/**
 * The driver must be the same on both sides. A digest field produced live and absent from replay
 * is `unobserved` — never agreement — and the verdict has to stop claiming PASS.
 */
test("a field only one side produced is unobserved and blocks a PASS", async () => {
  const servers: FixtureServers = await startFixtureServers();
  try {
    const report = await runEquivalence({
      url: servers.primary.url,
      outDir: join(tempDir, `archive-${(counter += 1)}`),
      browser: browser as never,
      // The fixture servers are on loopback (#162).
      allowPrivateNetwork: true,
      // The fixture page rests before the first sample, so the full eight-second budget buys this
      // assertion nothing and costs six passes of it. The test above leaves the default alone, so
      // the number a real site is measured with is still exercised once per run (#182).
      sampleBudget: 4,
      // Injected so the test can produce the one-sided case without breaking a real page.
      extraLiveField: { "probe.oneSided": 1 },
    });

    assert.equal(report.verdict, "INCOMPLETE");
    assert.deepEqual(report.residual, []);
    assert.ok(
      report.fields.some((f) => f.field === "probe.oneSided" && f.verdict === "unobserved"),
      "the one-sided field was not reported as unobserved",
    );
  } finally {
    await servers.stop();
  }
});
