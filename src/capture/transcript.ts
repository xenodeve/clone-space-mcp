/**
 * §6.7 + §6.11 interaction transcript (PRD #111). A bounded, sequence-numbered record of
 * interaction events captured in-page (scroll / click / input / visibility), where each scroll
 * event names its **container** — the window or a nested/horizontal scroller — not page
 * coordinates alone.
 *
 * The transcript is the drained output of the in-page trace buffer (`window.__x`): the page
 * caps the array and drops the oldest on overflow, bumping an explicit counter, and the host
 * drains it in sequence-numbered chunks after each checkpoint. A gap in the global seq is a
 * detectable loss, never a silent reorder.
 *
 * This module is the pure schema/chunk layer only — the in-page injector and drain wiring are
 * S2 (#114).
 */

export const TRANSCRIPT_SCHEMA_VERSION = 1;

export type TranscriptEventType = "scroll" | "click" | "input" | "visibility";

export type TranscriptEvent = {
  seq: number;
  ts: number;
  type: TranscriptEventType;
  /** "window" | "wa:<frame>:<seq>" | a tag[n] selector path. */
  target: string;
  detail: Record<string, unknown>;
};

export type TranscriptChunk = {
  chunkSeq: number;
  events: TranscriptEvent[];
};

export type InteractionTranscriptV1 = {
  schemaVersion: 1;
  droppedEvents: number;
  chunks: TranscriptChunk[];
};

/** A minimal structural description of a DOM node for container identification. */
export type ContainerNode = {
  wa?: string;
  tag: string;
  index: number;
  parent?: ContainerNode;
};

const EVENT_TYPES: ReadonlySet<string> = new Set(["scroll", "click", "input", "visibility"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Append a chunk carrying a global, gap-free sequence. The first event must have
 * `seq === runningSeq + 1` and events must be internally contiguous; a gap means the caller
 * lost events and must not publish a chunk that looks continuous.
 */
export function assembleChunk(
  events: TranscriptEvent[],
  chunkSeq: number,
  runningSeq: number,
): { chunk: TranscriptChunk; runningSeq: number } {
  let next = runningSeq;
  for (const event of events) {
    if (event.seq !== next + 1) {
      throw new Error(
        `transcript: non-contiguous seq — expected ${next + 1}, got ${event.seq}`,
      );
    }
    next = event.seq;
  }
  return { chunk: { chunkSeq, events }, runningSeq: next };
}

/**
 * Apply the in-page cap: keep at most `maxEvents` and at most `maxBytes` (serialized), dropping
 * the **oldest** events and returning the total dropped count (added to `droppedBefore`). Each
 * event is serialized once. The input array is never mutated.
 */
export function droppedAfterOverflow(
  events: TranscriptEvent[],
  maxEvents: number,
  maxBytes: number,
  droppedBefore: number,
): { kept: TranscriptEvent[]; droppedEvents: number } {
  // Pre-serialize each event once so the byte-cap loop is O(n), not O(n²).
  const sized = events.map((event) => ({ event, bytes: Buffer.byteLength(JSON.stringify(event)) }));
  let dropped = droppedBefore;
  let totalBytes = sized.reduce((sum, { bytes }) => sum + bytes, 0);
  let kept = [...sized];
  while (kept.length > 0 && (kept.length > maxEvents || totalBytes > maxBytes)) {
    totalBytes -= kept[0]!.bytes;
    kept.shift();
    dropped += 1;
  }
  return { kept: kept.map(({ event }) => event), droppedEvents: dropped };
}

/**
 * Identify a scroll container: the `wa:` id when the element carries one, else a stable
 * `tag[n]` selector path from `BODY`. This deliberately does not require identity-injected
 * capture — a documented fallback keeps the transcript usable either way.
 */
export function containerRef(node: ContainerNode): string {
  if (node.wa !== undefined) return node.wa;
  const chain: string[] = [];
  let current: ContainerNode | undefined = node;
  while (current !== undefined) {
    chain.unshift(`${current.tag}[${current.index}]`);
    current = current.parent;
  }
  return chain.join(" > ");
}

function isTranscriptEvent(value: unknown): value is TranscriptEvent {
  if (!isRecord(value)) return false;
  if (typeof value.seq !== "number" || !Number.isFinite(value.seq)) return false;
  if (typeof value.ts !== "number" || !Number.isFinite(value.ts)) return false;
  if (typeof value.type !== "string" || !EVENT_TYPES.has(value.type)) return false;
  if (typeof value.target !== "string" || value.target.length === 0) return false;
  return isRecord(value.detail);
}

function isTranscriptChunk(value: unknown): value is TranscriptChunk {
  if (!isRecord(value)) return false;
  if (typeof value.chunkSeq !== "number" || !Number.isFinite(value.chunkSeq)) return false;
  return Array.isArray(value.events) && value.events.every(isTranscriptEvent);
}

/** Validate a transcript: schema version, dropped count, chunk shape, and seq continuity. */
export function validateTranscript(doc: unknown): { ok: true } | { ok: false } {
  const transcript = isRecord(doc) ? doc : {};
  if (transcript.schemaVersion !== TRANSCRIPT_SCHEMA_VERSION) return { ok: false };
  if (typeof transcript.droppedEvents !== "number" || !Number.isFinite(transcript.droppedEvents)) {
    return { ok: false };
  }
  if (transcript.droppedEvents < 0) return { ok: false };
  if (!Array.isArray(transcript.chunks)) return { ok: false };
  if (!transcript.chunks.every(isTranscriptChunk)) return { ok: false };

  // Within-chunk continuity: events inside one chunk must be strictly contiguous — an internal
  // gap is a harness bug, not a page drop. Across chunks, a gap is legitimate: it corresponds to
  // events the page dropped, which `droppedEvents` accounts for explicitly. Chunk seqs strictly
  // increase.
  let previousChunkSeq = 0;
  for (const chunk of transcript.chunks) {
    if (chunk.chunkSeq !== previousChunkSeq + 1) return { ok: false };
    previousChunkSeq = chunk.chunkSeq;
    for (let i = 1; i < chunk.events.length; i += 1) {
      // Within-chunk strict +1 continuity; the first event of a chunk sets its own base (a gap
      // from the previous chunk is a legitimate page drop, accounted by droppedEvents).
      if (chunk.events[i]!.seq !== chunk.events[i - 1]!.seq + 1) return { ok: false };
    }
  }
  return { ok: true };
}
