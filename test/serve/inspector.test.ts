import { expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderInspector } from "../../src/serve/inspector.ts";
import { BEHAVIOUR_SCHEMA_VERSION } from "../../src/extract/behaviour.ts";
import { inspectArchive } from "../../src/serve/tools/inspect-archive.ts";
import { captureFixtureArchive } from "./fixture-archive.ts";

const DECLARED = [
  { id: "gsap-hero", mechanism: "gsap-timeline", selector: "[data-fixture-id='gsap-hero']", kind: "animation" },
  { id: "waapi-slide", mechanism: "waapi", selector: "[data-fixture-id='waapi-slide']", kind: "animation" },
  { id: "lazy-asset", mechanism: "lazy-asset", selector: "[data-fixture-id='lazy']", kind: "capture-fidelity" },
];

test("the inspector shows a gap as a row, not as a count nobody compared", async () => {
  const root = await captureFixtureArchive();
  try {
    const archive = await inspectArchive({ path: root });
    const html = renderInspector({
      archive,
      declared: DECLARED,
      behaviour: {
        schemaVersion: BEHAVIOUR_SCHEMA_VERSION,
        url: "https://example.com/",
        aborted: [],
        unrepresented: { cssTransitionElements: 0 },
        mechanisms: ["gsap-timeline"],
        nodes: [
          {
            mechanism: "gsap-timeline",
            target: "[data-fixture-id='gsap-hero']",
            name: "",
            timing: { durationMs: 500, delayMs: 0, iterations: 1 },
            easing: "power3.out",
            library: "gsap",
          },
        ],
      },
    });

    // The declared case that was extracted, and the one that was not, are both rows.
    expect(html).toContain("gsap-hero");
    expect(html).toContain("waapi-slide");
    expect(html).toContain("NOT FOUND");
    // A capture-fidelity case is not an animation and must not be graded as a missing one.
    expect(html).not.toContain("lazy-asset");
    // Contract coverage distinguishes "this version publishes nothing" from "absent".
    expect(html).toContain("not-produced");
    expect(html).toContain("intact");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the inspector names the artifact that no longer matches the commit", async () => {
  const root = await captureFixtureArchive();
  try {
    writeFileSync(join(root, "capabilities.json"), '{"schemaVersion":1,"flags":{}}');
    const html = renderInspector({ archive: await inspectArchive({ path: root }) });

    expect(html).toContain("NOT INTACT");
    // Naming the file is the whole difference between a diagnostic and a red dot.
    expect(html).toContain("capabilities.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the inspector needs no network — nothing is fetched from the page it renders", async () => {
  const root = await captureFixtureArchive();
  try {
    const html = renderInspector({ archive: await inspectArchive({ path: root }) });
    // No external stylesheet, script or image: the page opens from disk with nothing to load.
    expect(html).not.toMatch(/<(script|img|iframe)\b/);
    expect(html).not.toMatch(/https?:\/\/(?!example\.com)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
