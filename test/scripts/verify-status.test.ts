import { describe, expect, test } from "bun:test";
import { VERIFY_STATUS_CONTEXT, verifyStatusPayload } from "../../scripts/verify-status.ts";

/**
 * #2. GitHub Actions is locked account-wide, so the four required checks the ruleset wants can
 * never report and were deliberately left out — which leaves **a human merging on the web
 * ungated**, because `t4-gate` and the `pre-push` guards only see commands run locally.
 *
 * A commit status does not need Actions. Anything holding a token can post one, and a branch
 * ruleset can require it. That closes the web-merge hole with the CI account still locked.
 *
 * **It is self-attested and this file says so rather than implying otherwise.** The same machine
 * that ran `verify` reports the result, so it is a guardrail against forgetting, not proof against
 * lying. The four Actions checks remain the real answer and #2 stays open for them.
 */
describe("verifyStatusPayload", () => {
  test("reports success only for a zero exit", () => {
    const payload = verifyStatusPayload({ exitCode: 0, command: "bun run verify" });
    expect(payload.state).toBe("success");
    expect(payload.context).toBe(VERIFY_STATUS_CONTEXT);
    expect(payload.description).toMatch(/passed locally/);
  });

  test("reports failure for any non-zero exit", () => {
    for (const exitCode of [1, 2, 137]) {
      expect(verifyStatusPayload({ exitCode, command: "bun run verify" }).state).toBe("failure");
    }
  });

  test("says the result is local, because the status cannot say it is not", () => {
    // The description is what a reviewer reads on the PR. A status that reads like CI ran would be
    // worse than no status: it would claim an independence this mechanism does not have.
    for (const exitCode of [0, 1]) {
      expect(verifyStatusPayload({ exitCode, command: "bun run verify" }).description).toMatch(
        /locally/,
      );
    }
  });

  test("names the command that produced it, so a reader can re-run the same thing", () => {
    expect(
      verifyStatusPayload({ exitCode: 0, command: "bun run verify" }).description,
    ).toContain("bun run verify");
  });
});
