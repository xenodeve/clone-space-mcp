import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { indexArchiveSources } from "../../src/extract/archive-sources.ts";

let root: string;

/** `a.ts` minified to one line, with the map beside it. Worked out by hand, as in sourcemap.test.ts. */
const MAP = JSON.stringify({
  version: 3,
  sources: ["a.ts"],
  sourcesContent: ["export function hero() {\n  return 1;\n}"],
  names: ["hero"],
  mappings: "AAAAA,GAEA",
});

function har(entries: unknown[]): string {
  return JSON.stringify({ log: { version: "1.2", entries } });
}

function entry(url: string, body: { text?: string; file?: string }, mimeType = "text/javascript") {
  return {
    request: { url },
    response: {
      status: 200,
      content: { mimeType, ...(body.text !== undefined ? { text: body.text } : { _file: body.file }) },
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "archive-sources-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("indexArchiveSources", () => {
  test("resolves a position through a map the archive fetched alongside the script", async () => {
    writeFileSync(
      join(root, "network.har"),
      har([
        entry("https://x.test/app.js", { text: "function r(){return 1}\n//# sourceMappingURL=app.js.map" }),
        entry("https://x.test/app.js.map", { text: MAP }, "application/json"),
      ]),
    );
    const index = await indexArchiveSources(root);
    expect(index.resolve("https://x.test/app.js", 1, 1)).toMatchObject({ source: "a.ts", line: 1 });
  });

  test("reads a body stored as a sibling file rather than inline", async () => {
    mkdirSync(join(root, "bodies"));
    writeFileSync(join(root, "bodies", "app.js"), "function r(){return 1}\n//# sourceMappingURL=/m.map");
    writeFileSync(join(root, "bodies", "m.map"), MAP);
    writeFileSync(
      join(root, "network.har"),
      har([
        entry("https://x.test/app.js", { file: "bodies/app.js" }),
        entry("https://x.test/m.map", { file: "bodies/m.map" }, "application/json"),
      ]),
    );
    const index = await indexArchiveSources(root);
    expect(index.resolve("https://x.test/app.js", 1, 1)).toMatchObject({ source: "a.ts" });
  });

  test("refuses a body path that points outside the archive", async () => {
    // A HAR is captured from a site nobody controls. A `_file` escaping the archive root would
    // have the extract phase read an arbitrary file off the machine running it.
    //
    // The traversal must point at a file that really exists and really would be indexed. A first
    // version of this test used `../../../etc/passwd`, which does not exist here — so `readFile`
    // refused it and the test passed identically with the guard deleted. It could not fail, and
    // the corpus said so: `archive-sources-escapes-the-archive` SURVIVED.
    const outside = mkdtempSync(join(tmpdir(), "archive-sources-outside-"));
    try {
      const body = "function r(){}\n//# sourceMappingURL=m.map";
      writeFileSync(join(outside, "app.js"), body);
      writeFileSync(join(root, "inside.js"), body);

      // The control: the identical body, inside the archive, is indexed. Without this the test
      // cannot tell "the guard refused it" from "nothing here was ever indexable".
      writeFileSync(
        join(root, "network.har"),
        har([
          entry("https://x.test/inside.js", { file: "inside.js" }),
          entry("https://x.test/m.map", { text: MAP }, "application/json"),
        ]),
      );
      expect((await indexArchiveSources(root)).mapped).toEqual(["https://x.test/inside.js"]);

      writeFileSync(
        join(root, "network.har"),
        har([
          entry("https://x.test/app.js", { file: relative(root, join(outside, "app.js")) }),
          entry("https://x.test/m.map", { text: MAP }, "application/json"),
        ]),
      );
      expect((await indexArchiveSources(root)).mapped).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("decodes a map inlined as a data: URL", async () => {
    const inline = `data:application/json;base64,${Buffer.from(MAP).toString("base64")}`;
    writeFileSync(
      join(root, "network.har"),
      har([entry("https://x.test/app.js", { text: `function r(){return 1}\n//# sourceMappingURL=${inline}` })]),
    );
    const index = await indexArchiveSources(root);
    expect(index.resolve("https://x.test/app.js", 1, 1)).toMatchObject({ source: "a.ts" });
  });

  test("reports which scripts got a usable map, so a miss is visible rather than silent", async () => {
    writeFileSync(
      join(root, "network.har"),
      har([
        entry("https://x.test/app.js", { text: "function r(){}\n//# sourceMappingURL=app.js.map" }),
        entry("https://x.test/app.js.map", { text: MAP }, "application/json"),
        entry("https://x.test/vendor.js", { text: "function q(){}" }),
      ]),
    );
    const index = await indexArchiveSources(root);
    expect(index.mapped).toEqual(["https://x.test/app.js"]);
  });

  test("resolves nothing for a script with no map, rather than throwing", async () => {
    writeFileSync(join(root, "network.har"), har([entry("https://x.test/v.js", { text: "function q(){}" })]));
    const index = await indexArchiveSources(root);
    expect(index.resolve("https://x.test/v.js", 1, 1)).toBeUndefined();
  });

  test("ignores a declared map the archive never fetched", async () => {
    writeFileSync(
      join(root, "network.har"),
      har([entry("https://x.test/app.js", { text: "function r(){}\n//# sourceMappingURL=absent.map" })]),
    );
    const index = await indexArchiveSources(root);
    expect(index.mapped).toEqual([]);
  });

  test("ignores a declared map whose body is not a sourcemap", async () => {
    writeFileSync(
      join(root, "network.har"),
      har([
        entry("https://x.test/app.js", { text: "function r(){}\n//# sourceMappingURL=app.js.map" }),
        entry("https://x.test/app.js.map", { text: "<!doctype html>404" }, "text/html"),
      ]),
    );
    const index = await indexArchiveSources(root);
    expect(index.mapped).toEqual([]);
  });

  test("returns an empty index for an archive with no HAR at all", async () => {
    const index = await indexArchiveSources(root);
    expect(index.mapped).toEqual([]);
  });

  test("takes the last sourceMappingURL, which is the one a bundler appends", async () => {
    writeFileSync(
      join(root, "network.har"),
      har([
        entry("https://x.test/app.js", {
          text: 'const s = "//# sourceMappingURL=decoy.map";\n//# sourceMappingURL=app.js.map',
        }),
        entry("https://x.test/app.js.map", { text: MAP }, "application/json"),
      ]),
    );
    const index = await indexArchiveSources(root);
    expect(index.mapped).toEqual(["https://x.test/app.js"]);
  });
});
