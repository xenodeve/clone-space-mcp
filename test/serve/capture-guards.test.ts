import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturePage } from "../../src/serve/tools/capture-page.ts";
import { fakeBrowser } from "./fixture-archive.ts";

function launcher() {
  return { launch: async () => ({ ...fakeBrowser({ log: { entries: [] } }), async close() {} }) };
}

test("capturePage refuses an outDir that already exists", async () => {
  // captureHar tolerates an existing empty directory. Reached through a tool an agent drives, that
  // is a destructive primitive: an empty user profile, an empty mount point, an empty repo folder
  // are all "empty directories". The tool refuses the whole class rather than reasoning about it.
  const existing = mkdtempSync(join(tmpdir(), "clone-space-existing-"));
  try {
    await expect(
      capturePage({ url: "https://example.com", outDir: existing, resolveHost: async () => ["93.184.216.34"] }, launcher() as never),
    ).rejects.toThrow(/already exists/);
  } finally {
    rmSync(existing, { recursive: true, force: true });
  }
});

test("capturePage refuses a UNC path", async () => {
  await expect(
    capturePage({ url: "https://example.com", outDir: "\\\\server\\share\\archive" }, launcher() as never),
  ).rejects.toThrow(/UNC/);
});

test("capturePage refuses a URL that resolves to a private or loopback address", async () => {
  // The host's network position is not the caller's. Cloud metadata, an intranet host and a
  // developer's own services are all reachable over plain http from wherever this runs.
  // The outDir is unique per run rather than a fixed `never-created` under the temp directory.
  // With this entry's guard removed, `bun run mutate` lets the capture through and it *publishes*
  // there — after which the honest run fails on "already exists" and blames the wrong rule. A
  // corpus entry that makes the next ordinary run red is a mechanism sabotaging its own suite.
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-unreachable-")), "never-created");
  for (const url of ["http://127.0.0.1:8080/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/"]) {
    await expect(
      capturePage({ url, outDir, resolveHost: async () => ["93.184.216.34"] }, launcher() as never),
    ).rejects.toThrow(/private|loopback|link-local/i);
  }
});

test("capturePage reaches a private address only when the caller says so explicitly", async () => {
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-private-")), "archive");
  try {
    // The fixture site this repo tests against is on localhost, so the escape hatch has to exist.
    // Making it explicit is the point: the default denies, and reaching inside is a stated choice.
    //
    // It succeeds, and that is the assertion: the address check let a loopback URL through because
    // the caller said so, and nothing downstream second-guessed it.
    //
    // This used to assert that the call *failed* with `/cross-origin redirect/` — using the next
    // stage's refusal as a proxy for "the guard let it through". #157 replaced that refusal, and
    // a proxy assertion breaks whenever the stage it borrowed changes while saying nothing more
    // about the guard it covers. The outcome the test is actually about is this one.
    const result = await capturePage(
      { url: "http://127.0.0.1:1/", outDir, allowPrivateNetwork: true },
      launcher() as never,
    );
    expect(result.archive).toBe(outDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("capturePage refuses when a redirect lands on a private address", async () => {
  // #157. The pre-flight check above only sees the URL the caller asked for. Until this, the
  // pairing that covered the redirect leg was `collectEnvironment` refusing any cross-origin
  // final origin outright — which also made every apex-to-www site unarchivable. With that
  // refusal replaced, the address policy has to reach the origin the page actually landed on, or
  // a public URL redirecting to cloud metadata is archived to disk instead of thrown away.
  //
  // The fake page always reports `https://example.com` as its origin, so asking for a different
  // host makes this a redirect; resolving that host to a link-local address makes it the
  // dangerous kind.
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-redirect-")), "archive");
  try {
    await expect(
      capturePage(
        {
          url: "https://not-example.test/",
          outDir,
          resolveHost: async (host) =>
            host === "example.com" ? ["169.254.169.254"] : ["93.184.216.34"],
        },
        launcher() as never,
      ),
    ).rejects.toThrow(/link-local/i);
    expect(existsSync(outDir)).toBe(false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("capturePage refuses an archive whose connections went to a private address", async () => {
  // #162. The pre-flight resolver answers public and the recording says the connection went to
  // link-local — DNS rebinding between the lookup and the navigation, and the same-host rebind
  // that never differs from `primaryOrigin` so the origin policy never runs, both land here.
  //
  // No number of extra hostname lookups turns a name-based check into this one: `serverIPAddress`
  // is a fact about the connection that happened.
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-rebind-")), "archive");
  const rebound = {
    log: {
      entries: [
        {
          request: { url: "https://rebound.example/", method: "GET" },
          response: { status: 200 },
          serverIPAddress: "169.254.169.254",
        },
      ],
    },
  };
  try {
    await expect(
      capturePage(
        { url: "https://rebound.example/", outDir, resolveHost: async () => ["93.184.216.34"] },
        { launch: async () => ({ ...fakeBrowser(rebound), async close() {} }) } as never,
      ),
    ).rejects.toThrow(/private address/);
    expect(existsSync(outDir)).toBe(false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("capturePage archives a private address when the caller asked for one", async () => {
  // The opt-in has to reach the archive check too, or `allowPrivateNetwork: true` would pass the
  // two name-based checks and then be refused by the third — which is how a flag stops meaning
  // what it says.
  const outDir = join(mkdtempSync(join(tmpdir(), "clone-space-rebind-allowed-")), "archive");
  const loopback = {
    log: {
      entries: [
        {
          request: { url: "http://127.0.0.1:8080/", method: "GET" },
          response: { status: 200 },
          serverIPAddress: "127.0.0.1",
        },
      ],
    },
  };
  try {
    const result = await capturePage(
      { url: "http://127.0.0.1:8080/", outDir, allowPrivateNetwork: true },
      { launch: async () => ({ ...fakeBrowser(loopback), async close() {} }) } as never,
    );
    expect(result.archive).toBe(outDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
