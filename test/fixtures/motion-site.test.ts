import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startFixtureServers, type FixtureServers } from "./serve.ts";
import manifest from "./motion-site/fixture-manifest.json" with { type: "json" };

/**
 * The fixture is the project's ground truth, so the thing that must not rot is the
 * agreement between what `fixture-manifest.json` *claims* and what the page actually
 * serves. These tests check that agreement in both directions: the manifest cannot
 * declare a case the page doesn't mark, and the page cannot carry a marked case the
 * manifest doesn't declare.
 *
 * What runs here is deliberately browser-free — HTML, headers, and files. Whether the
 * animations actually play is a browser question and belongs to the spike harness and
 * later to the replay phase; asserting it here would make `bun test` slow and would
 * still not prove replay fidelity.
 */

let servers: FixtureServers;

beforeAll(async () => {
  servers = await startFixtureServers();
});

afterAll(async () => {
  await servers.stop();
});

/** Every element the fixture marks as a declared case, read out of the served HTML. */
async function servedFixtureIds(url: string): Promise<Set<string>> {
  const res = await fetch(url);
  const ids = new Set<string>();
  await new HTMLRewriter()
    .on("[data-fixture-id]", {
      element(el) {
        const id = el.getAttribute("data-fixture-id");
        if (id) ids.add(id);
      },
    })
    .transform(res)
    .text();
  return ids;
}

describe("the fixture agrees with its own manifest", () => {
  test("every declared case is marked in the served page, and nothing extra is", async () => {
    const declared = new Set(manifest.declares.map((d) => d.id));
    const served = await servedFixtureIds(servers.primary.url);

    expect([...served].sort()).toEqual([...declared].sort());
  });

  test("every declared id is unique", () => {
    const ids = manifest.declares.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the manifest covers every mechanism the phase plan depends on", () => {
    // Named explicitly rather than derived from the manifest: this is the one place
    // that is allowed to encode the requirement, so that deleting a case from the
    // fixture fails a test instead of silently shrinking the ground truth.
    const required = [
      "css-keyframes",
      "waapi",
      "gsap-timeline",
      "gsap-scrolltrigger",
      "carousel",
      "lazy-asset",
      "cross-origin-stylesheet",
      "dynamic-insertion",
      "sourcemap",
    ];
    const present = new Set(manifest.declares.map((d) => d.mechanism));

    expect(required.filter((m) => !present.has(m))).toEqual([]);
  });

  test("every identity hard case the plan names is present", () => {
    const required = [
      "duplicate-siblings",
      "shadow-dom",
      "iframe",
      "delayed-insertion",
      "delete-and-reinsert",
    ];
    const present = new Set(manifest.identityCases.map((c) => c.kind));

    expect(required.filter((k) => !present.has(k))).toEqual([]);
  });
});

describe("the cross-origin stylesheet is genuinely cross-origin", () => {
  test("it is served from a different origin than the page", () => {
    expect(new URL(servers.crossOrigin.url).origin).not.toBe(
      new URL(servers.primary.url).origin,
    );
  });

  test("it is served as CSS and carries no CORS header", async () => {
    const res = await fetch(new URL("/theme.css", servers.crossOrigin.url));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    // Without this, the browser would expose cssRules and spike Q3 would be testing
    // nothing — the whole point is a stylesheet the page cannot read from JavaScript.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("the page actually links it", async () => {
    const html = await (await fetch(servers.primary.url)).text();

    expect(html).toContain(servers.crossOrigin.url);
  });
});

describe("the sourcemap is real", () => {
  test("the built bundle links a map and the map parses with mappings", async () => {
    const js = await (await fetch(new URL("/build/instrumented.js", servers.primary.url))).text();
    expect(js).toContain("//# sourceMappingURL=");

    const mapRes = await fetch(new URL("/build/instrumented.js.map", servers.primary.url));
    expect(mapRes.status).toBe(200);

    const map = (await mapRes.json()) as { version: number; mappings: string; sources: string[] };
    expect(map.version).toBe(3);
    expect(map.mappings.length).toBeGreaterThan(0);
    expect(map.sources.length).toBeGreaterThan(0);
  });
});

describe("the lazy asset is below the fold and not requested eagerly", () => {
  test("it is served, and the page references it only via a data attribute", async () => {
    const asset = new URL(manifest.assets.lazyImage, servers.primary.url);
    expect((await fetch(asset)).status).toBe(200);

    // Parsed, not substring-matched: `data-lazy-src="…"` contains `src="…"` as a
    // substring, so a naive `not.toContain` passes and fails for the wrong reasons.
    // Collected onto an object rather than into `let` bindings: TypeScript narrows a
    // local from its initialiser and cannot see the rewriter callback assigning it.
    const attrs: { seen: boolean; src: string | null; lazySrc: string | null } = {
      seen: false,
      src: null,
      lazySrc: null,
    };
    await new HTMLRewriter()
      .on("[data-fixture-id='lazy-hero-panel']", {
        element(el) {
          attrs.seen = true;
          attrs.src = el.getAttribute("src");
          attrs.lazySrc = el.getAttribute("data-lazy-src");
        },
      })
      .transform(await fetch(servers.primary.url))
      .text();

    expect(attrs.seen).toBe(true);
    // A real src= would be fetched while the document is still parsing, which defeats
    // the point: the capture sweep has to be what triggers it.
    expect(attrs.src).toBeNull();
    expect(attrs.lazySrc).toBe(manifest.assets.lazyImage);
  });
});
