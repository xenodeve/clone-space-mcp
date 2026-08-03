import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * A document epoch is an opaque token minted by the browser for one document commit — long
 * enough not to be a counter, and drawn from a charset with no URL punctuation. The shape is
 * asserted rather than assumed because `checkpoints.json` is published without passing through
 * `redactHarArchive`: an epoch built from the page URL leaks whatever its query string held.
 */
const DOCUMENT_EPOCH_PATTERN = /^epoch:[0-9A-Za-z_-]{16,}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCheckpoint(
  value: unknown,
): value is {
  checkpointId: string;
  openedAt: number;
  artifacts: unknown[];
  primaryTarget: { documentEpoch: string };
} {
  if (!isRecord(value)) return false;
  if (typeof value.checkpointId !== "string" || value.checkpointId.length === 0) {
    return false;
  }
  if (
    typeof value.openedAt !== "number" ||
    !Number.isFinite(value.openedAt) ||
    value.openedAt < 0
  ) {
    return false;
  }
  if (!Array.isArray(value.artifacts)) return false;
  if (!isRecord(value.primaryTarget)) return false;
  if (
    typeof value.primaryTarget.documentEpoch !== "string" ||
    !DOCUMENT_EPOCH_PATTERN.test(value.primaryTarget.documentEpoch)
  ) {
    return false;
  }
  return true;
}

async function readJsonFile(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function validateCheckpoints(doc: unknown): { ok: true } | { ok: false } {
  if (!isRecord(doc)) return { ok: false };
  if (doc.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return { ok: false };
  if (!Array.isArray(doc.checkpoints)) return { ok: false };
  if (doc.checkpoints.length === 0) return { ok: false };
  if (!isRecord(doc.har)) return { ok: false };
  if (typeof doc.har.path !== "string" || doc.har.path.length === 0) {
    return { ok: false };
  }
  if (doc.har.scope !== "run") return { ok: false };

  let previousOpenedAt: number | undefined;
  const checkpointIds = new Set<string>();
  for (const checkpoint of doc.checkpoints) {
    if (!isCheckpoint(checkpoint)) return { ok: false };
    if (checkpointIds.has(checkpoint.checkpointId)) return { ok: false };
    checkpointIds.add(checkpoint.checkpointId);
    if (previousOpenedAt !== undefined && checkpoint.openedAt < previousOpenedAt) {
      return { ok: false };
    }
    previousOpenedAt = checkpoint.openedAt;
  }

  return { ok: true };
}

export async function validateStagedArchive(
  stagingRoot: string,
): Promise<{ ok: true } | { ok: false }> {
  const checkpointsDoc = await readJsonFile(join(stagingRoot, "checkpoints.json"));
  if (checkpointsDoc === undefined) return { ok: false };
  if (!validateCheckpoints(checkpointsDoc).ok) return { ok: false };

  // validateCheckpoints already narrowed the shape; re-read through the same guards. No
  // length comparison after the filter: validateCheckpoints returns ok only when every entry
  // satisfies isCheckpoint, so the filter can never drop one and the check could never fail.
  if (!isRecord(checkpointsDoc) || !Array.isArray(checkpointsDoc.checkpoints)) {
    return { ok: false };
  }
  const checkpoints = checkpointsDoc.checkpoints.filter(isCheckpoint);

  const finalCheckpoint = checkpoints[checkpoints.length - 1];
  if (finalCheckpoint === undefined) return { ok: false };

  const environmentDoc = await readJsonFile(join(stagingRoot, "environment.json"));
  if (environmentDoc === undefined) return { ok: false };
  if (!isRecord(environmentDoc)) return { ok: false };
  if (!isRecord(environmentDoc.checkpoint)) return { ok: false };

  const binding = environmentDoc.checkpoint;
  if (typeof binding.checkpointId !== "string") return { ok: false };
  if (typeof binding.documentEpoch !== "string") return { ok: false };
  if (
    typeof binding.openedAt !== "number" ||
    !Number.isFinite(binding.openedAt) ||
    binding.openedAt < 0
  ) {
    return { ok: false };
  }

  // Coherent final-checkpoint binding: environment must name the final checkpoint
  // with matching epoch and monotonic timestamp.
  if (binding.checkpointId !== finalCheckpoint.checkpointId) return { ok: false };
  if (binding.documentEpoch !== finalCheckpoint.primaryTarget.documentEpoch) {
    return { ok: false };
  }
  if (binding.openedAt !== finalCheckpoint.openedAt) return { ok: false };

  // ADR 0005 also lists "a binding names an unknown checkpointId" as its own refusal. Today it
  // is unreachable: environment.json is the only bound artifact and the check above already
  // requires it to BE the final checkpoint. A guard that cannot fail reads as protection that
  // is not there, so it is left out until a second artifact binds and can actually violate it.

  return { ok: true };
}
