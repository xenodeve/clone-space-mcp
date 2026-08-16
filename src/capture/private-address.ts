/**
 * #162: which addresses a published archive may have been served from.
 *
 * Every check that came before this one is **name-based and time-shifted** — it resolves a
 * hostname at a moment that is not the moment the socket was opened. Three ways private content
 * still reached a published archive: a page-initiated subresource (`fetch("http://169.254.169.254/…")`)
 * that no origin policy covers, DNS rebinding between the pre-flight lookup and the navigation,
 * and a same-host rebind whose origin never differs from the requested one so nothing asks.
 *
 * A HAR entry's `serverIPAddress` is a fact about the connection that actually happened, so
 * checking it at publish covers all three with one rule. It does not stop the fetch; it stops the
 * archive — the same shape as this project's other guarantees, which are enforced at publish
 * against the bytes that were recorded.
 *
 * **Playwright writes IPv6 bracketed.** Measured on a fixture capture: 11 of 12 entries carried
 * `"[::1]"` and one carried `"::1"`, in the same HAR. `isIP("[::1]")` is 0, so a classifier that
 * does not strip the brackets first reports the loopback address as public.
 */

import { isIP } from "node:net";

export type PrivateAddressKind =
  | "loopback"
  | "unspecified"
  | "link-local"
  | "unique-local"
  | "private";

/**
 * Ranges that are not "somewhere on the internet": the host's own position, not the caller's.
 *
 * This is the single copy of the range table. `assertReachableUrl` in
 * `src/serve/tools/capture-guards.ts` classifies the pre-flight DNS answer with the same function
 * — a second table written beside this one would drift the moment either is corrected.
 */
export function privateAddressKind(address: string | undefined): PrivateAddressKind | undefined {
  if (address === undefined || address === "") return undefined;
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 6) {
    if (normalized === "::1") return "loopback";
    if (normalized === "::") return "unspecified";
    if (normalized.startsWith("fe80:")) return "link-local";
    if (/^f[cd]/.test(normalized)) return "unique-local";
    // IPv4 carried inside IPv6, e.g. ::ffff:127.0.0.1
    const mapped = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateAddressKind(mapped[1]!) : undefined;
  }
  if (family !== 4) return undefined;

  const [a, b] = normalized.split(".").map(Number) as [number, number, number, number];
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 0) return "unspecified";
  if (a === 169 && b === 254) return "link-local";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  return undefined;
}

/**
 * The part of a HAR entry this rule reads, typed as loosely as `HarRequestEntry` because the
 * input is untrusted JSON: a malformed entry must not make the guard throw before it has decided.
 */
export interface AddressedHarEntry {
  request?: { url?: unknown };
  serverIPAddress?: unknown;
}

export interface PrivateNetworkEntry {
  url: string;
  address: string;
  kind: PrivateAddressKind;
}

/**
 * Every entry the archive records as served from a private address.
 *
 * An entry with no recorded address is **passed**. A response from the HTTP cache or a
 * ServiceWorker opened no connection, so absence is not evidence of a private one, and refusing on
 * absence would refuse archives that are fine.
 */
export function privateNetworkEntries(
  entries: readonly AddressedHarEntry[],
): PrivateNetworkEntry[] {
  const found: PrivateNetworkEntry[] = [];
  for (const entry of entries) {
    const address = entry.serverIPAddress;
    if (typeof address !== "string") continue;
    const kind = privateAddressKind(address);
    if (kind === undefined) continue;
    const url = entry.request?.url;
    found.push({ url: typeof url === "string" ? url : "", address, kind });
  }
  return found;
}
