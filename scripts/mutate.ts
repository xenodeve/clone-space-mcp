// Deliberately outside bun run verify: this runs the whole suite once per mutation.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { MutationNotAppliedError, withMutatedFile } from "./mutation-apply.ts";
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

function resolveBun(): string {
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  for (const directory of pathValue.split(delimiter)) {
    for (const name of ["bun.exe", "bun"]) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) return resolve(candidate);
    }
  }

  for (const name of ["bun.exe", "bun"]) {
    const candidate = join(homedir(), ".bun", "bin", name);
    if (existsSync(candidate)) return resolve(candidate);
  }

  throw new Error("bun executable not found on PATH or in $HOME/.bun/bin");
}

async function runSuite(mutation: Mutation): Promise<SuiteResult> {
  const command =
    mutation.suite === "bun"
      ? [resolveBun(), "test"]
      : ["node", "--test", "test/browser/**/*.browser.ts"];
  const child = Bun.spawn(command, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
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

async function applyMutation(mutation: Mutation): Promise<MutationResult> {
  const path = resolve(repoRoot, mutation.file);

  try {
    return await withMutatedFile<MutationResult>(path, mutation.find, mutation.replace, async () => {
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

      if (suite.exitCode === 0) {
        console.log(`SURVIVED: ${mutation.id}`);
        return { id: mutation.id, status: "SURVIVED" };
      }
      if (suite.output.includes(mutation.expect)) {
        console.log(`CAUGHT: ${mutation.id}`);
        return { id: mutation.id, status: "CAUGHT" };
      }

      console.log(`CAUGHT BY THE WRONG TEST: ${mutation.id} — expected "${mutation.expect}"`);
      return { id: mutation.id, status: "FAILED" };
    });
  } catch (error) {
    // Only a stale corpus is reported this way. Anything else is a real failure of this runner
    // and is rethrown rather than dressed up as a mutation that did not apply.
    if (!(error instanceof MutationNotAppliedError)) throw error;
    console.log(`MUTATION NOT APPLIED: ${mutation.id} — ${error.message}`);
    return { id: mutation.id, status: "FAILED" };
  }
}

const results: MutationResult[] = [];
for (const mutation of MUTATIONS) {
  results.push(await applyMutation(mutation));
  if (interrupted) break;
}

console.log("");
console.log("Mutation summary");
console.log("| Mutation | Result |");
console.log("| --- | --- |");
for (const result of results) {
  console.log(`| ${result.id} | ${result.status} |`);
}

// Escalate only. Assigning 0 here would erase a non-zero code set elsewhere in the run — notably
// the one `restoreIfOurs` sets when it refuses to put a file back, which is the alarm this runner
// most needs to survive to the exit code.
if (!(results.length === MUTATIONS.length && results.every(({ status }) => status === "CAUGHT"))) {
  process.exitCode = 1;
}
