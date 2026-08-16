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
  | "private"
  | "shared";

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
    // fe80::/10 is the whole link-local block — first hextet fe80 through febf. Matching the
    // literal prefix "fe80:" leaves fe81:: to febf:: reported as somewhere on the internet.
    if (/^fe[89ab]/.test(normalized)) return "link-local";
    if (/^f[cd]/.test(normalized)) return "unique-local";
    // IPv4 carried inside IPv6. Both spellings of the same address have to classify the same way,
    // or the verdict depends on which form the reporter happened to print: ::ffff:7f00:1 is
    // ::ffff:127.0.0.1.
    const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1]!, 16);
      const low = Number.parseInt(mappedHex[2]!, 16);
      return privateAddressKind(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
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
  // 100.64.0.0/10, shared address space. Not routable on the public internet, so a response can
  // only come from it over a carrier network or an overlay the capture host is inside —
  // Tailscale assigns from this block, which puts it on developer machines rather than in theory.
  if (a === 100 && b >= 64 && b <= 127) return "shared";
  return undefined;
}

/**
 * The part of a HAR entry this rule reads, typed as loosely as `HarRequestEntry` because the
 * input is untrusted JSON: a malformed entry must not make the guard throw before it has decided.
 */
export interface AddressedHarEntry {
  request?: { url?: unknown };
  serverIPAddress?: unknown;
  /** Playwright's own marker, not part of the HAR format — read as a hint, never as the test (#185). */
  _resourceType?: unknown;
  /** `_failureText` present means the request never got an answer. Loose, like the rest of this. */
  response?: { status?: unknown; _failureText?: unknown };
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
 *
 * **A WebSocket entry is indistinguishable from those** — measured on the fixture, its entry
 * carries `_resourceType: "websocket"` and no `serverIPAddress` at all while the document and XHR
 * entries beside it carry `"[::1]"`. That is why `webSocketToPrivateAddress` below exists as a
 * separate, deliberately weaker rule rather than a quiet extension of this one (#185).
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

/**
 * Sockets opened to a **literal** private address (#185).
 *
 * A WebSocket entry carries no `serverIPAddress`, so the rule above cannot see it and passes it
 * with every other addressless entry. The only signal it offers is its URL host, which is the
 * name-based, time-shifted check that `privateNetworkEntries` exists because it could not answer —
 * so this is adopted **for one entry kind, and only when the host is already an IP literal**.
 *
 * **A hostname is deliberately not resolved.** Resolving one at publish time would be a lookup at
 * a moment that is not the moment the socket opened, which is the whole property #162 established
 * cannot be relied on. A socket to a rebound hostname therefore stays uncovered, and #185 says so
 * rather than the code implying otherwise.
 *
 * An entry that already carries an address is skipped: if Playwright ever starts recording one,
 * `privateNetworkEntries` is the better evidence and this rule steps aside rather than reporting
 * the same entry twice.
 */
export function webSocketToPrivateAddress(
  entries: readonly AddressedHarEntry[],
): PrivateNetworkEntry[] {
  const found: PrivateNetworkEntry[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry;
    if (typeof record.serverIPAddress === "string" && record.serverIPAddress !== "") continue;
    // A refused connection served nothing, so no private content reached the archive. This is the
    // same reasoning `termination.json` already uses to keep `failedRequests` out of the outcome,
    // and without it a page that probes `wss://127.0.0.1:9/` fails an otherwise public capture.
    if (record.response?._failureText !== undefined) continue;
    const url = record.request?.url;
    if (typeof url !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    // The scheme is what the entry **is**; `_resourceType` is Playwright's own field and no part of
    // the HAR format guarantees it. Reading only the marker made the rule depend on it.
    const isSocket = parsed.protocol === "ws:" || parsed.protocol === "wss:";
    if (!isSocket && record._resourceType !== "websocket") continue;
    const host = parsed.hostname;
    // `URL.hostname` keeps the brackets on an IPv6 literal; `privateAddressKind` strips them, and
    // the reported address is the bare form so it reads the same as every other finding.
    const bare = host.replace(/^\[|\]$/g, "");
    const kind = privateAddressKind(bare);
    if (kind === undefined) continue;
    found.push({ url, address: bare, kind });
  }
  return found;
}
