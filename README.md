# Clone Space MCP

Archive a live web page so it **replays offline with the motion intact**, and so an AI agent can
read how the page is actually built.

Saving a page from a browser gives you a dead skeleton: the markup survives, the behaviour does
not. `clone-space-mcp` targets the other end — a carousel that still slides, a GSAP timeline that
still runs, a ScrollTrigger that still fires, with the network unplugged.

**The load-bearing decision** is that replay navigates the **original URL** with the original
document HTML, served from a HAR, so the page's **real JavaScript re-executes**. Serializing the
hydrated DOM into a standalone file is the approach this project rejects: it breaks hydration and
entry animations, which is exactly the fidelity being chased.

## What works today

All four pipeline stages run. An agent can archive a page, replay it offline, extract what moves
and where it is defined, and ask whether the archive is any good.

```bash
bun install

# 1. archive a page
bun run mcp:call capture_page '{"url":"https://example.com/","outDir":"./out/example"}'
# → { "archive": "…/out/example", "har": "…/network.har", "url": "…" }

# 2. does it run offline?
bun run mcp:call replay_page '{"archive":"./out/example"}'
# → { "aborted": [], "unservable": 0 }        ← empty is the exit criterion

# 3. what moves, and which line defines it?
bun run mcp:call extract_behaviour '{"archive":"./out/example"}'

# 4. is the archive intact and complete?
bun run mcp:call inspect_archive '{"path":"./out/example"}'
# → "complete": true, "integrity": { "ok": true, "mismatched": [] },
#   "termination": { "outcome": "complete", "reason": "quiet-window" }
```

`mcp:call` runs the same functions the MCP server does, with no transport and no agent — so a bug
is reproducible by hand. That constraint was adopted before any MCP code was written; the reasoning
is in [issue #8](https://github.com/xenodeve/clone-space-mcp/issues/8).

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

Node, not Bun: three of the four tools drive Playwright
([ADR 0001](docs/adr/0001-node-drives-the-browser-bun-runs-everything-else.md)).

### The four tools

| Tool | Runtime | Answers |
|---|---|---|
| `capture_page` | Node | archive this URL |
| `replay_page` | Node | does the archive run offline |
| `extract_behaviour` | Node | what moves, what drives it, **which line** |
| `inspect_archive` | Bun | what is in the archive, and is it complete |

**The order is not a suggestion.** `extract_behaviour` runs the page *in a replay*, because a GSAP
timeline is written down nowhere in the archive — it exists only once the page's own JavaScript has
built it. Reading the HAR recovers source text that *might* create motion; running the page recovers
the motion that *did*.

`docs/agents/using-the-tools.md` is the long version: what each tool answers, and in equal detail
**what it cannot**.

### What "which line" actually returns

`extract_behaviour` reports each compiled shader with `origin` — where the runtime says the call
came from — and `original`, that same point carried back through a sourcemap **the archive
captured**. Measured on `https://www.chaingpt.org/`, 6 shaders, 6 cited:

```
origin    cdn.jsdelivr.net/npm/three@v0.151.3/build/three.module.min.js:12:326662
original  /npm/three@0.151.2/build/three.module.js:18723:5

  18723 | 	gl.shaderSource( shader, string );
```

## Before you point it at anything

**Response bodies are not redacted** ([ADR 0009](docs/adr/0009-response-bodies-are-not-redactable.md)).
Credentials, cookies and known-sensitive request headers are
([ADR 0003](docs/adr/0003-redact-transport-credentials-before-publishing-captures.md)) — but an
archive of a page contains the page, which is the point. **Do not capture an authenticated page, an
internal tool, or anything behind a login** into a directory you would not hand to whoever can read
it.

**`capture_page` refuses to publish an archive served from a private address** — loopback,
link-local, private, unique-local, unspecified, or the CGNAT-shared `100.64.0.0/10` a Tailscale peer
answers from — unless you pass `allowPrivateNetwork`. It reads each HAR entry's `serverIPAddress`,
so it covers a subresource the page fetched itself, not only the URL you asked for. **The whole
capture is discarded, not the offending entry.** Capturing this repo's own fixture site needs the
flag, because it runs on localhost.

**The interaction driver refuses to activate anything it judges consequential** — cross-origin,
downloads, new browsing contexts, file pickers, navigation, form submission, and controls whose text
reads as authentication or destruction, in English and Thai. Two things no structural rule can
catch: a `type="button"` whose handler calls `requestSubmit()`, and an `href="#x"` whose handler
issues a `DELETE`. Treat an unfamiliar site as production.

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
| `transcript.json` | What the driver did to the page, and what it refused to do, with the rule that refused it |
| `termination.json` | Why the sweep stopped, the budget it stopped against, and how many requests the archive holds no response for — a non-zero count makes the outcome `incomplete` whatever the sweep's own reason was |
| `checkpoints.json` | The associations binding all of the above to one coherent run |
| `commit.json` | A SHA-256 of every other file, written last, after validation |

`commit.json` is what makes the archive transactional: it exists only if publication succeeded, and
`inspect_archive` re-checks every hash against the bytes on disk.

## The equivalence gate

A clone that *looks* right is not a measurement. `bun run equivalence <url>` drives the live page
and the replayed archive **with the same driver in one session**, collects the same digest from
both, and reports a verdict beside a coverage vector:

```
equivalence FAIL  https://labs.chaingpt.org/

residual (1)
  layout.scrollHeight  live 8544  replay 8486
unstable (0)
baseline    live 3  replay 3
network     live 248 req / 27 origins   replay 248 req / 28 origins

coverage
  scroll              100%
  motion_settled      100%
  stable_fields       100%
  interaction         100%
  listener_execution    0%
```

**Four exit codes, because a boolean folds together things that need opposite responses.** `0` PASS
· `1` FAIL, a residual nothing explains · `2` INCOMPLETE, nothing was proven equal · `3` the run
never produced a verdict at all.

Three properties it holds on purpose:

- **Coverage is a vector, never a score.** A single number averages away exactly the dimension that
  is weak. `listener_execution 0%` above means the run drove no listeners, so that green row is a
  claim about navigation and scrolling **and nothing else**.
- **`unobserved` never counts as `equal`.** A field only one side produced was not compared, and a
  page whose click listeners are never fired must not read as agreement.
- **The live page is driven more than once, as a control.** Fields that disagree with *themselves*
  are reported `unstable` rather than blamed on the clone. `baselinePasses` publishes how much
  evidence that control had, because a `FAIL` resting on no replay passes and one resting on three
  agreeing passes are different claims.

`--measure-perturbation` adds a fourth live drive **with the observation layer installed**, to
answer whether instrumenting the page changes what the page does. Recorded verdicts for three real
sites are in [`docs/reports/`](docs/reports/).

## Element identity

Capture and replay have to agree on *which element* they are talking about, across two runs of a
page that rebuilds its own DOM. `src/identity/` is that contract: a `wa:` id assigned by an injected
script, and a ตัวจับคู่ that reconciles the two runs by fingerprint and **reports what it could not
match** rather than guessing.

A `wa:` id is a **handle within one run, never a key across runs**
([ADR 0002](docs/adr/0002-element-identity-wa-ids-with-fingerprint-reconciliation.md)). Reading it as
a key is how you write a reconciler that compares strings and reports total failure on a good
archive.

## How it is kept honest

**`bun run mutate` is the mechanism this repo trusts over review.** A guard that no test can fail
against is indistinguishable from one that works, so every load-bearing guard has a corpus entry
that removes it and names the test that must then go red. The corpus is a record of defects that
actually happened, not of ones imagined.

Two consequences worth knowing before you trust a green run:

- **More tests written from the same design add no safety.** One defect stayed live while twelve
  tests passed, because every one of them was written from the design that contained it.
- **`SURVIVED` is a finding, and `MUTATION NOT APPLIED` is not `SURVIVED`.** The second means the
  corpus no longer matches the code and measured nothing at all.

`bun run metamorphic` is a **baseline metric, not an assertion** — correct code still loses matches
in some cases, legitimately, and reporting a metric as a pass/fail manufactures false confidence in
both directions.

## Development

Bun is the package manager and the runtime — except for code that drives a browser, which runs under
Node. Playwright's client does not complete its handshake under Bun; see
[ADR 0001](docs/adr/0001-node-drives-the-browser-bun-runs-everything-else.md) for the measurements
and what was rejected.

| Command | Runtime | What it does |
|---|---|---|
| `bun run verify` | Bun | lint → typecheck → test → browser tests → build. **The ship gate** |
| `bun run mutate [id…]` | Bun | re-apply the corpus of real past defects; each must be caught by its own test |
| `bun run metamorphic` | Bun | the baseline metric above; deliberately outside every gate |
| `bun run equivalence <url>` | **Node** | capture → replay → diff one page; see the exit codes above |
| `bun run inspect <archive>` | **Node** | write a visual inspector page; `--no-extract` skips the replay and needs no browser |
| `bun run mcp:call <tool> <json>` | Node | call one tool with no transport and no agent |
| `bun run mcp:serve` | Node | the stdio MCP server an agent connects to |
| `bun run fixture:serve` | Bun | the controlled fixture site, on three origins |
| `bun run spike` | **Node** | the CDP measurement harness |
| `bun run ci:lock` | Bun | is GitHub Actions still refused for billing — a command, not a memory |
| `bun run verify:status` | Bun | run verify and post the result to the head SHA as `t4-verify` |

## Where to read next

| You want | Open |
|---|---|
| To use the tools well, and know their limits | [`docs/agents/using-the-tools.md`](docs/agents/using-the-tools.md) |
| Why something is built the way it is | [`docs/adr/`](docs/adr/README.md) — one record per hard-to-reverse decision |
| What is open right now | [`docs/OPEN-WORK-LEDGER.md`](docs/OPEN-WORK-LEDGER.md) |
| What shipped, and what was refuted | [`DONE.md`](DONE.md) |
| Measured verdicts on real sites | [`docs/reports/`](docs/reports/) |
| What a term means here | [`UBIQUITOUS_LANGUAGE.md`](UBIQUITOUS_LANGUAGE.md) — it wins on any naming conflict |
| To work on this repo as an agent | [`CLAUDE.md`](CLAUDE.md) |

## Status

Alpha, and honest about it. All four stages run end to end; the parts that are known-incomplete are
tracked rather than restated here where they would rot — see the
[open issues](https://github.com/xenodeve/clone-space-mcp/issues) and the ledger.

Two limits worth carrying out of this page:

- **`listener_execution` is 0% in every recorded equivalence verdict.** No slice drives listeners
  yet, so no green verdict this project has produced is a claim about them.
- **Two replays of one archive can lay out to different heights** on a page that measures itself
  without ordering that measurement against its own resources
  ([#187](https://github.com/xenodeve/clone-space-mcp/issues/187)). `replayArchive` takes
  `restoreTiming` to hold each response until the archive says it arrived; it is off by default
  because it costs wall-clock.

## License

Not yet chosen.
