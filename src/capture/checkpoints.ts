const SUPPORTED_SCHEMA_VERSION = 1;

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
  if (typeof value.checkpointId !== "string") return false;
  if (typeof value.openedAt !== "number") return false;
  if (!Array.isArray(value.artifacts)) return false;
  if (!isRecord(value.primaryTarget)) return false;
  if (typeof value.primaryTarget.documentEpoch !== "string") return false;
  return true;
}

export function validateCheckpoints(doc: unknown): { ok: true } | { ok: false } {
  if (!isRecord(doc)) return { ok: false };
  if (doc.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return { ok: false };
  if (!Array.isArray(doc.checkpoints)) return { ok: false };

  let previousOpenedAt: number | undefined;
  for (const checkpoint of doc.checkpoints) {
    if (!isCheckpoint(checkpoint)) return { ok: false };
    if (previousOpenedAt !== undefined && checkpoint.openedAt < previousOpenedAt) {
      return { ok: false };
    }
    previousOpenedAt = checkpoint.openedAt;
  }

  return { ok: true };
}
