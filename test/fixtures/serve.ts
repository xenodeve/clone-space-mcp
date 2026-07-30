import { file } from "bun";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serves the motion fixture from two distinct origins.
 *
 * Two servers, not one, because spike Q3 asks whether `CSS.getStyleSheetText` can read
 * a stylesheet the page itself cannot. That question only exists when the stylesheet is
 * genuinely cross-origin, and "cross-origin" on localhost means a different port with no
 * CORS header — a same-origin file with a different path would make the whole test
 * vacuous while still looking like it passed.
 *
 * Ports are allocated by the OS (`port: 0`) so a stale process or a parallel run can
 * never make this flaky, and the resulting cross-origin URL is injected into the HTML at
 * serve time.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "motion-site");
const CROSS = join(HERE, "cross-origin");
const GSAP_DIST = join(HERE, "../../node_modules/gsap/dist");

/** Placeholder in index.html, replaced with the real cross-origin URL at serve time. */
const CROSS_ORIGIN_TOKEN = "__CROSS_ORIGIN__";

export interface FixtureOrigin {
  /** Absolute base URL, with a trailing slash. */
  url: string;
  port: number;
}

export interface FixtureServers {
  primary: FixtureOrigin;
  crossOrigin: FixtureOrigin;
  stop(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot === -1 ? undefined : CONTENT_TYPES[path.slice(dot)]) ?? "application/octet-stream";
}

/**
 * Builds the one module that carries a real, published sourcemap.
 *
 * Built in memory rather than to disk on purpose: `.githooks/check-tree-budget` fails on
 * committed build artifacts, and a generated file under `test/` is exactly the kind of
 * thing that gets committed by accident. Minified, because an un-minification story that
 * starts from readable code proves nothing.
 */
async function buildInstrumentedModule(): Promise<{ js: string; map: string }> {
  const result = await Bun.build({
    entrypoints: [join(SITE, "src/instrumented.ts")],
    target: "browser",
    sourcemap: "linked",
    minify: true,
    naming: "instrumented.[ext]",
  });

  if (!result.success) {
    throw new AggregateError(result.logs, "fixture: failed to build instrumented.ts");
  }

  const entry = result.outputs.find((o) => o.kind === "entry-point");
  const map = result.outputs.find((o) => o.kind === "sourcemap");
  if (!entry || !map) {
    throw new Error(
      `fixture: expected an entry-point and a sourcemap, got [${result.outputs.map((o) => o.kind).join(", ")}]`,
    );
  }

  return { js: await entry.text(), map: await map.text() };
}

/**
 * Reads the origin off the server's own `url` rather than its `port`, which is typed
 * `number | undefined` because a Bun server may be bound to a unix socket. Asserting
 * non-null would be a claim; `url` is the value the server actually resolved.
 */
function originOf(server: { url: URL }): FixtureOrigin {
  return { url: server.url.href, port: Number(server.url.port) };
}

export async function startFixtureServers(): Promise<FixtureServers> {
  const built = await buildInstrumentedModule();

  const crossOrigin = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname !== "/theme.css") return new Response("not found", { status: 404 });

      // Deliberately no Access-Control-Allow-Origin: the page must NOT be able to read
      // this sheet's rules from JavaScript, or spike Q3 is testing nothing.
      return new Response(file(join(CROSS, "theme.css")), {
        headers: { "content-type": CONTENT_TYPES[".css"]! },
      });
    },
  });

  const crossOriginUrl = crossOrigin.url.href;

  const primary = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);

      if (pathname === "/" || pathname === "/index.html") {
        const html = (await file(join(SITE, "index.html")).text()).replaceAll(
          CROSS_ORIGIN_TOKEN,
          crossOriginUrl,
        );
        return new Response(html, { headers: { "content-type": CONTENT_TYPES[".html"]! } });
      }

      if (pathname === "/build/instrumented.js") {
        return new Response(built.js, { headers: { "content-type": CONTENT_TYPES[".js"]! } });
      }
      if (pathname === "/build/instrumented.js.map") {
        return new Response(built.map, { headers: { "content-type": CONTENT_TYPES[".map"]! } });
      }

      // GSAP is served out of node_modules rather than vendored into git: the capture
      // phase needs it to be a real third-party subresource request, and that is true
      // either way, so there is no reason to commit a minified copy.
      if (pathname.startsWith("/vendor/")) {
        const name = pathname.slice("/vendor/".length);
        if (name.includes("/") || name.includes("..")) {
          return new Response("forbidden", { status: 403 });
        }
        const asset = file(join(GSAP_DIST, name));
        if (!(await asset.exists())) return new Response("not found", { status: 404 });
        return new Response(asset, { headers: { "content-type": CONTENT_TYPES[".js"]! } });
      }

      // Everything else is a static file under motion-site/, with traversal refused
      // rather than normalised — the fixture serves untrusted-shaped paths by design.
      const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
      if (rel.includes("..")) return new Response("forbidden", { status: 403 });

      const asset = file(join(SITE, rel));
      if (!(await asset.exists())) return new Response("not found", { status: 404 });
      return new Response(asset, { headers: { "content-type": contentTypeFor(rel) } });
    },
  });

  return {
    primary: originOf(primary),
    crossOrigin: originOf(crossOrigin),
    async stop() {
      await Promise.all([primary.stop(true), crossOrigin.stop(true)]);
    },
  };
}
