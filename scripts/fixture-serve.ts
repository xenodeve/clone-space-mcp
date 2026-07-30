/**
 * Runs the fixture's two origins as a standalone Bun process.
 *
 * It exists because the browser-driving code cannot currently run under Bun (see
 * `docs/reports/2026-07-30-cdp-spike.md`), while the fixture server uses `Bun.serve` and
 * `Bun.build`. Splitting them across two processes lets each run where it works, without
 * either being rewritten for a runtime decision that has not been made yet.
 *
 *   bun run fixture:serve
 *
 * Prints one line of JSON with the two origins, then stays up until stdin closes or the
 * process is signalled — so a parent can read the line, drive the browser, and kill it.
 */
import { startFixtureServers } from "../test/fixtures/serve.ts";

const servers = await startFixtureServers();

// Shape matters: a parent reads this line and indexes into it. Print the origins whole
// rather than flattening to bare strings, so adding a field later cannot silently change
// what `primary` means.
console.log(JSON.stringify({ primary: servers.primary, crossOrigin: servers.crossOrigin }));

async function shutdown(): Promise<void> {
  await servers.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// A parent that dies without signalling still closes our stdin; without this the fixture
// would outlive it and hold two ports.
process.stdin.on("close", shutdown);
process.stdin.on("end", shutdown);
process.stdin.resume();
