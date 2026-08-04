import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startFixtureServers, type FixtureServers } from "./serve.ts";

type CapabilityDeclaration = {
  id: string;
  mechanism: string;
  selector: string;
  expect: string;
};

type CapabilityManifest = {
  version: number;
  declares: CapabilityDeclaration[];
};

let servers: FixtureServers;

beforeAll(async () => {
  servers = await startFixtureServers();
});

afterAll(async () => {
  await servers.stop();
});

async function readManifest(): Promise<CapabilityManifest> {
  const manifestFile = Bun.file(new URL("./capability-site/fixture-manifest.json", import.meta.url));
  expect(await manifestFile.exists()).toBe(true);
  return (await manifestFile.json()) as CapabilityManifest;
}

async function servedPage(): Promise<string> {
  const response = await fetch(servers.capability.url);
  expect(response.status).toBe(200);
  return response.text();
}

/** Every fixture id the capability origin actually marks in its served HTML. */
async function servedFixtureIds(url: string): Promise<Set<string>> {
  const response = await fetch(url);
  const ids = new Set<string>();
  await new HTMLRewriter()
    .on("[data-fixture-id]", {
      element(element) {
        const id = element.getAttribute("data-fixture-id");
        if (id) ids.add(id);
      },
    })
    .transform(response)
    .text();
  return ids;
}

describe("the capability fixture agrees with its own manifest", () => {
  test("every declared case is marked in the served page, and nothing extra is", async () => {
    const manifest = await readManifest();
    const declared = new Set(manifest.declares.map((declaration) => declaration.id));
    const served = await servedFixtureIds(servers.capability.url);

    expect([...served].sort()).toEqual([...declared].sort());
  });

  test("every declared id is unique", async () => {
    const manifest = await readManifest();
    const ids = manifest.declares.map((declaration) => declaration.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the manifest covers all four true-side capability mechanisms", async () => {
    const manifest = await readManifest();
    const required = ["service-worker", "websocket", "closed-shadow-root", "sourcemap"];
    const present = new Set(manifest.declares.map((declaration) => declaration.mechanism));

    expect(required.filter((mechanism) => !present.has(mechanism))).toEqual([]);
  });
});

describe("the served page genuinely exercises every capability", () => {
  test("registers a service worker whose script is served by the capability origin", async () => {
    const page = await servedPage();
    expect(page).toContain('navigator.serviceWorker.register("/capability-worker.js")');

    const worker = await fetch(new URL("/capability-worker.js", servers.capability.url));
    expect(worker.status).toBe(200);
    expect(await worker.text()).toContain("self.addEventListener");
  });

  test("constructs an observable WebSocket connection", async () => {
    const page = await servedPage();

    expect(page).toContain(
      'new WebSocket("ws://" + location.hostname + ":9/capability-refused")',
    );
  });

  test("creates a closed shadow root containing content", async () => {
    const page = await servedPage();

    expect(page).toMatch(/attachShadow\(\{\s*mode:\s*["']closed["']\s*\}\)/);
    expect(page).toContain('content.textContent = "closed-shadow-content"');
    expect(page).toContain("shadow.append(content)");
  });

  test("the declared sourcemap script is injected during scrolling and its map is served", async () => {
    const page = await servedPage();
    expect(page).toContain('lateScriptObserver.observe(lateSourcemapTrigger)');
    expect(page).toContain('script.src = "/late-instrumented.js"');

    const scriptUrl = new URL("/late-instrumented.js", servers.capability.url);
    const scriptResponse = await fetch(scriptUrl);
    expect(scriptResponse.status).toBe(200);

    const script = await scriptResponse.text();
    const sourceMappingUrl = script.match(/\/\/# sourceMappingURL=([^\s]+)/)?.[1];
    expect(sourceMappingUrl).toBe("late-instrumented.js.map");

    const mapResponse = await fetch(new URL(sourceMappingUrl!, scriptUrl));
    expect(mapResponse.status).toBe(200);

    const map = (await mapResponse.json()) as {
      version: number;
      mappings: string;
      sources: string[];
    };
    expect(map.version).toBe(3);
    expect(map.mappings.length).toBeGreaterThan(0);
    expect(map.sources.length).toBeGreaterThan(0);
  });
});
