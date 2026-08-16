/**
 * The **network attempt set**, reduced to two comparable counts (#171).
 *
 * The issue's v1 scope names it — *"behaviour multiset, network attempt set with its ADR 0007
 * classification, and the motion counts"* — and the digest had no network field at all, so **the
 * gate could return `PASS` on a clone that fetched an entirely different set of things.** That is
 * the opposite of what this project claims. The issue names the concrete case: `www.chaingpt.org`
 * cannot serve `Cannon_Exterior.hdr`, its 3D scene's environment map, so an API-level comparison
 * passes while the scene renders unlit.
 *
 * **Two counts, not one.** A clone that fetches the same number of things from a different place is
 * a different failure from one that fetches a different number, and a single total hides the first.
 * They are counts rather than the set itself because the digest compares scalars with `Object.is`;
 * what the sets *are* lives in the archive's HAR, which is where anyone chasing a difference goes.
 */

import { normalizeRequestUrl } from "../capture/request-normalization.ts";

export interface NetworkDigest {
  /** Distinct requests, after ADR 0007 normalization. */
  requests: number;
  /** Distinct origins those requests went to. */
  origins: number;
}

/**
 * `volatileKeys` is the caller's policy and defaults to **none**.
 *
 * `defaultRequestNormalization()` ships an empty list on purpose: ADR 0007 refuses ambiguity rather
 * than inventing a rule. Dropping a parameter nobody declared volatile would be this function
 * excusing a difference on a policy it made up, which is the failure an allowlist entry needs a
 * written rationale to avoid.
 */
export function networkDigest(
  urls: readonly string[],
  volatileKeys: readonly string[] = [],
): NetworkDigest {
  const requests = new Set<string>();
  const origins = new Set<string>();
  for (const url of urls) {
    // `performance.getEntriesByType("resource")` also carries `blob:` and `data:` entries, which
    // are the page's own object URLs and not network attempts at all. Counting them would make
    // this field measure something other than what the page asked the network for.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    requests.add(normalizeRequestUrl(url, volatileKeys));
    origins.add(parsed.origin);
  }
  return { requests: requests.size, origins: origins.size };
}
