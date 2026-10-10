import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ciLockVerdict, latestOwnRun, OWN_WORKFLOW } from "../../scripts/ci-lock.ts";

/**
 * #2. GitHub Actions is locked account-wide for billing, so every job of every run fails in
 * seconds without executing a step, and this repo merges under a standing exemption.
 *
 * `CLAUDE.md` says the important half is the **expiry**: the exemption ends the moment a workflow
 * run actually completes, at which point `.claude/t4.json` gets `"requireGreenCI": true`. That is
 * a rule someone has to remember. This turns it into a question a command answers.
 */
describe("ciLockVerdict", () => {
  test("reports the exemption as valid while every job is refused for billing", () => {
    expect(
      ciLockVerdict({
        annotations: ["The job was not started because your account is locked due to a billing issue."],
        jobs: [
          { name: "lint", conclusion: "failure", steps: [] },
          { name: "test", conclusion: "failure", steps: [] },
        ],
      }),
    ).toEqual({ locked: true, reason: "every job was refused for billing and none ran a step" });
  });

  test("reports the exemption as expired once any job actually ran a step", () => {
    // This is the condition `CLAUDE.md` names, and the only one that ends the exemption. A step
    // with a conclusion is a step the runner executed.
    expect(
      ciLockVerdict({
        annotations: [],
        jobs: [{ name: "lint", conclusion: "success", steps: [{ conclusion: "success" }] }],
      }),
    ).toEqual({ locked: false, reason: "job lint ran 1 step, so a workflow run has completed" });
  });

  test("reports expired even when the run failed, because a red run is still a run", () => {
    // The exemption is about jobs that cannot start, not about jobs that fail. A genuinely failing
    // suite means CI works and the gate should be armed.
    expect(
      ciLockVerdict({
        annotations: ["Process completed with exit code 1."],
        jobs: [{ name: "test", conclusion: "failure", steps: [{ conclusion: "failure" }] }],
      }),
    ).toEqual({ locked: false, reason: "job test ran 1 step, so a workflow run has completed" });
  });

  test("refuses to guess when there is no run to read", () => {
    expect(ciLockVerdict({ annotations: [], jobs: [] })).toEqual({
      locked: undefined,
      reason: "no workflow run to read — cannot say whether the exemption still holds",
    });
  });

  test("refuses to guess when jobs ran no steps and no billing annotation says why", () => {
    // Stepless and unexplained is not evidence of a billing lock. Some other refusal — a disabled
    // workflow, a permissions failure — looks identical from here, and reporting it as the
    // exemption would launder an unrelated breakage into a rule this repo already merges past.
    expect(
      ciLockVerdict({
        annotations: ["Workflow does not have permission to run."],
        jobs: [{ name: "lint", conclusion: "failure", steps: [] }],
      }),
    ).toEqual({
      locked: undefined,
      reason: "jobs ran no steps but nothing said it was billing — read the run before assuming",
    });
  });
});

/**
 * #218. The exemption is about this repository's own workflow. Measured 2026-10-10: the newest run
 * was **Dependabot Updates**, a GitHub-managed workflow that executes while the billing lock holds,
 * so the command printed `UNLOCKED` and told the reader to arm five required checks — the same hour
 * PR #217's `T4 verify` jobs all ran 0 steps.
 */
describe("latestOwnRun (#218)", () => {
  test("skips a newer run of another workflow", () => {
    expect(
      latestOwnRun([
        { databaseId: 3, displayTitle: "github_actions in /. - Update", workflowName: "Dependabot Updates" },
        { databaseId: 2, displayTitle: "feat(extract): …", workflowName: "T4 verify" },
        { databaseId: 1, displayTitle: "older", workflowName: "T4 verify" },
      ])?.databaseId,
    ).toBe(2);
  });

  test("names the workflow the YAML actually declares, so a rename cannot go unnoticed", () => {
    const yaml = readFileSync(new URL("../../.github/workflows/t4-verify.yml", import.meta.url), "utf8");
    expect(/^name:\s*(.+)$/m.exec(yaml)?.[1]?.trim()).toBe(OWN_WORKFLOW);
  });

  test("is undefined when this repository's workflow never ran, rather than reading another one", () => {
    expect(
      latestOwnRun([{ databaseId: 3, displayTitle: "update", workflowName: "Dependabot Updates" }]),
    ).toBeUndefined();
  });
});
