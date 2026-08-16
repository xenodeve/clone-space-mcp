/**
 * The equivalence gate as one command (#171, acceptance criterion 5). **Node only** (ADR 0001).
 *
 *     node scripts/equivalence.ts <url> [outDir] [--allow-private-network]
 *     bun run equivalence <url> [outDir]
 *
 * Capture the live page, replay the archive, diff the two digests, print the verdict beside its
 * coverage vector, and **exit non-zero on an unexplained residual**.
 *
 * **Why this did not exist until now, which is the point.** `src/equivalence/` has been reachable
 * from `bun test` and from the mutation corpus since the slice landed, and from nowhere else —
 * every verdict this repo has quoted about a real site came from a throwaway probe under the
 * gitignored `archives/`. A gate nobody but its author can run is a gate whose results nobody can
 * check.
 *
 * The pure parts are exported and tested under Bun; only `main` touches a browser. That split is
 * the same one `scripts/metamorphic-cli.ts` uses, and it exists because the half a caller actually
 * scripts against — what the command says and what it exits with — should not need Chromium to
 * verify.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EquivalenceReport } from "../src/equivalence/run.ts";

export interface EquivalenceArgs {
  url: string;
  /** Base directory. `main` makes a fresh run directory under it — `captureHar` refuses to publish
   *  into one that already exists, so a fixed path would fail on the second invocation. */
  outDir: string;
  /**
   * Let the capture publish an archive served from a private address (#162). **Absent means
   * refuse**, matching `captureHar`.
   *
   * The one flag, and it exists so the exit-code wiring can be covered at all: this repo's fixture
   * is loopback, so without it the only surface that could exercise the command end to end is a
   * live site — which is exactly how a wiring defect stays uncovered while every pure function
   * beneath it is green.
   */
  allowPrivateNetwork: boolean;
}

const DEFAULT_OUT_DIR = "archives/equivalence";
const PRIVATE_NETWORK_FLAG = "--allow-private-network";

/**
 * Two positional arguments and one flag, which is the whole surface.
 *
 * The URL is validated **here** rather than left to `captureHar`, because the failure a caller
 * actually hits is a mistyped flag in first position, and finding that out after a browser launch
 * and a live page load is minutes later than it needs to be.
 */
export function parseEquivalenceArgs(argv: readonly string[]): EquivalenceArgs {
  const allowPrivateNetwork = argv.includes(PRIVATE_NETWORK_FLAG);
  // An unknown `--flag` is refused rather than treated as a path. A delegated review named the
  // case that makes this worth the four lines: `--allow-private-networks` — one letter off — was
  // silently accepted as the **output directory**, leaving private networking off. The caller then
  // gets the refusal they explicitly asked not to have, with nothing saying their argument was
  // dropped.
  const unknownFlag = argv.find(
    (argument) => argument.startsWith("--") && argument !== PRIVATE_NETWORK_FLAG,
  );
  if (unknownFlag !== undefined) {
    throw new Error(`equivalence: unknown flag ${unknownFlag} — only ${PRIVATE_NETWORK_FLAG} exists`);
  }
  const positional = argv.filter((argument) => argument !== PRIVATE_NETWORK_FLAG);
  if (positional.length > 2) {
    throw new Error(
      `equivalence: unexpected argument ${positional[2]} — usage is <url> [outDir] [${PRIVATE_NETWORK_FLAG}]`,
    );
  }
  const [url, outDir] = positional;
  if (url === undefined || url.length === 0) {
    throw new Error("equivalence: needs a url — node scripts/equivalence.ts <url> [outDir]");
  }
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    throw new Error(`equivalence: ${url} is not an http(s) url`);
  }
  return { url, outDir: outDir ?? DEFAULT_OUT_DIR, allowPrivateNetwork };
}

/**
 * Three outcomes, three codes, because they call for opposite next actions.
 *
 * `0` PASS · `1` FAIL, a residual nothing explains — a difference to chase · `2` INCOMPLETE, a run
 * that could not compare — a run to repeat.
 *
 * **`INCOMPLETE` is emphatically not `0`.** The issue's own words: *"A residual is empty or the
 * verdict is not `PASS` — no partial credit."* A caller reading zero would be told the clone agreed
 * when nothing was proven equal. `bun run ci:lock` answers in three states for the same reason.
 */
export function equivalenceExitCode(verdict: EquivalenceReport["verdict"]): number {
  if (verdict === "PASS") return 0;
  return verdict === "FAIL" ? 1 : 2;
}

/**
 * The run itself failed — it never produced a verdict at all.
 *
 * **Distinct from all three verdict codes, and it was not.** `main` is awaited at module top level,
 * so before a delegated review caught it any exception — a capture refusing a private address, a
 * network failure, a mistyped argument — rejected that await and Node exited **1**, which this
 * command documents as *"a residual to chase"*. A caller would have gone looking for a difference
 * that was never measured.
 */
export const RUN_FAILED_EXIT = 3;

/**
 * `coverageOf` returns **whole percentages, already rounded** (`src/equivalence/classify.ts:242`).
 * Multiplying again printed `10000%` on the first real run — the tests had not caught it, because
 * the fixture's expected value was assumed rather than read from the function that produces it.
 */
function percent(coverage: number): string {
  return `${coverage}%`;
}

/**
 * What the command prints.
 *
 * **Coverage is one line per dimension and never a total.** A single number averages away exactly
 * the dimension that is weak — a run that scrolled everything and drove no interaction is a small
 * claim correctly reported, and an aggregate would dress it as a large one.
 *
 * `unstable` and `baselinePasses` are printed even when they are empty or zero, because both are
 * the difference between a verdict and a verdict *someone can check*: a field that carried no
 * signal, and how much evidence the control had on the side that moves (#187).
 */
export function formatEquivalenceReport(report: EquivalenceReport): string {
  const lines = [
    `equivalence ${report.verdict}  ${report.url}`,
    `archive     ${report.archive}`,
    "",
    `residual (${report.residual.length})   ${report.residual.join("  ")}`.trimEnd(),
    `unstable (${report.unstable.length})   ${report.unstable.join("  ")}`.trimEnd(),
    `baseline    live ${report.baselinePasses.live}  replay ${report.baselinePasses.replay}`,
    "",
    "coverage",
  ];
  const width = Math.max(0, ...Object.keys(report.coverage).map((key) => key.length));
  for (const [dimension, ratio] of Object.entries(report.coverage)) {
    lines.push(`  ${dimension.padEnd(width)}  ${percent(ratio).padStart(4)}`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`equivalence: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = RUN_FAILED_EXIT;
  }
}

async function run(): Promise<void> {
  const { mkdtempSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { chromium } = await import("playwright");
  const { runEquivalence } = await import("../src/equivalence/run.ts");

  const args = parseEquivalenceArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });
  // A fresh directory per run. `captureHar` refuses to publish into one that already exists, and a
  // fixed path would therefore work exactly once — a failure mode this repo has already paid for
  // once, when a mutation run left a published archive behind and broke the next honest verify.
  const runDir = mkdtempSync(join(args.outDir, "run-"));

  const browser = await chromium.launch();
  try {
    const report = await runEquivalence({
      url: args.url,
      outDir: join(runDir, "archive"),
      browser: browser as never,
      allowPrivateNetwork: args.allowPrivateNetwork,
    });
    console.log(formatEquivalenceReport(report));
    process.exitCode = equivalenceExitCode(report.verdict);
  } finally {
    await browser.close();
  }
}

// `import.meta.main` is Bun's and this runs under Node (ADR 0001), so the entry check compares
// **resolved paths**, not a filename suffix. A delegated review named both directions the suffix
// got wrong: any other `equivalence.ts` anywhere would have run `main` on import, and a differently
// cased or symlinked path to this one would not have.
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
