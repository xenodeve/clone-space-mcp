// Deliberately outside bun run verify: this runs the whole suite once per mutation.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTATIONS, type Mutation } from "./mutations.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function countOccurrences(content: string, find: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(find, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + find.length;
  }
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
  const original = await readFile(path, "utf8");
  const occurrences = countOccurrences(original, mutation.find);
  if (occurrences !== 1) {
    console.log(`MUTATION NOT APPLIED: ${mutation.id} — find text occurs ${occurrences} times`);
    return { id: mutation.id, status: "FAILED" };
  }

  const mutated = original.replace(mutation.find, mutation.replace);
  try {
    await writeFile(path, mutated, "utf8");
    const written = await readFile(path, "utf8");
    if (written === original || written !== mutated) {
      console.log(`MUTATION NOT APPLIED: ${mutation.id} — file content did not change`);
      return { id: mutation.id, status: "FAILED" };
    }

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
  } finally {
    await writeFile(path, original, "utf8");
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

process.exitCode = results.length === MUTATIONS.length && results.every(({ status }) => status === "CAUGHT") ? 0 : 1;
