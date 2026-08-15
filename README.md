# Clone Space MCP

Archive a live web page so it **replays offline with the motion intact**, and so an AI agent can
read how the page is actually built.

Saving a page from a browser gives you a dead skeleton: the markup survives, the behaviour does
not. `clone-space-mcp` targets the other end — a carousel that still slides, a GSAP timeline that
still runs, a ScrollTrigger that still fires, with the network unplugged.

## What works today

**Capture and serve.** An agent can archive a page over MCP and ask whether the archive is any
good. Replay and extract are not built — see [Status](#status).

```bash
bun install

# archive a page
bun run mcp:call capture_page '{"url":"https://example.com/","outDir":"./out/example"}'
# → { "archive": "…/out/example", "har": "…/out/example/network.har", "url": "…" }

# ask whether that capture is complete
bun run mcp:call inspect_archive '{"path":"./out/example"}'
# → "complete": true, "integrity": { "ok": true, "mismatched": [] },
#   "termination": { "outcome": "complete", "reason": "quiet-window" },
#   plus one row per §6.x contract
```

`mcp:call` runs the same functions the MCP server does, with no transport and no agent — so a bug
is reproducible by hand. That is a constraint the project adopted before writing any MCP code; the
reasoning is in [issue #8](https://github.com/xenodeve/clone-space-mcp/issues/8).

### Connecting an agent

The server speaks MCP over stdio:

```jsonc
{
  "mcpServers": {
    "clone-space": {
      "command": "node",
      "args": ["scripts/mcp-server.ts"],
      "cwd": "/absolute/path/to/clone-space-mcp"
    }
  }
}
```

Node, not Bun: the server registers `capture_page`, which drives Playwright
([ADR 0001](docs/adr/0001-node-drives-the-browser-bun-runs-everything-else.md)).

### The tools

| Tool | What it does |
|---|---|
| `capture_page` | Launches Chromium over the live page, sweeps it adaptively to trigger lazy content, and publishes an archive. Refuses an `outDir` that already exists, refuses UNC paths, and refuses a URL that resolves to a loopback, link-local or private address unless `allowPrivateNetwork` is passed. |
| `inspect_archive` | Reports whether an archive is intact, which §6.x contracts it carries, which artifact failed if the commit no longer verifies, and how the capture terminated. No browser, no network. |

**What an archive contains, and what that means for you.** Credentials, cookies and
known-sensitive headers are redacted ([ADR 0003](docs/adr/0003-redact-transport-credentials-before-publishing-captures.md)). Response bodies are **not** — an
archive of a page contains the page, which is the point. Do not capture an authenticated or
internal page into a directory you would not hand to whoever can read it.

## What an archive is

One directory. `network.har` plus the response bodies it references, and a set of evidence
sidecars, all written `0600`:

| File | What it records |
|---|---|
| `network.har` | Every request and response, bodies attached as separate files |
| `environment.json` | The browser and page environment, split into what was requested, what was observed, and what replay must reproduce |
| `capabilities.json` | Four tri-state flags: service worker, WebSocket, closed shadow root, declared sourcemap |
| `request-normalization.json` | The explicit volatile-query-key policy replay matches against |
| `targets.json` | Which targets existed during capture — OOPIFs, popups, workers — and when |
| `termination.json` | Why the sweep stopped, the budget it stopped against, and how many requests the archive holds no response for — a non-zero count makes the outcome `incomplete` whatever the sweep's own reason was |
| `checkpoints.json` | The associations binding all of the above to one coherent run |
| `commit.json` | A SHA-256 of every other file, written last, after validation |

`commit.json` is what makes the archive transactional: it exists only if publication succeeded, and
`inspect_archive` re-checks every hash against the bytes on disk.

## How the rest is meant to work

| Stage | State |
|---|---|
| **capture** | **Shipped.** Eight of the eleven §6.x archive contracts publish an artifact. §6.6 is a schema only; §6.7 and §6.11 have their schema and no capture wiring yet |
| **replay** | **Not built.** Will serve the archive with `routeFromHAR(har, { notFound: 'abort' })` and navigate the **original URL**, so the page's real JavaScript re-executes |
| **extract** | **Not built.** Will run against replay, producing a behavior graph: animations with target, trigger, timing, easing and library |
| **serve** | **Alpha.** The two tools above, a CLI harness, and a stdio server. The visual inspector is [#128](https://github.com/xenodeve/clone-space-mcp/issues/128) |

The load-bearing decision is that replay re-executes the **original** JavaScript. Serializing the
hydrated DOM into a standalone document is the approach this project rejects: it breaks hydration
and entry animations, which is exactly the fidelity being chased.

## Status

Alpha. Capture and the MCP surface work end to end; the pipeline is not finished. Rather than
restate it here where it would rot, current state lives in
[`docs/OPEN-WORK-LEDGER.md`](docs/OPEN-WORK-LEDGER.md) and the
[open issues](https://github.com/xenodeve/clone-space-mcp/issues).

## Development

Bun is the package manager and the runtime — except for code that drives a browser, which runs
under Node. Playwright's client does not complete its handshake under Bun; see
[ADR 0001](docs/adr/0001-node-drives-the-browser-bun-runs-everything-else.md) for the
measurements and what was rejected.

```bash
bun run verify        # lint → typecheck → test → build — the ship gate
bun run mutate        # re-apply a corpus of real past defects; each must be caught by its own test
bun run spike         # the CDP measurement harness (Node, with the fixture served by Bun)
```

`bun run mutate` is the mechanism this repo trusts over review: a guard that no test can fail
against is indistinguishable from one that works, so every load-bearing guard has a corpus entry
that removes it and names the test that must then go red.

Agents: start with [`CLAUDE.md`](CLAUDE.md).

## License

Not yet chosen.
