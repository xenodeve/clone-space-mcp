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
  for (const url of ["http://127.0.0.1:8080/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/"]) {
    await expect(
      capturePage({ url, outDir: join(tmpdir(), "never-created"), resolveHost: async () => ["93.184.216.34"] }, launcher() as never),
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
