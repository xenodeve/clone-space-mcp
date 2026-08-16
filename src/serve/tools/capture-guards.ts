/**
 * What `capture_page` is allowed to touch (#127, applied in #124).
 *
 * These are pure decisions about the caller's input, kept out of the tool so they can be tested
 * without a browser and read without following the capture path. Both rules **tighten** what the
 * underlying `captureHar` would accept; neither loosens anything, which is what makes them safe to
 * adopt without deciding a wider policy first.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { privateAddressKind } from "../../capture/private-address.ts";

/**
 * Resolve the URL's host and refuse an address the caller has no business reaching through this
 * process. Deny by default, with an explicit opt-in — the same shape as the storage allowlist
 * §6.2 already uses, rather than a new stance.
 *
 * This is a pre-flight check and cannot by itself stop a redirect into a private network. The
 * other half of the pair is `capture_page` passing this same function to `captureHar` as
 * `assertFinalOrigin`, so the policy is applied again to wherever the page landed (#157).
 *
 * That used to be covered incidentally, by `collectEnvironment` refusing to publish any capture
 * whose final origin differed from the requested one. It bounded the redirect leg and also made
 * every apex-to-www site unarchivable, which is why it was replaced by something that checks the
 * address rather than the mere fact of a redirect.
 *
 * **Neither hop of that pair can close #162, and the third check is where it is closed.** Both
 * checks here are name-based and time-shifted: they resolve a hostname at a moment that is not the
 * moment the socket opened, so a page-initiated `fetch("http://169.254.169.254/…")`, a name that
 * rebinds between the pre-flight lookup and the navigation, and a same-host rebind whose origin
 * never differs from the requested one all pass. The property actually wanted is about the address
 * a *connection* went to.
 *
 * So `captureHar` **refuses to publish** an archive holding an entry whose `serverIPAddress` is
 * private (`src/capture/private-address.ts`), unless `allowPrivateNetwork` says otherwise. It does
 * not stop the fetch — it stops the archive, which is where this project's other guarantees are
 * enforced and is the only form that covers a subresource the page asked for itself. The range
 * table lives in that module and this file classifies its DNS answer with the same function; a
 * second copy beside it would drift the moment either is corrected.
 */
/** Resolve a hostname to addresses. Injected so a test does not depend on live DNS. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const resolveWithDns: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((record) => record.address);

export async function assertReachableUrl(
  rawUrl: string,
  allowPrivateNetwork: boolean,
  resolve: HostResolver = resolveWithDns,
): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`capture_page: unsupported protocol ${url.protocol}`);
  }
  if (allowPrivateNetwork) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  // A resolver failure is not a private address: say what happened rather than surfacing a raw
  // EAI_AGAIN, which reads as a bug in this tool rather than a name that could not be looked up.
  let addresses: string[];
  try {
    addresses = isIP(host) !== 0 ? [host] : await resolve(host);
  } catch (error) {
    throw new Error(
      `capture_page: cannot resolve ${url.hostname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const address of addresses) {
    const kind = privateAddressKind(address);
    if (kind !== undefined) {
      throw new Error(
        `capture_page: ${url.hostname} resolves to a ${kind} address (${address}). Pass allowPrivateNetwork to reach it deliberately.`,
      );
    }
  }
  return url;
}

/**
 * Refuse an output path this tool should not create. `captureHar` accepts an existing **empty**
 * directory, which is reasonable for a library call a developer wrote. Driven by an agent it is a
 * destructive primitive, because an empty user profile, an empty mount point and an empty repo
 * folder are all empty directories. Refusing every existing path removes the class rather than
 * reasoning about which ones are safe.
 */
export function assertWritableOutDir(outDir: string, exists: (path: string) => boolean): string {
  if (/^[\\/]{2}/.test(outDir)) {
    throw new Error(`capture_page: refusing a UNC path: ${outDir}`);
  }
  const resolved = resolve(outDir);
  if (exists(resolved)) {
    throw new Error(`capture_page: ${resolved} already exists — pass a path that does not yet exist`);
  }
  return resolved;
}
