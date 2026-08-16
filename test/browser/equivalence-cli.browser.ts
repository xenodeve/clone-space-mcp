import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";

/**
 * Only the loader flags are forwarded, not all of `process.execArgv`.
 *
 * The corpus applies its defect in memory to modules the **test process** loads (#82), and this
 * spawns the command, so without carrying `--import` across the boundary the entry reports
 * `MUTATION NOT APPLIED` — measured, and that is not `SURVIVED`. Forwarding *everything* was the
 * first version and a delegated review named the cost: `--inspect` would make the child fight the
 * parent for a debugger port, so the child would stop resembling a real invocation in a way that
 * has nothing to do with what is under test.
 */
function loaderArgs(): string[] {
  const kept: string[] = [];
  for (let i = 0; i < process.execArgv.length; i += 1) {
    const argument = process.execArgv[i]!;
    if (!argument.startsWith("--import")) continue;
    kept.push(argument);
    if (argument === "--import" && process.execArgv[i + 1] !== undefined) {
      kept.push(process.execArgv[i + 1]!);
      i += 1;
    }
  }
  return kept;
}

interface Run {
  status: number;
  stdout: string;
}

function runCommand(args: readonly string[]): Run {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [...loaderArgs(), scriptPath, ...args], {
        encoding: "utf8",
        timeout: 300_000,
      }),
    };
  } catch (error) {
    // `execFileSync` throws on a non-zero exit, which is the outcome under test rather than a
    // failure of the test. The thrown object carries both the code and the output.
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/**
 * #171 criterion 5 — *"One command runs capture → replay → diff on a URL and **exits non-zero** on
 * an unexplained residual."*
 *
 * This spawns the command as a command. Everything beneath it — `equivalenceExitCode`,
 * `formatEquivalenceReport`, `parseEquivalenceArgs` — is covered under Bun without a browser, and
 * **none of that reaches the one line that assigns `process.exitCode`**. A gate whose decision is
 * correct and whose exit code is not wired is a gate that reports success to every caller, and this
 * repo has already paid for that shape once this month: three candidate fixes on #187 tested pure
 * functions and left the wiring untested, which is the exact criticism recorded in that issue.
 *
 * **The target is `/measure-and-freeze.html?at=t100`, chosen because it diverges deterministically.**
 * Measured 12/12 on this machine — the page freezes a measurement taken after an image that the live
 * origin delays 300 ms and a HAR serves in ~10 ms, so live and replay lay out to different heights
 * every time. A fixture that merely *usually* differs would make this test a coin flip and its
 * failures unreadable.
 */

const scriptPath = fileURLToPath(new URL("../../scripts/equivalence.ts", import.meta.url));

let servers: FixtureServers;
let tempDir: string;

before(async () => {
  servers = await startFixtureServers();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-equivalence-cli-"));
});

after(async () => {
  await servers?.stop();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test("the command exits non-zero and names the residual when live and replay disagree", () => {
  const url = new URL("/measure-and-freeze.html?at=t100", servers.primary.url).href;
  const { status, stdout } = runCommand([url, tempDir, "--allow-private-network"]);

  assert.equal(status, 1, `expected exit 1 for a residual, got ${status}
${stdout}`);
  assert.match(stdout, /equivalence FAIL/, stdout);
  assert.match(stdout, /layout\.scrollHeight/, stdout);
});

/**
 * The other side of the same command, and it is not optional. A reviewer named the gap precisely:
 * with only the failing case covered, a `main` that printed `equivalence FAIL … layout.scrollHeight`
 * and exited 1 unconditionally would pass — the test would be asserting its own fixture rather than
 * the command's behaviour.
 *
 * `?at=module` measures at end of parse, before the image on **both** sides, so the two agree.
 */
test("the command exits zero when live and replay agree", () => {
  const url = new URL("/measure-and-freeze.html?at=module", servers.primary.url).href;
  const { status, stdout } = runCommand([url, tempDir, "--allow-private-network"]);

  assert.equal(status, 0, `expected exit 0 when the two sides agree, got ${status}
${stdout}`);
  assert.match(stdout, /equivalence PASS/, stdout);
  assert.match(stdout, /residual \(0\)/, stdout);
  // Free half of the perturbation contract: without the flag the control did not run, and the
  // report must not carry a line implying it did.
  assert.doesNotMatch(stdout, /perturbed/, stdout);
});

/**
 * #171's third mode through the command. The assertion is that the control **ran and reported**,
 * not which fields it named — what the hooks move is a property of the page under test, and
 * pinning it here would make an unrelated fixture edit look like a regression in the control.
 *
 * Measured on `https://www.chaingpt.org/` the same day: `perturbed (0)`, with `dom.elements` and
 * `dom.elements.afterInteraction` in `unstable` — the control has not yet found a perturbation that
 * survives comparison against every plain pass. An earlier reading of `perturbed (2)` on that site
 * was withdrawn: it compared against one plain pass and blamed the hooks for the baseline's noise.
 */
test("--measure-perturbation drives the control and reports what the hooks moved", () => {
  const url = new URL("/measure-and-freeze.html?at=module", servers.primary.url).href;
  const { status, stdout } = runCommand([
    url,
    tempDir,
    "--allow-private-network",
    "--measure-perturbation",
  ]);

  assert.match(stdout, /perturbed \(\d+\)/, stdout);
  assert.ok(status === 0 || status === 1 || status === 2, `unexpected exit ${status}
${stdout}`);
});

/**
 * A run that never produced a verdict must not borrow one of the verdict codes. This case costs no
 * browser at all — the argument is refused before anything launches — which is the point: the
 * cheapest path through the command is the one most likely to go uncovered.
 */
test("a run that fails before a verdict exits 3, not 1", () => {
  const { status, stdout } = runCommand(["--allow-private-networks", "https://example.com/"]);

  assert.equal(status, 3, `expected exit 3 for a run that never compared, got ${status}
${stdout}`);
  assert.match(stdout, /unknown flag/, stdout);
});
