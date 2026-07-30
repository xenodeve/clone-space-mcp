# clone-space

Archive a live web page so it **replays offline with the motion intact**, and so an AI agent can
read how the page is actually built.

Saving a page from a browser gives you a dead skeleton: the markup survives, the behaviour does
not. `clone-space` targets the other end — a carousel that still slides, a GSAP timeline that
still runs, a ScrollTrigger that still fires, with the network unplugged.

## How it works

| Stage | What it does |
|---|---|
| **capture** | Drives a real headful Chromium over the live page, records a full HAR (`mode: 'full'`, `content: 'attach'`), sweeps the page adaptively to trigger lazy content, and saves the original document HTML, a serialized DOM, sourcemaps, and screenshots. |
| **replay** | Serves the archive with `routeFromHAR(har, { notFound: 'abort' })` and navigates the **original URL**, so the page's real JavaScript re-executes. Nothing reaches the live network. |
| **extract** | Runs against the replay — deterministic and re-runnable — producing a *behavior graph*: animations with target, trigger, timing, easing and library; computed styles; matched CSS; bound listeners; un-minified sources. |
| **serve** | An MCP server with progressive disclosure: a small manifest plus drill-down tools, so an agent can explore a large page without loading all of it. |

The load-bearing decision is that replay re-executes the **original** JavaScript. Serializing the
hydrated DOM into a standalone document is the approach this project rejects: it breaks hydration
and entry animations, which is exactly the fidelity being chased.

## Status

Early. The operating layer and the phase plan are in place; the pipeline is not built yet.
Current work is tracked in [`docs/OPEN-WORK-LEDGER.md`](docs/OPEN-WORK-LEDGER.md) and in the
repo's GitHub issues.

## Development

Bun is the package manager and the runtime — except for code that drives a browser, which runs
under Node. Playwright's client does not complete its handshake under Bun; see
[ADR 0001](docs/adr/0001-node-drives-the-browser-bun-runs-everything-else.md) for the
measurements and what was rejected.

```bash
bun install
bun run verify        # lint → typecheck → test → build — the ship gate (Bun)
bun run spike         # the CDP measurement harness (Node, with the fixture served by Bun)
```

Agents: start with [`CLAUDE.md`](CLAUDE.md).

## License

Not yet chosen.
