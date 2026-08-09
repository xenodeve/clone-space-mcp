/**
 * §6.5 request-normalization policy (ADR 0007, PRD #84).
 *
 * V1 records the caller's explicit volatile-query-key policy so replay can rebuild a normalized
 * request index in memory. The HAR remains the single source of request entries and response
 * bodies — this artifact never duplicates URL, method, body, count or collision metadata.
 *
 * This module owns the V1 schema and its pure validator. S2 (#86) publishes the default-empty
 * document; S3 (#90) adds the pure key/URL operations; S4 (#91) wires explicit caller keys and
 * the ambiguity check against the HAR.
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
