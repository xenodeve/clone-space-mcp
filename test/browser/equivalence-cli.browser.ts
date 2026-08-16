import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";

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
  let status = 0;
  let stdout = "";
  try {
    // `process.execArgv` is forwarded so the child runs under whatever instrumentation this
    // process does. Without it the mutation corpus cannot reach this command at all: defects are
    // applied **in memory** to modules the test process loads (#82), and `scripts/equivalence.ts`
    // is only ever loaded by this child. Measured — the entry reported `MUTATION NOT APPLIED`,
    // which is not `SURVIVED` and measures nothing.
    stdout = execFileSync(
      process.execPath,
      [...process.execArgv, scriptPath, url, tempDir, "--allow-private-network"],
      { encoding: "utf8", timeout: 300_000 },
    );
  } catch (error) {
    // `execFileSync` throws on a non-zero exit, which is the outcome under test rather than a
    // failure of the test. The thrown object carries both the code and the output.
    const failure = error as { status?: number; stdout?: string };
    status = failure.status ?? -1;
    stdout = failure.stdout ?? "";
  }

  assert.equal(status, 1, `expected exit 1 for a residual, got ${status}\n${stdout}`);
  assert.match(stdout, /equivalence FAIL/, stdout);
  assert.match(stdout, /layout\.scrollHeight/, stdout);
});
