/**
 * §6.5 request-normalization policy (ADR 0007, PRD #84).
 *
 * V1 records the caller's explicit volatile-query-key policy so replay can rebuild a normalized
 * request index in memory. The HAR remains the single source of request entries and response
 * bodies — this artifact never duplicates URL, method, body, count or collision metadata.
 *
 * This module owns the V1 schema, its validator, the pure key/URL operations (#90), and the
 * ambiguity grouping (#91). S4 (#91) wires explicit caller keys through capture and refuses
 * publication when distinct archived requests collapse under the policy.
 */

export const REQUEST_NORMALIZATION_FILE_NAME = "request-normalization.json";

const SUPPORTED_SCHEMA_VERSION = 1;

export type RequestNormalizationV1 = {
  schemaVersion: 1;
  query: {
    volatileKeys: string[];
    keyMatch: "case-insensitive-exact";
  };
};

export function defaultRequestNormalization(): RequestNormalizationV1 {
  return {
    schemaVersion: 1,
    query: {
      volatileKeys: [],
      keyMatch: "case-insensitive-exact",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The unexpected-request taxonomy (ADR 0007, PRD #84). `normalized-match` is a success
 * diagnostic; the other three are fail-closed outcomes.
 */
export type NormalizationOutcome =
  | "normalized-match"
  | "ambiguous-normalized-match"
  | "redacted-post-body"
  | "not-in-archive";

/**
 * Canonicalize the caller's volatile-query-key policy: lowercase and sort, refuse empty and
 * duplicate keys. Matching is case-insensitive and exact; separators remain significant, so
 * `_t` and `t` (and `x-t` and `xt`) stay distinct. The input array is never mutated.
 */
export function normalizePolicyKeys(keys: readonly string[] | undefined): string[] {
  if (keys === undefined) return [];
  const normalized = keys.map((key) => key.toLowerCase()).sort();
  const seen = new Set<string>();
  for (const key of normalized) {
    if (key.length === 0) {
      throw new Error("request normalization: empty volatile query key");
    }
    if (seen.has(key)) {
      throw new Error(`request normalization: duplicate volatile query key: ${key}`);
    }
    seen.add(key);
  }
  return normalized;
}

/**
 * Remove every occurrence of an allowlisted query parameter from an absolute request URL,
 * preserving all other components and the relative order of the remaining parameters.
 *
 * The raw URL is edited in its query segment only, never round-tripped through `URL.toString()`:
 * that would canonicalize the host, port, path and percent-encoding, which PRD #84 explicitly
 * keeps out of scope. The input string is never mutated. An invalid absolute URL fails closed
 * without echoing the URL (it may carry the very credentials this module exists to strip).
 */
export function normalizeRequestUrl(rawUrl: string, volatileKeys: readonly string[]): string {
  try {
    new URL(rawUrl);
  } catch {
    throw new Error("request normalization: invalid request URL");
  }

  const hashIndex = rawUrl.indexOf("#");
  const urlEnd = hashIndex === -1 ? rawUrl.length : hashIndex;
  const queryIndex = rawUrl.slice(0, urlEnd).indexOf("?");
  if (queryIndex === -1) return rawUrl;

  const base = rawUrl.slice(0, queryIndex + 1);
  const rawQuery = rawUrl.slice(queryIndex + 1, urlEnd);
  const fragment = rawUrl.slice(urlEnd);

  const allowlisted = new Set(normalizePolicyKeys(volatileKeys));
  const kept: string[] = [];
  for (const rawParam of rawQuery.split("&")) {
    if (rawParam.length === 0) continue;
    const eq = rawParam.indexOf("=");
    const rawKey = eq === -1 ? rawParam : rawParam.slice(0, eq);
    let key: string;
    try {
      key = decodeURIComponent(rawKey).toLowerCase();
    } catch {
      key = rawKey.toLowerCase();
    }
    if (!allowlisted.has(key)) kept.push(rawParam);
  }
  // A fully-stripped query disappears with its `?`; otherwise it survives with the parameters
  // that remain, in their original order and encoding.
  const query = kept.length === 0 ? "" : `?${kept.join("&")}`;
  return `${base.slice(0, -1)}${query}${fragment}`;
}

/**
 * A collision-safe internal key for a request: method + normalized URL. Uses a length-prefixed
 * form so a URL containing the delimiter cannot be confused with a different method/URL split.
 */
export function requestKey(method: string, normalizedUrl: string): string {
  return `${method.length}:${method}|${normalizedUrl.length}:${normalizedUrl}`;
}

export function validateRequestNormalization(doc: unknown): { ok: true } | { ok: false } {
  // Non-record JSON values have no schemaVersion, so the schema guard below already refuses them.
  const policy = isRecord(doc) ? doc : {};
  if (policy.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return { ok: false };
  // A non-record query cannot carry volatileKeys or keyMatch, so the guards below refuse it.
  const query = isRecord(policy.query) ? policy.query : {};
  if (!Array.isArray(query.volatileKeys)) return { ok: false };
  // Keys are published in canonical form (lowercase, sorted, no empties/duplicates — #90).
  for (const key of query.volatileKeys) {
    if (typeof key !== "string" || key.length === 0) return { ok: false };
  }
  if (query.keyMatch !== "case-insensitive-exact") return { ok: false };
  return { ok: true };
}

export type HarRequestEntry = {
  _resourceType?: unknown;
  request?: { url?: unknown; method?: unknown };
};

/**
 * Group the archived requests by exact method + normalized URL and return every group whose
 * raw URLs are not all identical — the ambiguity contract (#84): replay must never be forced
 * to choose between distinct archived responses. WebSocket entries are ignored: `routeFromHAR`
 * does not intercept them and §6.4 records WebSocket dependence separately.
 *
 * Fails closed on a malformed entry or an invalid URL so a policy that replay cannot consume
 * consistently is refused at publication.
 */
export function findAmbiguousNormalizedRequests(
  entries: HarRequestEntry[],
  volatileKeys: readonly string[],
): string[] {
  const keys = normalizePolicyKeys(volatileKeys);
  const groups = new Map<string, Set<string>>();
  for (const entry of entries) {
    // `_resourceType` lives on the HAR entry. A WebSocket entry is ignored entirely — even one
    // without a request object — because `routeFromHAR` does not intercept WebSockets and §6.4
    // records their dependence separately.
    if (entry._resourceType === "websocket") continue;
    const request = entry.request;
    if (request === undefined) {
      throw new Error("request normalization: malformed HAR request entry");
    }
    if (typeof request.url !== "string" || typeof request.method !== "string") {
      throw new Error("request normalization: malformed HAR request entry");
    }
    const normalized = normalizeRequestUrl(request.url, keys);
    const key = requestKey(request.method, normalized);
    const rawUrls = groups.get(key) ?? new Set<string>();
    rawUrls.add(request.url);
    groups.set(key, rawUrls);
  }
  return [...groups.entries()]
    .filter(([, rawUrls]) => rawUrls.size > 1)
    .map(([key]) => key);
}
