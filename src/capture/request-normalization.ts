/**
 * §6.5 request-normalization policy (ADR 0007, PRD #84).
 *
 * V1 records the caller's explicit volatile-query-key policy so replay can rebuild a normalized
 * request index in memory. The HAR remains the single source of request entries and response
 * bodies — this artifact never duplicates URL, method, body, count or collision metadata.
 *
 * This module owns the V1 schema, its pure validator, and the pure key/URL operations (#90):
 * policy-key canonicalization, URL normalization against an explicit allowlist, and a
 * collision-safe request key. S4 (#91) wires explicit caller keys and the ambiguity check
 * against the HAR.
 */

export const REQUEST_NORMALIZATION_FILE_NAME = "request-normalization.json";

const SUPPORTED_SCHEMA_VERSION = 1;

export type RequestNormalizationV1 = {
  schemaVersion: 1;
  query: {
    volatileKeys: [];
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
  // S2 publishes only the empty default. A non-empty key list is not yet implementable here —
  // the key-canonicalization and ambiguity rules land in #90/#91, so this validator refuses it
  // rather than accepting a policy replay could not consume consistently.
  if (query.volatileKeys.length !== 0) return { ok: false };
  if (query.keyMatch !== "case-insensitive-exact") return { ok: false };
  return { ok: true };
}
