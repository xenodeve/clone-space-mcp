import { file } from "bun";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serves the motion and capability fixtures from three distinct origins.
 *
 * Two servers, not one, because spike Q3 asks whether `CSS.getStyleSheetText` can read
 * a stylesheet the page itself cannot. That question only exists when the stylesheet is
 * genuinely cross-origin, and "cross-origin" on localhost means a different port with no
 * CORS header — a same-origin file with a different path would make the whole test
 * vacuous while still looking like it passed.
 *
 * The capability site has its own origin so later tests can add true-side conditions without
 * changing motion-site/, whose missing capabilities are part of its ground truth.
 *
 * Ports are allocated by the OS (`port: 0`) so a stale process or a parallel run can
 * never make this flaky, and the resulting cross-origin URL is injected into the HTML at
 * serve time.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "motion-site");
const CROSS = join(HERE, "cross-origin");
const CAPABILITY = join(HERE, "capability-site");
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
  capability: FixtureOrigin;
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
      if (pathname === "/instrumented.js") {
        return new Response(built.js, { headers: { "content-type": CONTENT_TYPES[".js"]! } });
      }
      if (pathname === "/instrumented.js.map") {
        return new Response(built.map, { headers: { "content-type": CONTENT_TYPES[".map"]! } });
      }
      if (pathname === "/redirect-target.html") {
        return new Response("<script>localStorage.setItem('redirect-secret', 'CROSS_ORIGIN_VALUE')</script>", {
          headers: { "content-type": CONTENT_TYPES[".html"]! },
        });
      }
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
    websocket: {
      message(socket, message) {
        socket.send(message);
      },
    },
    async fetch(req, server) {
      const { pathname } = new URL(req.url);

      if (pathname === "/" || pathname === "/index.html") {
        const html = (await file(join(SITE, "index.html")).text()).replaceAll(
          CROSS_ORIGIN_TOKEN,
          crossOriginUrl,
        );
        return new Response(html, { headers: { "content-type": CONTENT_TYPES[".html"]! } });
      }
      // #173. The three things the observation layer hooks, in one page: a WebGL context, a
      // compiled shader whose GLSL is assembled at runtime, and a listener registration. The
      // fixture had none of these — every WebGL measurement so far came from a real site, which
      // makes it evidence and not a test.
      if (pathname === "/instrumented-case.html") {
        return new Response(
          `<!doctype html><title>instrumented</title><body><canvas id="c" width="32" height="32"></canvas>
           <script>
             document.getElementById("c").addEventListener("pointerdown", () => {});
             const gl = document.getElementById("c").getContext("webgl");
             if (gl) {
               const vs = gl.createShader(gl.VERTEX_SHADER);
               gl.shaderSource(vs, "attribute vec2 p; void main(){ gl_Position = vec4(p,0,1); }");
               gl.compileShader(vs);
             }
           </script>`,
          { headers: { "content-type": CONTENT_TYPES[".html"]! } },
        );
      }
      // #165. A script whose sourcemap is published inline as a `data:` URI — an ordinary and
      // correct way to ship one. Capture used to fetch it through `context.request.get`, which can
      // never be answered and left a permanently unanswered entry in the published HAR.
      if (pathname === "/inline-sourcemap.html") {
        return new Response(
          `<!doctype html><title>inline map</title><body><p>fixture</p>
           <script src="/inline-map.js"></script>`,
          { headers: { "content-type": CONTENT_TYPES[".html"]! } },
        );
      }
      if (pathname === "/inline-map.js") {
        return new Response(
          `globalThis.inlineMapped = 1;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjogMywgInNvdXJjZXMiOiBbImlubGluZS1zb3VyY2UudHMiXSwgIm5hbWVzIjogW10sICJtYXBwaW5ncyI6ICJBQUFBIiwgInNvdXJjZXNDb250ZW50IjogWyJleHBvcnQgY29uc3QgaW5saW5lID0gMTtcbiJdfQ==
`,
          { headers: { "content-type": CONTENT_TYPES[".js"]! } },
        );
      }
      // #156. Accepts the connection and never answers — what a third-party tracker does when
      // capture closes before it replies. The request is fired from a timer rather than a tag so
      // it cannot hold `load`, which is what capture navigates on: the point is a request still
      // open at the observation boundary, not a page that never loads.
      if (pathname === "/unanswered-request.html") {
        return new Response(
          `<!doctype html><title>unanswered</title><body><p>fixture</p>
           <script>setTimeout(() => { fetch("/never-answers"); }, 50);</script>`,
          { headers: { "content-type": CONTENT_TYPES[".html"]! } },
        );
      }
      if (pathname === "/never-answers") {
        return await new Promise<Response>(() => {});
      }
      // #156. Answers, but later than the sweep runs — the case the bounded drain exists to
      // recover. A test pairs this with a tiny wall-clock budget so the sweep is guaranteed to end
      // before the response lands, rather than relying on it losing a race.
      if (pathname === "/late-response.html") {
        return new Response(
          `<!doctype html><title>late</title><body><p>fixture</p>
           <script>fetch("/slow-answer.js");</script>`,
          { headers: { "content-type": CONTENT_TYPES[".html"]! } },
        );
      }
      if (pathname === "/slow-answer.js") {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return new Response("globalThis.slowAnswer = true;", {
          headers: { "content-type": CONTENT_TYPES[".js"]! },
        });
      }
      if (pathname === "/cross-origin-script.html") {
        const script = new URL("/instrumented.js", crossOriginUrl);
        return new Response(`<script src="${script.href}"></script>`, {
          headers: { "content-type": CONTENT_TYPES[".html"]! },
        });
      }
      if (pathname === "/cross-origin-redirect.html") {
        return Response.redirect(new URL("/redirect-target.html", crossOriginUrl), 302);
      }
      if (pathname === "/credential-probe.html" || pathname === "/credential-probe-fail.html") {
        // Build every sentinel from fragments so the response body itself does not
        // contain the value that the archive redactor is expected to remove.
        const html = `<script type="module">
          const value = (kind) => ["FAKE", kind, "SENTINEL"].join("_");
          const request = new XMLHttpRequest();
          request.open("POST", "/credential-probe?AcCeSs_ToKeN=" + value("QUERY"), false);
          request.setRequestHeader("Authorization", "Bearer " + value("AUTH"));
          request.setRequestHeader("Content-Type", "application/json");
          request.send(JSON.stringify({ token: value("REQUEST") }));
          await new Promise((resolve, reject) => {
            const socket = new WebSocket("ws://" + location.host + "/credential-probe-ws");
            socket.addEventListener("open", () => socket.send(value("WEBSOCKET")));
            socket.addEventListener("message", () => { socket.close(); resolve(); });
            socket.addEventListener("error", reject);
          });
          ${pathname === "/credential-probe-fail.html" ? 'window.requestAnimationFrame = () => { throw new Error("fixture sweep failure"); };' : ""}
        </script>`;
        return new Response(html, {
          headers: {
            "content-type": CONTENT_TYPES[".html"]!,
            "set-cookie": "session=FAKE_COOKIE_SENTINEL; HttpOnly",
          },
        });
      }
      if (pathname === "/environment-probe.html") {
        const crossOriginFrame = new URL("/redirect-target.html", crossOriginUrl);
        const html = `<iframe src="${crossOriginFrame.href}"></iframe><script>
          localStorage.setItem("theme", "dark");
          localStorage.setItem("private-local-name", "PRIVATE_LOCAL_VALUE");
          sessionStorage.setItem("panel", "open");
          sessionStorage.setItem("private-session-name", "PRIVATE_SESSION_VALUE");
          for (let index = 0; index < 300; index += 1) {
            const family = (index < 257 ? "Zulu Fixture " : "Alpha Fixture ")
              + String(index).padStart(3, "0");
            document.fonts.add(new FontFace(family, "url(data:font/woff2;base64,d09GMg==)"));
          }
        </script>`;
        return new Response(html, { headers: { "content-type": CONTENT_TYPES[".html"]! } });
      }
      if (pathname === "/credential-probe") {
        await req.text();
        return new Response(null, {
          status: 204,
          headers: { "set-cookie": "response=FAKE_SET_COOKIE_SENTINEL; HttpOnly" },
        });
      }
      if (pathname === "/credential-probe-ws") {
        if (server.upgrade(req)) return;
        return new Response("websocket upgrade failed", { status: 500 });
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

  const observedRequests: Array<{ method: string; url: string }> = [];

  const capability = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      // Record the exact method and request URL for the §6.5 request-normalization ground truth.
      // The test reads this through a debug route and asserts the HAR matches what the server saw.
      if (pathname === "/request-normalization-endpoint") {
        observedRequests.push({ method: req.method, url: req.url });
        return new Response("ok", { headers: { "content-type": "text/plain" } });
      }
      if (pathname === "/__observed-request-urls") {
        // Return a snapshot, not the live array — callers must not observe later mutation.
        return Response.json(observedRequests.slice());
      }
      const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
      if (rel.includes("..")) return new Response("forbidden", { status: 403 });

      const asset = file(join(CAPABILITY, rel));
      if (!(await asset.exists())) return new Response("not found", { status: 404 });
      return new Response(asset, { headers: { "content-type": contentTypeFor(rel) } });
    },
  });

  return {
    primary: originOf(primary),
    crossOrigin: originOf(crossOrigin),
    capability: originOf(capability),
    async stop() {
      await Promise.all([primary.stop(true), crossOrigin.stop(true), capability.stop(true)]);
    },
  };
}
