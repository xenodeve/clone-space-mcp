/**
 * A merge gate that does not need GitHub Actions (#2).
 *
 *     bun run verify:status          # verify HEAD, then post its result as a commit status
 *     bun run verify:status <sha>    # ... for a specific commit
 *
 * **The hole this is for.** `CLAUDE.md` states it plainly: the four required checks were left out
 * of branch ruleset `20028550` because Actions is locked account-wide and a check that never
 * reports leaves every PR stuck on *"Expected — waiting for status"*. The consequence it also
 * states: **a human merging on the web is currently ungated.** `t4-gate` runs the verify command
 * before `gh pr merge`, and the `pre-push` guards bind the clone, but both only ever see commands
 * run locally.
 *
 * **A commit status does not need Actions.** Anything with a token can post one against a SHA, and
 * a ruleset can require its context. So the gate can exist with the CI account still locked.
 *
 * **What this is not.** It is **self-attested**: the machine that ran `verify` is the machine that
 * reports the result, so it is a guardrail against forgetting, not a proof against lying. Anyone
 * with push access can post a green status by hand. The four Actions checks remain the real answer
 * and #2 stays open for them — this narrows the hole, it does not close it.
 *
 * **It is armed.** Since 2026-08-16, `t4-verify` is a required check on ruleset `20028550`, so
 * this script is no longer optional: **a PR whose head SHA has no status cannot be merged, by an
 * agent or by a human on the web.** `t4-gate` runs `bun run verify` before `gh pr merge` but posts
 * nothing, so a green local run is not a green check — run this on the PR branch. #2 carries the
 * payload that armed it and the one-command undo.
 */

export const VERIFY_STATUS_CONTEXT = "t4-verify";

export interface VerifyRun {
  exitCode: number;
  command: string;
}

export interface VerifyStatus {
  state: "success" | "failure";
  context: string;
  description: string;
}

/**
 * What to post for a finished verify run.
 *
 * The description says **locally** in both directions on purpose. It is the line a reviewer reads
 * on the pull request, and a status that reads like CI ran would be worse than no status at all —
 * it would claim an independence this mechanism does not have.
 */
export function verifyStatusPayload(run: VerifyRun): VerifyStatus {
  const passed = run.exitCode === 0;
  return {
    state: passed ? "success" : "failure",
    context: VERIFY_STATUS_CONTEXT,
    description: passed
      ? `${run.command} passed locally`
      : `${run.command} failed locally (exit ${run.exitCode})`,
  };
}

async function main(): Promise<void> {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const gh = process.env.GH_PATH ?? "C:/Program Files/GitHub CLI/gh.exe";
  const repo = process.env.T4_REPO ?? "xenodeve/clone-space-mcp";
  const sha =
    process.argv[2] ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const command = "bun run verify";
  console.log(`running ${command} for ${sha}`);
  // `process.execPath` **is** bun here, and using it is not a style choice: `bun` is not on this
  // machine's process PATH (CLAUDE.md says so), so a shell spawn reports a failure that is the
  // spawn's and posts it as the repo's. Measured — the first run of this script posted
  // `failure … exit 1` with the output `'bun' is not recognized as an internal or external command`.
  const run = spawnSync(process.execPath, ["run", "verify"], { stdio: "inherit" });
  const payload = verifyStatusPayload({ exitCode: run.status ?? 1, command });

  execFileSync(
    gh,
    [
      "api",
      `repos/${repo}/statuses/${sha}`,
      "-f",
      `state=${payload.state}`,
      "-f",
      `context=${payload.context}`,
      "-f",
      `description=${payload.description}`,
    ],
    { stdio: "ignore" },
  );
  console.log(`posted ${payload.state} for ${sha}: ${payload.description}`);
  if (payload.state === "failure") process.exitCode = 1;
}

if (import.meta.main) await main();
