import { describe, expect, test } from "bun:test";
import { citeFrame, creationFrame } from "../../src/extract/provenance.ts";

const STACK = [
  "Error",
  "    at Element.animate (<anonymous>:12:22)",
  "    at Ce (https://x.test/vendor/gsap.min.js:10:4021)",
  "    at https://x.test/scene.js:19:6",
  "    at https://x.test/scene.js:40:1",
].join("\n");

describe("creationFrame (#215)", () => {
  test("skips the injected wrapper and the library, landing on the page's call", () => {
    expect(creationFrame(STACK, ["https://x.test/vendor/gsap.min.js"])).toEqual({
      url: "https://x.test/scene.js",
      line: 19,
      column: 6,
    });
  });

  test("without a known library, the innermost readable frame is the citation", () => {
    expect(creationFrame(STACK, [])?.url).toBe("https://x.test/vendor/gsap.min.js");
  });

  test("is absent when no readable frame survives, never a placeholder", () => {
    expect(creationFrame("Error\n    at <anonymous>:1:1", [])).toBeUndefined();
    expect(creationFrame(undefined, [])).toBeUndefined();
  });
});

describe("citeFrame (#215)", () => {
  const frame = { url: "https://x.test/app.js", line: 1, column: 40 };

  test("is original-source only when an archived map resolved the frame", () => {
    const original = { source: "app.ts", line: 7, column: 3, name: "", excerpt: [] };
    expect(citeFrame(frame, () => original)).toEqual({ provenance: "original-source", generated: frame, original });
  });

  test("is generated-source, keeping the generated position, when no map covers it", () => {
    expect(citeFrame(frame, () => undefined)).toEqual({ provenance: "generated-source", generated: frame });
  });

  test("cites nothing for no frame", () => {
    expect(citeFrame(undefined, () => undefined)).toBeUndefined();
  });
});
