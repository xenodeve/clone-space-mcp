/**
 * Starts the fixture as a Bun child process and waits for it to announce its origins.
 *
 * Node needs this because the fixture server uses `Bun.serve` and `Bun.build`, while
 * anything driving a browser has to run under Node (ADR 0001). Extracted here rather than
 * copied because both the spike harness and the browser tests need it, and two copies of a
 * process-lifecycle helper drift in exactly the way that leaks ports.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface FixtureOrigin {
  /** Absolute base URL, with a trailing slash. */
  url: string;
  port: number;
}

export interface FixtureServers {
  primary: FixtureOrigin;
  crossOrigin: FixtureOrigin;
  capability: FixtureOrigin;
  stop(): Promise<void>;
}

/** Same resolution order as scripts/verify.sh: PATH first, then bun's default install. */
function resolveBun(): string {
  for (const candidate of [join(homedir(), ".bun/bin/bun.exe"), join(homedir(), ".bun/bin/bun")]) {
    if (existsSync(candidate)) return candidate;
  }
  return "bun";
}

export async function startFixtureServers(): Promise<FixtureServers> {
  // stderr is inherited so a fixture crash is visible in this process's output rather than
  // swallowed; that makes stdio typed as [Writable, Readable, null].
  const child = spawn(resolveBun(), ["run", join(REPO, "scripts/fixture-serve.ts")], {
    cwd: REPO,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const origins = await new Promise<Omit<FixtureServers, "stop">>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("fixture server did not announce its origins within 30s")),
      30_000,
    );
    createInterface({ input: child.stdout }).once("line", (line) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(line) as Omit<FixtureServers, "stop">);
      } catch {
        reject(new Error(`fixture server printed something that is not JSON: ${line}`));
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`fixture server exited early (code ${code})`)));
  });

  return {
    ...origins,
    async stop() {
      child.stdin.end();
      child.kill();
    },
  };
}
