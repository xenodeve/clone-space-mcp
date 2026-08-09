import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  findAmbiguousNormalizedRequests,
  type HarRequestEntry,
  validateRequestNormalization,
} from "./request-normalization.ts";

const SUPPORTED_SCHEMA_VERSION = 1;
const REQUIRED_CAPABILITY_FLAGS = [
  "serviceWorkerDependent",
  "webSocketDependent",
  "closedShadowRootPresent",
  "sourcemapDeclared",
] as const;

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

type RunAssociation = { path: string; scope: "run" };

function isRunAssociation(value: unknown): value is RunAssociation {
  if (!isRecord(value)) return false;
  if (typeof value.path !== "string" || value.path.length === 0) return false;
  // Refuse archive escapes and host-native paths; checkpoints can only name archive-relative files.
  if (
    value.path.startsWith("/") ||
    value.path.includes("\\") ||
    /^[A-Za-z]:/.test(value.path) ||
    value.path.split("/").includes("..")
  ) {
    return false;
  }
  return value.scope === "run";
}

function isCapabilityValue(value: unknown): boolean {
  return value === true || value === false || value === "undetermined";
}

export function validateCapabilities(doc: unknown): { ok: true } | { ok: false } {
  // Non-record JSON values have no schemaVersion, so the schema guard below already refuses them.
  const capabilities = isRecord(doc) ? doc : {};
  if (capabilities.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return { ok: false };
  // A non-record flags value cannot contain every required flag, so the required-key guard rejects it.
  const flags = isRecord(capabilities.flags) ? capabilities.flags : {};
  for (const flag of REQUIRED_CAPABILITY_FLAGS) {
    if (!(flag in flags)) return { ok: false };
  }
  for (const flag of REQUIRED_CAPABILITY_FLAGS) {
    if (flag in flags && !isCapabilityValue(flags[flag])) return { ok: false };
  }
  return { ok: true };
}

function isCheckpoint(
  value: unknown,
): value is {
  checkpointId: string;
  openedAt: number;
  artifacts: unknown[];
  primaryTarget: { documentEpoch: string };
} {
  // A non-record JSON value normalizes to no checkpointId, so the next guard rejects it.
  const checkpoint = isRecord(value) ? value : {};
  if (typeof checkpoint.checkpointId !== "string" || checkpoint.checkpointId.length === 0) {
    return false;
  }
  if (
    typeof checkpoint.openedAt !== "number" ||
    !Number.isFinite(checkpoint.openedAt) ||
    checkpoint.openedAt < 0
  ) {
    return false;
  }
  if (!Array.isArray(checkpoint.artifacts)) return false;
  // A non-record primaryTarget has no documentEpoch, so the epoch guard below already rejects it.
  const primaryTarget = isRecord(checkpoint.primaryTarget) ? checkpoint.primaryTarget : {};
  if (
    typeof primaryTarget.documentEpoch !== "string" ||
    !DOCUMENT_EPOCH_PATTERN.test(primaryTarget.documentEpoch)
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

// Deliberately duplicated from redact.ts because that module may not be touched here.
function isStrictlyWithin(root: string, candidate: string): boolean {
  const relativeCandidate = relative(root, candidate);
  return (
    relativeCandidate.length > 0 &&
    relativeCandidate !== ".." &&
    !relativeCandidate.startsWith(`..${sep}`) &&
    !isAbsolute(relativeCandidate)
  );
}

async function isStagedRegularFile(root: string, association: RunAssociation): Promise<boolean> {
  try {
    const path = join(root, association.path);
    // The isFile check is load-bearing for associations that are NOT read afterwards
    // (termination.json): a directory at that path would otherwise pass containment.
    if (!(await lstat(path)).isFile()) return false;
    const [resolvedRoot, resolvedPath] = await Promise.all([realpath(root), realpath(path)]);
    return isStrictlyWithin(resolvedRoot, resolvedPath);
  } catch {
    return false;
  }
}

export function validateCheckpoints(doc: unknown): { ok: true } | { ok: false } {
  // Non-record JSON values have no schemaVersion, so the schema guard below already refuses them.
  const checkpointsDocument = isRecord(doc) ? doc : {};
  if (checkpointsDocument.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return { ok: false };
  // No non-array JSON value can pass the non-empty and per-entry checks that follow.
  const checkpoints = Array.isArray(checkpointsDocument.checkpoints)
    ? checkpointsDocument.checkpoints
    : [];
  if (checkpoints.length === 0) return { ok: false };
  if (!isRunAssociation(checkpointsDocument.har)) return { ok: false };
  if (!isRunAssociation(checkpointsDocument.capabilities)) return { ok: false };
  if (!isRunAssociation(checkpointsDocument.requestNormalization)) return { ok: false };
  if (!isRunAssociation(checkpointsDocument.termination)) return { ok: false };
  if (!isRunAssociation(checkpointsDocument.commit)) return { ok: false };

  let previousOpenedAt: number | undefined;
  const checkpointIds = new Set<string>();
  for (const checkpoint of checkpoints) {
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
  // readJsonFile returns undefined for missing or invalid JSON; validateCheckpoints rejects it below.
  if (!validateCheckpoints(checkpointsDoc).ok) return { ok: false };

  // validateCheckpoints already narrowed the shape; re-reading the record and associations cannot
  // be the only reason for refusal, so use that established shape directly.
  const stagedDocument = checkpointsDoc as Record<string, unknown>;
  // Refuse missing, non-file, or escaping run-level associations; each must point to staged evidence.
  if (!(await isStagedRegularFile(stagingRoot, stagedDocument.har as RunAssociation))) {
    return { ok: false };
  }
  if (!(await isStagedRegularFile(stagingRoot, stagedDocument.capabilities as RunAssociation))) {
    return { ok: false };
  }
  if (
    !(await isStagedRegularFile(stagingRoot, stagedDocument.requestNormalization as RunAssociation))
  ) {
    return { ok: false };
  }
  // termination.json is written before validation (unlike commit.json, which is written after
  // because it must hash the validated bytes), so it can and must be a staged regular file here.
  if (!(await isStagedRegularFile(stagingRoot, stagedDocument.termination as RunAssociation))) {
    return { ok: false };
  }

  const capabilitiesDoc = await readJsonFile(
    join(stagingRoot, (stagedDocument.capabilities as RunAssociation).path),
  );
  if (capabilitiesDoc === undefined || !validateCapabilities(capabilitiesDoc).ok) {
    return { ok: false };
  }
  // A true or undetermined flag is a measurement outcome, not archive damage, so it must not refuse publication.

  const requestNormalizationDoc = await readJsonFile(
    join(stagingRoot, (stagedDocument.requestNormalization as RunAssociation).path),
  );
  if (requestNormalizationDoc === undefined || !validateRequestNormalization(requestNormalizationDoc).ok) {
    return { ok: false };
  }
  const requestNormalization = isRecord(requestNormalizationDoc) ? requestNormalizationDoc : {};
  const query = isRecord(requestNormalization.query) ? requestNormalization.query : {};
  const volatileKeys = Array.isArray(query.volatileKeys) ? query.volatileKeys : [];

  // Independent re-check (producer and validator share the pure function but neither trusts the
  // other): a persisted or tampered policy must not collapse distinct archived requests.
  const harRaw = await readFile(
    join(stagingRoot, (stagedDocument.har as RunAssociation).path),
    "utf8",
  ).catch(() => undefined);
  if (harRaw === undefined) return { ok: false };
  let harEntries: HarRequestEntry[];
  try {
    const har = JSON.parse(harRaw) as { log?: { entries?: unknown } };
    if (!Array.isArray(har.log?.entries)) return { ok: false };
    harEntries = har.log.entries as HarRequestEntry[];
  } catch {
    return { ok: false };
  }
  try {
    if (findAmbiguousNormalizedRequests(harEntries, volatileKeys as string[]).length > 0) {
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }

  // validateCheckpoints already narrowed the shape; no length comparison after the filter:
  // every entry satisfies isCheckpoint, so the filter cannot drop one or become empty.
  const checkpoints = (stagedDocument.checkpoints as unknown[]).filter(isCheckpoint);
  const finalCheckpoint = checkpoints[checkpoints.length - 1]!;

  const environmentDoc = await readJsonFile(join(stagingRoot, "environment.json"));
  // Non-record or missing environment JSON normalizes to a binding with no fields; equality guards below refuse it.
  const environment = isRecord(environmentDoc) ? environmentDoc : {};
  // A non-record checkpoint has no binding fields; the type/equality guards below refuse it.
  const binding = isRecord(environment.checkpoint) ? environment.checkpoint : {};

  // Binding field type checks are redundant for JSON values: final-checkpoint equality below
  // rejects every value that cannot have the corresponding string or finite-number type.

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
