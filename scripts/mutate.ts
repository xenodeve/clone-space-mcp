// Deliberately outside bun run verify: this runs the whole suite once per mutation.
//
// Since #82 the defect is applied **in memory**, by a loader hook in the child process, so this
// runner never writes to the working tree. Everything that used to defend that write — a restore
// in a `finally`, signal handlers, an ownership check — is gone, because the failure it defended
// against cannot happen rather than being detected after the fact.
import { classifySuiteResult } from "./classify-suite.ts";
import { MUTATION_ENV } from "./mutation-hook.ts";
import { MUTATIONS, type Mutation } from "./mutations.ts";
import { repoRoot } from "./repo-root.ts";

interface SuiteResult {
  exitCode: number;
  output: string;
}

interface MutationResult {
  id: string;
  status: "CAUGHT" | "SURVIVED" | "FAILED";
}

let interrupted = false;
let activeProcess: Bun.Subprocess | undefined;

function handleInterrupt(): void {
  interrupted = true;
  activeProcess?.kill();
}

process.on("SIGINT", handleInterrupt);
process.on("SIGTERM", handleInterrupt);

async function runSuite(mutation: Mutation): Promise<SuiteResult> {
  // `process.execPath` is this runner's own bun. The hook flag differs per runtime but the hook
  // itself does not: both entry points call `mutateModuleSource`, so both apply identical text.
  const command =
    mutation.suite === "bun"
      ? [process.execPath, "test", "--preload", "./scripts/mutation-preload.ts"]
      : ["node", "--import", "./scripts/mutation-node-hook.ts", "--test", "test/browser/**/*.browser.ts"];

  const child = Bun.spawn(command, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, [MUTATION_ENV]: mutation.id },
  });
  activeProcess = child;
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, output: `${stdout}\n${stderr}` };
  } finally {
    activeProcess = undefined;
  }
}

async function runMutation(mutation: Mutation): Promise<MutationResult> {
  if (interrupted) {
    console.log(`INTERRUPTED: ${mutation.id}`);
    return { id: mutation.id, status: "FAILED" };
  }

  let suite: SuiteResult;
  try {
    suite = await runSuite(mutation);
  } catch (error) {
    console.log(`SUITE FAILED TO RUN: ${mutation.id} — ${String(error)}`);
    return { id: mutation.id, status: "FAILED" };
  }

  switch (classifySuiteResult(suite.output, suite.exitCode, mutation.expect)) {
    case "NOT_APPLIED":
      console.log(`MUTATION NOT APPLIED: ${mutation.id} — the corpus no longer matches the code`);
      return { id: mutation.id, status: "FAILED" };
    case "SURVIVED":
      console.log(`SURVIVED: ${mutation.id}`);
      return { id: mutation.id, status: "SURVIVED" };
    case "CAUGHT":
      console.log(`CAUGHT: ${mutation.id}`);
      return { id: mutation.id, status: "CAUGHT" };
    case "CAUGHT_BY_THE_WRONG_TEST":
      console.log(`CAUGHT BY THE WRONG TEST: ${mutation.id} — expected "${mutation.expect}"`);
      return { id: mutation.id, status: "FAILED" };
  }
}

const results: MutationResult[] = [];
for (const mutation of MUTATIONS) {
  results.push(await runMutation(mutation));
  if (interrupted) break;
}

console.log("");
console.log("Mutation summary");
console.log("| Mutation | Result |");
console.log("| --- | --- |");
for (const result of results) {
  console.log(`| ${result.id} | ${result.status} |`);
}

// Escalate only, so a non-zero code set anywhere earlier in the run survives to the exit.
if (!(results.length === MUTATIONS.length && results.every(({ status }) => status === "CAUGHT"))) {
  process.exitCode = 1;
}
