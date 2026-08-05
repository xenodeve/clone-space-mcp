import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { MUTATION_ENV } from "../../scripts/mutation-hook.ts";
import { repoRoot } from "../../scripts/repo-root.ts";

const PRINTER = "test/scripts/fixtures/print-fingerprint-key.ts";
const DEFECT = "fingerprint-key-gates-on-ordinal-and-text";

/**
 * `fingerprintKey` on the element the printer builds. Both literals come from the two versions of
 * the return expression — the fixed one in `src/identity/fingerprint.ts`, the pre-44e2671 one in
 * the corpus — not from running the code and writing down what came out.
 */
const FIXED_KEY = "0|div|";
const DEFECT_KEY = "0|div||2|";

async function runPrinter(command: string[], mutation?: string): Promise<{ stdout: string; exitCode: number }> {
  const child = Bun.spawn(command, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, [MUTATION_ENV]: mutation ?? "" },
  });
  const [stdout, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout: stdout.trim(), exitCode };
}

/**
 * The whole point of #82 is that the defect never reaches the disk, so the only honest test is one
 * that asks a real child process what it loaded. A unit test of the transform cannot distinguish
 * "the hook rewrote the module" from "the hook was never registered".
 */
describe("the mutation hooks reach a real runtime", () => {
  const bun = process.execPath;

  test("bun --preload leaves the module alone with no mutation selected", async () => {
    const { stdout, exitCode } = await runPrinter([bun, "run", "--preload", "./scripts/mutation-preload.ts", PRINTER]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe(FIXED_KEY);
  });

  test("bun --preload applies the selected defect in memory", async () => {
    const { stdout, exitCode } = await runPrinter(
      [bun, "run", "--preload", "./scripts/mutation-preload.ts", PRINTER],
      DEFECT,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toBe(DEFECT_KEY);
  });

  test("node --import applies the same defect, so both runtimes agree", async () => {
    const { stdout, exitCode } = await runPrinter(
      ["node", "--import", "./scripts/mutation-node-hook.ts", resolve(repoRoot, PRINTER)],
      DEFECT,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toBe(DEFECT_KEY);
  });

  test("the file on disk is never written", async () => {
    const source = await Bun.file(resolve(repoRoot, "src/identity/fingerprint.ts")).text();

    await runPrinter([bun, "run", "--preload", "./scripts/mutation-preload.ts", PRINTER], DEFECT);

    expect(await Bun.file(resolve(repoRoot, "src/identity/fingerprint.ts")).text()).toBe(source);
  });
});
