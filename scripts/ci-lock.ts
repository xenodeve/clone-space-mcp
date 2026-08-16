/**
 * Is the CI exemption still valid? (#2)
 *
 *     bun run scripts/ci-lock.ts
 *
 * GitHub Actions is locked account-wide for billing, so every job of every run fails in seconds
 * without executing a step, and this repo merges under a standing exemption. `CLAUDE.md` says the
 * important half is the **expiry**:
 *
 * > It **expires the moment a workflow run actually completes.** At that point `.claude/t4.json`
 * > gets `"requireGreenCI": true` and this stops being a rule anyone has to remember —
 * > `t4-gate` denies the merge itself.
 *
 * *"Anyone has to remember"* is the problem this file removes. Until the flag can be set, the
 * expiry is a thing a person notices; this makes it a question a command answers, so a session can
 * check it in one line instead of restating the exemption from a document that might have gone
 * stale. The repo prefers mechanisms over judgement, and this is the cheapest mechanism available
 * while the only real gate — a server-side required check — cannot exist.
 *
 * **It cannot arm the gate itself.** Editing `.claude/t4.json` is refused by the permission
 * classifier, which is correct: the file decides what the gate denies, and a script that could
 * rewrite it would be a gate that can disarm itself. This reports; a human or an agent acts.
 */

export interface RunJob {
  name: string;
  conclusion: string;
  steps: { conclusion?: string }[];
}

export interface RunSummary {
  annotations: string[];
  jobs: RunJob[];
}

export interface LockVerdict {
  /** `true` while the exemption holds, `false` once it has expired, `undefined` when unreadable. */
  locked: boolean | undefined;
  reason: string;
}

const BILLING = "locked due to a billing issue";

/**
 * Read one workflow run and say whether the exemption still holds.
 *
 * **A job that ran a step ends it**, whatever that step concluded — the exemption is about jobs
 * that cannot start, not about jobs that fail, and a genuinely red suite means CI works and the
 * gate should be armed.
 *
 * **Stepless and unexplained is `undefined`, not locked.** A disabled workflow or a permissions
 * failure looks identical from here, and reporting one of those as the billing exemption would
 * launder an unrelated breakage into a rule this repo already merges past.
 */
export function ciLockVerdict(run: RunSummary): LockVerdict {
  if (run.jobs.length === 0) {
    return {
      locked: undefined,
      reason: "no workflow run to read — cannot say whether the exemption still holds",
    };
  }
  const ran = run.jobs.find((job) => job.steps.length > 0);
  if (ran !== undefined) {
    return {
      locked: false,
      reason: `job ${ran.name} ran ${ran.steps.length} step${ran.steps.length === 1 ? "" : "s"}, so a workflow run has completed`,
    };
  }
  if (run.annotations.some((annotation) => annotation.includes(BILLING))) {
    return { locked: true, reason: "every job was refused for billing and none ran a step" };
  }
  return {
    locked: undefined,
    reason: "jobs ran no steps but nothing said it was billing — read the run before assuming",
  };
}

/** Entry point. Kept out of the module body so the verdict stays importable from a test. */
async function main(): Promise<void> {
  const { execFileSync } = await import("node:child_process");
  const gh = process.env.GH_PATH ?? "C:/Program Files/GitHub CLI/gh.exe";
  const repo = process.argv[2] ?? "xenodeve/clone-space-mcp";
  const run = (args: string[]): string =>
    execFileSync(gh, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

  const listed = JSON.parse(run(["run", "list", "--repo", repo, "--limit", "1", "--json", "databaseId,displayTitle"])) as {
    databaseId: number;
    displayTitle: string;
  }[];
  const latest = listed[0];
  if (latest === undefined) {
    console.log("UNREADABLE  no workflow run to read — cannot say whether the exemption still holds");
    process.exitCode = 2;
    return;
  }
  const viewed = JSON.parse(
    run(["run", "view", String(latest.databaseId), "--repo", repo, "--json", "jobs"]),
  ) as { jobs: { name: string; conclusion: string; steps: { conclusion?: string }[] }[] };
  // `gh run view --json` does not carry annotations, so they come from the human-readable view.
  const annotations = run(["run", "view", String(latest.databaseId), "--repo", repo])
    .split("\n")
    .map((line) => line.trim());

  const verdict = ciLockVerdict({ annotations, jobs: viewed.jobs });
  const label = verdict.locked === true ? "LOCKED" : verdict.locked === false ? "UNLOCKED" : "UNREADABLE";
  console.log(`${label}  ${verdict.reason}`);
  console.log(`run ${latest.databaseId}  ${latest.displayTitle}`);
  if (verdict.locked === true) {
    console.log("The #2 exemption still holds. Restate it in the body of every PR that merges under it.");
    return;
  }
  if (verdict.locked === false) {
    console.log('The #2 exemption has EXPIRED. Set "requireGreenCI": true in .claude/t4.json, add the');
    console.log("four checks to branch ruleset 20028550, and close #2.");
    process.exitCode = 1;
    return;
  }
  process.exitCode = 2;
}

if (import.meta.main) await main();
