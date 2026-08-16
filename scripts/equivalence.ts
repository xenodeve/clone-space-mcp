/**
 * The equivalence gate as one command (#171, acceptance criterion 5). **Node only** (ADR 0001).
 *
 *     node scripts/equivalence.ts <url> [outDir] [--allow-private-network] [--measure-perturbation]
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
  /**
   * Drive the live page one extra time **with the observation layer installed** and report which
   * fields the hooks moved (#171's third mode).
   *
   * Off by default: it costs a whole extra live drive, and it changes no verdict — nothing in the
   * comparison this command runs today carries hooks, so the answer is about whether instrumenting
   * both sides *would* be measuring the page or the instrument.
   */
  measurePerturbation: boolean;
}

const DEFAULT_OUT_DIR = "archives/equivalence";
const PRIVATE_NETWORK_FLAG = "--allow-private-network";
const PERTURBATION_FLAG = "--measure-perturbation";
/** Every flag this command knows. Anything else starting with `--` is refused by name rather than
 *  silently becoming a path — adding an option means adding it here, not loosening the check. */
const FLAGS: readonly string[] = [PRIVATE_NETWORK_FLAG, PERTURBATION_FLAG];

/**
 * Two positional arguments and one flag, which is the whole surface.
 *
 * The URL is validated **here** rather than left to `captureHar`, because the failure a caller
 * actually hits is a mistyped flag in first position, and finding that out after a browser launch
 * and a live page load is minutes later than it needs to be.
 */
export function parseEquivalenceArgs(argv: readonly string[]): EquivalenceArgs {
  const allowPrivateNetwork = argv.includes(PRIVATE_NETWORK_FLAG);
  const measurePerturbation = argv.includes(PERTURBATION_FLAG);
  // An unknown `--flag` is refused rather than treated as a path. A delegated review named the
  // case that makes this worth the four lines: `--allow-private-networks` — one letter off — was
  // silently accepted as the **output directory**, leaving private networking off. The caller then
  // gets the refusal they explicitly asked not to have, with nothing saying their argument was
  // dropped.
  const unknownFlag = argv.find(
    (argument) => argument.startsWith("--") && !FLAGS.includes(argument),
  );
  if (unknownFlag !== undefined) {
    throw new Error(`equivalence: unknown flag ${unknownFlag} — known flags are ${FLAGS.join(", ")}`);
  }
  const positional = argv.filter((argument) => !FLAGS.includes(argument));
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
  return { url, outDir: outDir ?? DEFAULT_OUT_DIR, allowPrivateNetwork, measurePerturbation };
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
 * One line per residual field, carrying **what each side measured**.
 *
 * A `FAIL` that names a field and not its two values sends the reader to dig through an archive for
 * a number the run already had in hand — measured on `www.chaingpt.org`, where the report said
 * `residual (1) network.origins` and nothing about what the two sides counted.
 *
 * A residual field with no entry in `fields` is still printed. Losing it because its values are
 * missing would be worse than losing the values: the verdict would name a count it does not explain.
 */
function residualLines(report: EquivalenceReport): string[] {
  return report.residual.map((field) => {
    const detail = report.fields.find((entry) => entry.field === field);
    if (detail === undefined) return `  ${field}`;
    return `  ${field}  live ${String(detail.live)}  replay ${String(detail.replay)}`;
  });
}

/**
 * The perturbation line, or **nothing at all**.
 *
 * `perturbed (0)` says the control ran and the hooks moved nothing; silence says nobody drove it.
 * Collapsing the two would publish a measurement that was never taken — the same failure
 * `unobserved` exists to keep out of `equal`, and the same one `baselinePasses` avoids by reporting
 * a `0` rather than an absent field.
 */
function perturbationLine(perturbed: readonly string[] | undefined): string[] {
  if (perturbed === undefined) return [];
  return [`perturbed (${perturbed.length})  ${perturbed.join("  ")}`.trimEnd()];
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
    `residual (${report.residual.length})`,
    ...residualLines(report),
    `unstable (${report.unstable.length})   ${report.unstable.join("  ")}`.trimEnd(),
    `baseline    live ${report.baselinePasses.live}  replay ${report.baselinePasses.replay}`,
    ...perturbationLine(report.perturbed),
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
      measurePerturbation: args.measurePerturbation,
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
