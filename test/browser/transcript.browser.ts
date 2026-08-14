import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureHar } from "../../src/capture/record.ts";
import { validateTranscript, type InteractionTranscriptV1 } from "../../src/capture/transcript.ts";

let browser: Browser;
let tempDir: string;
let transcript: InteractionTranscriptV1;

before(async () => {
  browser = await chromium.launch();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-transcript-"));
  const servers: FixtureServers = await startFixtureServers();
  const archive = join(tempDir, "archive");
  try {
    await captureHar({ browser: browser as never, url: servers.primary.url, outDir: archive });
  } finally {
    await servers.stop();
  }
  transcript = JSON.parse(readFileSync(join(archive, "transcript.json"), "utf8")) as InteractionTranscriptV1;
});

after(async () => {
  await browser?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test("publishes a transcript that validates against its own schema", () => {
  assert.deepEqual(validateTranscript(transcript), { ok: true });
});

test("records the scrolling the adaptive sweep drove", () => {
  const events = transcript.chunks.flatMap((chunk) => chunk.events);
  const scrolls = events.filter((event) => event.type === "scroll");
  // The sweep scrolls the page to trigger lazy content. A transcript with none of that recorded
  // is a recorder that was installed too late, not a page that never moved.
  assert.ok(scrolls.length > 0, `no scroll recorded; transcript had ${events.length} events`);
});

test("the global sequence is gap-free, so a loss would be detectable", () => {
  const events = transcript.chunks.flatMap((chunk) => chunk.events);
  events.forEach((event, index) => {
    assert.equal(event.seq, index + 1, `seq gap at index ${index}`);
  });
  // Dropping is allowed and counted; silently reordering is not. The counter is the evidence that
  // a bounded buffer lost something, and it must be present even when it is zero.
  assert.equal(typeof transcript.droppedEvents, "number");
});

test("every scroll names the container that moved, not page coordinates alone", () => {
  const scrolls = transcript.chunks.flatMap((chunk) => chunk.events).filter((e) => e.type === "scroll");
  for (const event of scrolls) {
    // §6.11: "window" or an element path. An empty target would make a nested scroller
    // indistinguishable from the page, which is the whole reason the container is recorded.
    assert.ok(event.target.length > 0, "a scroll event names no container");
    assert.ok(
      typeof event.detail.x === "number" && typeof event.detail.y === "number",
      "a scroll event carries no offsets",
    );
  }
});

test("records a nested container that scrolls itself, which never reaches window", () => {
  const scrolls = transcript.chunks.flatMap((chunk) => chunk.events).filter((e) => e.type === "scroll");
  const nested = scrolls.filter((event) => event.target !== "window");
  // §6.11's ground truth is `nested-scroller` in the fixture manifest: a horizontal container that
  // advances its own scrollLeft. Its scroll event does not bubble to window, so a transcript that
  // listened only there would record the page and report nothing for this — indistinguishable from
  // a container that never moved.
  assert.ok(
    nested.length > 0,
    `no nested-container scroll recorded; ${scrolls.length} scrolls were all on window`,
  );
  assert.ok(
    nested.some((event) => event.detail.x !== 0),
    "the nested scroller moved horizontally and no recorded offset shows it",
  );
});
