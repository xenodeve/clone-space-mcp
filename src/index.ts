/**
 * clone-space — archive a live web page so it replays offline with real motion,
 * and an AI agent can read how it is built.
 *
 * The pipeline is four stages; each lands in its own phase (see
 * `docs/OPEN-WORK-LEDGER.md`). Nothing is implemented yet.
 */
export const STAGES = ["capture", "replay", "extract", "serve"] as const;

export type Stage = (typeof STAGES)[number];
