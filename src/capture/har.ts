/**
 * Reading a HAR is a pure function so the archive layer is testable without a browser.
 * The deterministic logic lives here and the driver in `record.ts` stays thin — the same
 * split the MCP layering rule (#8) requires of every stage, adopted before there is code
 * that would have to be retrofitted to it.
 */
export interface HarEntryLike {
  request: { url: string };
}

export interface HarLike {
  log: { entries: HarEntryLike[] };
}

export function harResourceUrls(har: HarLike): string[] {
  return har.log.entries.map((entry) => entry.request.url);
}
