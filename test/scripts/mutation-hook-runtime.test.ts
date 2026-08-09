import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  APPLIED_TOKEN,
  BUN_MUTATION_FLAGS,
  MUTATION_ENV,
  NODE_MUTATION_FLAGS,
} from "../../scripts/mutation-hook.ts";
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

async function runCommand(
  command: string[],
  mutation?: string,
): Promise<{ stdout: string; output: string; exitCode: number }> {
  const child = Bun.spawn(command, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, [MUTATION_ENV]: mutation ?? "" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout: stdout.trim(), output: `${stdout}\n${stderr}`, exitCode };
}

/** The printer prints the key on its own line; the hook prints its token on another. */
function printedKey(stdout: string): string {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && line !== APPLIED_TOKEN)
    .join("\n");
}

/**
 * The whole point of #82 is that the defect never reaches the disk, so the only honest test is one
 * that asks a real child process what it loaded. A unit test of the transform cannot distinguish
 * "the hook rewrote the module" from "the hook was never registered".
 */
describe("the mutation hooks reach a real runtime", () => {
  const bun = process.execPath;

  test("bun --preload leaves the module alone with no mutation selected", async () => {
    const { stdout, exitCode } = await runCommand([bun, "run", "--preload", "./scripts/mutation-preload.ts", PRINTER]);

    expect(exitCode).toBe(0);
    expect(printedKey(stdout)).toBe(FIXED_KEY);
  });

  test("bun --preload applies the selected defect in memory", async () => {
    const { stdout, exitCode } = await runCommand(
      [bun, "run", "--preload", "./scripts/mutation-preload.ts", PRINTER],
      DEFECT,
    );

    expect(exitCode).toBe(0);
    expect(printedKey(stdout)).toBe(DEFECT_KEY);
  });

  test("node --import applies the same defect, so both runtimes agree", async () => {
    const { stdout, exitCode } = await runCommand(
      ["node", "--import", "./scripts/mutation-node-hook.ts", resolve(repoRoot, PRINTER)],
      DEFECT,
    );

    expect(exitCode).toBe(0);
    expect(printedKey(stdout)).toBe(DEFECT_KEY);
  });

  /**
   * The two tests below pin the **exact commands `scripts/mutate.ts` runs**, via the shared flag
   * constants, rather than a convenient approximation of them. An earlier version of this file
   * exercised `bun run` and a bare `node <file>` while the runner used `bun test --preload` and
   * `node --test --import`, so a hook that failed to register under either real command would
   * have left this suite green while every mutation reported SURVIVED.
   */
  test("bun test --preload applies the defect, which is the command the runner uses", async () => {
    const { output, exitCode } = await runCommand(
      [bun, "test", ...BUN_MUTATION_FLAGS, "test/identity/reconcile.test.ts"],
      DEFECT,
    );

    expect(output).toContain(APPLIED_TOKEN);
    expect(exitCode).not.toBe(0);
    // The test #20 was filed for, failing because the defect is back.
    expect(output).toContain("one unrelated node inserted above does not lose an element");
  });

  /**
   * `node --test` spawns one child per file. `--import` is given to the runner, so the question
   * this pins is whether it reaches those children — measured here rather than asserted in a
   * comment, because a hook that silently fails to register turns all five browser corpus entries
   * into false greens.
   */
  test("node --test --import reaches every per-file child it spawns", async () => {
    const { output, exitCode } = await runCommand(
      [
        "node",
        ...NODE_MUTATION_FLAGS,
        "--test",
        "test/scripts/fixtures/first.nodeprobe.ts",
        "test/scripts/fixtures/second.nodeprobe.ts",
      ],
      DEFECT,
    );

    // One token and one passing test name per child prove the hook reached both files without
    // depending on Node's default reporter format.
    expect(output.split(APPLIED_TOKEN).length - 1).toBe(2);
    expect(output).toContain("first child sees the mutated fingerprint key");
    expect(output).toContain("second child sees the mutated fingerprint key");
    expect(exitCode).toBe(0);
  });

  test("the file on disk is never written", async () => {
    const source = await Bun.file(resolve(repoRoot, "src/identity/fingerprint.ts")).text();

    await runCommand([bun, "run", "--preload", "./scripts/mutation-preload.ts", PRINTER], DEFECT);

    expect(await Bun.file(resolve(repoRoot, "src/identity/fingerprint.ts")).text()).toBe(source);
  });
});
