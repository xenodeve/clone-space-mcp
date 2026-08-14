import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startFixtureServers, type FixtureServers } from "../../scripts/fixture-client.ts";
import { captureHar } from "../../src/capture/record.ts";
import { replayArchive } from "../../src/replay/replay.ts";
import { extractBehaviour } from "../../src/extract/behaviour.ts";

const fixtureManifest = JSON.parse(
  readFileSync(new URL("../fixtures/motion-site/fixture-manifest.json", import.meta.url), "utf8"),
) as { declares: { id: string; mechanism: string; selector: string; kind: string }[] };

let browser: Browser;
let tempDir: string;

before(async () => {
  browser = await chromium.launch();
  tempDir = mkdtempSync(join(tmpdir(), "clone-space-extract-"));
});

after(async () => {
  await browser?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/**
 * The ledger's exit criterion for P4, stated as it was written: **finds every animation the
 * fixture declares.** The manifest is the ground truth, so a mechanism deleted from the page
 * fails here instead of quietly shrinking what "found everything" is taken to mean.
 */
test("extracts every mechanism the fixture declares, from a replayed archive", async () => {
  const servers: FixtureServers = await startFixtureServers();
  const archive = join(tempDir, "archive");
  try {
    await captureHar({ browser: browser as never, url: servers.primary.url, outDir: archive });
  } finally {
    await servers.stop();
  }

  const replay = await replayArchive({ archive, browser: browser as never });
  try {
    const graph = await extractBehaviour(replay);

      // Only the cases the manifest calls animations. The rest — the carousel, the lazy asset, the
    // cross-origin stylesheet — are capture-fidelity cases, and folding them in here would ask the
    // extractor for things that are not animations at all. The manifest carries the distinction so
    // this test does not have to invent it from whatever the extractor happens to support.
    const declared = [
      ...new Set(
        fixtureManifest.declares
          .filter((entry) => entry.kind === "animation")
          .map((entry) => entry.mechanism),
      ),
    ].sort();
    const found = [...graph.mechanisms].sort();
    // Found versus declared, as two lists rather than an impression.
    assert.deepEqual(
      declared.filter((mechanism) => !found.some((candidate) => candidate === mechanism)),
      [],
      `declared but not extracted — found ${JSON.stringify(found)}`,
    );

    // Element-level found-versus-declared, using the manifest's own selectors. The mechanism list
    // alone is too coarse: a timeline's nested tweens can all go missing while `gsap-timeline`
    // still appears from some other tween, and the count nobody asserted is the evidence lost.
    for (const entry of fixtureManifest.declares.filter((d) => d.kind === "animation")) {
      assert.ok(
        graph.nodes.some((node) => node.target === entry.selector),
        `${entry.id} (${entry.mechanism}) declares ${entry.selector} and no extracted node targets it`,
      );
    }

    // A node nobody can act on is not evidence: every target has to resolve in the page it came
    // from, and every animation has to belong to something that owns it.
    for (const node of graph.nodes) {
      assert.ok(node.target.length > 0, `a ${node.mechanism} node has no target selector`);
      // A non-element target is real behaviour with nothing to query for; the assertion below is
      // about selectors that claim to name an element.
      if (node.target === "<non-element>") continue;
      const resolves = await replay.page.evaluate(
        // eslint-disable-next-line
        new Function("return document.querySelector(" + JSON.stringify(node.target) + ") !== null") as () => boolean,
      );
      assert.ok(resolves, `${node.mechanism} target does not resolve: ${node.target}`);
      assert.ok(node.library.length > 0, `a ${node.mechanism} node names no library`);
    }

    // GSAP is the case the whole architecture exists for: it is not written down anywhere in the
    // archive, and only exists because the page's own JavaScript built it during replay.
    const gsap = graph.nodes.filter((node) => node.library.startsWith("gsap"));
    assert.ok(gsap.length > 0, "no GSAP behaviour was recovered from the replayed page");
  } finally {
    await replay.close();
  }
});
