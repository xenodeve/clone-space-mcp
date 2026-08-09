/**
 * §6.6 versioned `TargetRef` union (plan §6.6, §4 "Not every animation target is an Element").
 *
 * The behavior graph must be able to name targets a `wa:` element handle cannot address:
 * pseudo-elements, `document`, `window`, plain JS objects, graphics resources, and opaque
 * targets. Widening this union later invalidates every graph already produced, so the versioned
 * union lands before the graph schema ships. This module is the schema/type layer only — no
 * browser, filesystem, or capture wiring.
 */

export const TARGET_REF_SCHEMA_VERSION = 1;

export type TargetRefV1 =
  | { kind: "element"; wa: string }
  | { kind: "pseudo-element"; wa: string; pseudo: string }
  | { kind: "document" }
  | { kind: "window" }
  | { kind: "js-object"; id: string }
  | { kind: "graphics-resource"; url: string }
  | { kind: "opaque"; note?: string };

/** A `wa:<frame-key>:<sequence>` handle, per `src/identity/inject.ts:98`. The frame key is
 * evidence-based and may itself contain `:`, so only the prefix is checked here. */
function isWaHandle(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("wa:");
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function isValidUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ALLOWED_KEYS: Record<string, readonly string[]> = {
  element: ["kind", "wa"],
  "pseudo-element": ["kind", "wa", "pseudo"],
  document: ["kind"],
  window: ["kind"],
  "js-object": ["kind", "id"],
  "graphics-resource": ["kind", "url"],
  opaque: ["kind", "note"],
};

/**
 * Validate a `TargetRefV1` value. Rejects an unknown kind, a non-record value, missing
 * required fields, empty handles, an invalid graphics URL, and any field outside the member's
 * own shape — a reader must not silently drop information the archive carried.
 */
export function validateTargetRef(value: unknown): { ok: true } | { ok: false } {
  if (!isRecord(value)) return { ok: false };
  if (typeof value.kind !== "string") return { ok: false };

  const allowed = ALLOWED_KEYS[value.kind];
  if (allowed === undefined) return { ok: false };

  // Refuse unknown/extra fields beyond the member's own keys.
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return { ok: false };
  }

  switch (value.kind) {
    case "element":
      return isWaHandle(value.wa) ? { ok: true } : { ok: false };
    case "pseudo-element":
      return isWaHandle(value.wa) && isNonEmptyString(value.pseudo) ? { ok: true } : { ok: false };
    case "document":
    case "window":
      return { ok: true };
    case "js-object":
      return isNonEmptyString(value.id) ? { ok: true } : { ok: false };
    case "graphics-resource":
      return isValidUrl(value.url) ? { ok: true } : { ok: false };
    case "opaque":
      // note is optional; if present it must be a string.
      return value.note === undefined || typeof value.note === "string"
        ? { ok: true }
        : { ok: false };
    default:
      // Unreachable: ALLOWED_KEYS already refused any unknown kind above.
      return { ok: false };
  }
}
