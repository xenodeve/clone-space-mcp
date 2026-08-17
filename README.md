# Clone Space MCP

Archive a live web page so it **replays offline with the motion intact**, and so an AI agent can
read how the page is actually built.

Saving a page from a browser gives you a dead skeleton: the markup survives, the behaviour does
not. `clone-space-mcp` targets the other end — a carousel that still slides, a GSAP timeline that
still runs, a ScrollTrigger that still fires, with the network unplugged. Then it tells you **which
line** makes it move.

**The load-bearing decision** is that replay navigates the **original URL** with the original
document HTML, served from a HAR, so the page's **real JavaScript re-executes**. Serializing the
hydrated DOM into a standalone file is the approach this project rejects: it breaks hydration and
entry animations, which is exactly the fidelity being chased.

## Quick start

```bash
bun install

# 1. archive a page
bun run mcp:call capture_page '{"url":"https://example.com/","outDir":"./out/example"}'

# 2. does it run offline?
bun run mcp:call replay_page '{"archive":"./out/example"}'
# → { "aborted": [], "unservable": 0 }        ← empty is the exit criterion

# 3. what moves, and which line defines it?
bun run mcp:call extract_behaviour '{"archive":"./out/example"}'

# 4. is the archive intact and complete?
bun run mcp:call inspect_archive '{"path":"./out/example"}'

# and, without an agent at all:
bun run inspect ./out/example -o report.html
```

`mcp:call` runs the same functions the MCP server does, with no transport and no agent — so a bug
is reproducible by hand. That constraint was adopted before any MCP code was written
([#8](https://github.com/xenodeve/clone-space-mcp/issues/8)).

### Connecting an agent

The server speaks MCP over stdio. Node, not Bun: three of the four tools drive Playwright
([ADR 0001](docs/adr/0001-node-drives-the-browser-bun-runs-everything-else.md)).

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

---

# What it can actually do

## Capture — `src/capture/`

**An adaptive sweep, bounded so it can always stop.** The sweep scrolls and waits for the page to go
quiet, which is what triggers lazy content. An infinite-scroll or polling page can extend a quiet
window forever, so the sweep runs against a **termination budget** — wall-clock, bytes, nodes,
height and events (`budget.ts`). `termination.json` records the outcome and the reason, so a
**truncated capture is distinguishable from a complete one**. It is `incomplete` if any request went
unanswered, whatever the sweep's own reason was.

**Bounded interaction, with a written refusal policy.** A scroll-through only ever triggers what
scrolling triggers; the effects a reader most wants explained are usually behind a click. So capture
discovers candidates, builds a **pure plan** (`interaction.ts` — the rules live where `bun test` can
reach them), and drives it (`interaction-drive.ts`). The driver **refuses anything it judges
consequential** — cross-origin, downloads, new browsing contexts, file pickers, navigation, form
submission, and controls whose text reads as authentication or destruction, in English and Thai —
and records *the rule and the fact that tripped it*, so a refusal is evidence rather than a gap.

**The observation layer — what the page *does*, not what it shipped** (`instrument.ts`). Hooks
installed **before any page script runs**, at the **browser API layer** rather than at a library.
That last choice is what makes it hold: on `www.chaingpt.org`, `THREE` is not a global — it loads as
an ES module — and every shader was still captured, because everything must pass through WebGL
eventually.

> Measured on `https://www.chaingpt.org/`, replayed offline: **82,613 characters of GLSL**,
> **9 canvas contexts**, **1,510 `addEventListener` registrations**.

A WebGL shader is the sharpest case: the GLSL is assembled at runtime from strings and uniforms, so
it exists in **no archived file** and no reader of files can ever produce it. The call stack is in
the schema from version 1 on purpose — adding it later would leave every earlier observation
unresolvable, and re-capturing a site is not free.

**An interaction transcript** (`transcript.ts`) — bounded, sequence-numbered, and each scroll names
its **container**: the window, or a nested or horizontal scroller. Page coordinates alone cannot say
which thing moved.

**A target inventory** (`targets.ts`) — which OOPIFs, popups, workers and worklets existed, when they
attached and detached, and how they relate.

**An explicit request-normalization policy** (`request-normalization.ts`,
[ADR 0007](docs/adr/0007-normalized-har-fallback-for-logically-identical-requests.md)) — the volatile
query keys replay is allowed to treat as identical. It is a **named list, not a guess**: an ambiguous
normalization is refused rather than resolved.

**Transactional publication.** Everything above is staged, validated, and only then published;
`commit.json` holds a SHA-256 of every other file and is **written last**. It exists only if
publication succeeded, and `inspect_archive` re-checks every hash against the bytes on disk.

## Replay — `src/replay/`

**The original URL, the original JavaScript.** `routeFromHAR(har, { notFound: 'abort' })` serves the
archive and **aborts anything it cannot serve**, so a replay that quietly reaches the live network is
impossible. A request the archive has no usable response for is reported as `unservable` — a fact
about the *archive*, not about this replay.

**`restoreTiming`** holds each response until its recorded **offset from the start of the page
load** — not its own duration, which is what made an earlier attempt time out. A page that measures
itself without ordering that measurement against its own resources can otherwise settle differently
offline ([#187](https://github.com/xenodeve/clone-space-mcp/issues/187)). Off by default: it costs
wall-clock, measured at 825 ms → 4,577 ms on a 146-entry site.

**`instrument`** installs the observation layer on the replay, which is how `extract_behaviour`
recovers a runtime-assembled shader from an archive.

## Extract — `src/extract/`

**A behaviour graph**, not a list of CSS rules (`behaviour.ts`). Each node carries its `mechanism`,
`target`, `name`, `timing` (duration, delay, iterations), `easing`, `library`, and — for a
ScrollTrigger — the trigger detail. It also publishes **`unrepresented`**: what it saw and could not
represent. A graph that silently omitted those would read as a complete description of a page it did
not fully explain.

**Which line, resolved through the archive's own sourcemaps** (`sourcemap.ts`,
`archive-sources.ts`). Every position the runtime reports is in minified coordinates —
`three.module.min.js:12:326662` names line 12 of a file with about fifteen lines. The extractor
follows each script's `sourceMappingURL` **to the response the capture already fetched**, and turns
that into a real file, a real line, and the text written on it:

```
origin    cdn.jsdelivr.net/npm/three@v0.151.3/build/three.module.min.js:12:326662
original  /npm/three@0.151.2/build/three.module.js:18723:5

  18723 | 	gl.shaderSource( shader, string );
```

**Nothing is fetched here.** A map the capture did not take cannot be obtained, and the report says
so rather than reaching for the network.

## Serve — `src/serve/`

Four tools over stdio, a CLI harness that reaches the same functions with no transport, and **a
visual inspector that needs no agent at all** (`inspector.ts`). That last one exists because of a
specific argument: if the only way to see what an archive contains is to ask an agent, then every
question about whether a capture is any good needs an agent in the loop.

The layering is a rule, not a habit: `src/serve/mcp.ts` registers and maps errors and holds nothing
else, `src/serve/tools/` are plain functions a `bun test` can call, and `src/archive/read.ts`
beneath them resolves and parses what capture published — owning no MCP, no transport and no
interpretation, so a tool, a test, a CLI harness and the inspector all reach the same data.

## Element identity — `src/identity/`

Capture and replay have to agree on **which element** they are talking about, across two runs of a
page that rebuilds its own DOM. An injected script assigns a `wa:` id, and a ตัวจับคู่ reconciles the
two runs by fingerprint — reporting **what it could not match** rather than guessing.

A `wa:` id is a **handle within one run, never a key across runs**
([ADR 0002](docs/adr/0002-element-identity-wa-ids-with-fingerprint-reconciliation.md)). Reading it as
a key is how you write a reconciler that compares strings and reports total failure on a good
archive.

## The equivalence gate — `src/equivalence/`

A clone that *looks* right is not a measurement. `bun run equivalence <url>` drives the live page and
the replayed archive **with the same driver in one session**, collects the same digest from both,
and reports:

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

**Four exit codes**, because a boolean folds together things that need opposite responses: `0` PASS
· `1` FAIL, a residual nothing explains · `2` INCOMPLETE, nothing was proven equal · `3` the run
never produced a verdict.

Four properties it holds on purpose:

- **Coverage is a vector, never a score.** A single number averages away exactly the dimension that
  is weak. `listener_execution 0%` above means the run drove no listeners — so that green row is a
  claim about navigation and scrolling **and nothing else**.
- **`unobserved` never counts as `equal`.** A field only one side produced was not compared, and a
  page whose click listeners are never fired must not read as agreement.
- **The live page is driven more than once, as a control.** Fields that disagree with *themselves*
  are reported `unstable` rather than blamed on the clone — and `baselinePasses` publishes how much
  evidence that control had, because a `FAIL` resting on no replay passes and one resting on three
  agreeing passes are different claims.
- **`--measure-perturbation` asks whether instrumenting the page changes the page.** A fourth live
  drive with hooks installed, compared against *every* plain pass. Comparing against one would blame
  the hooks for ordinary run-to-run noise.

The network reading is **reported and never compared**: `performance.getEntriesByType("resource")`
saturates at a 250-entry buffer, and one real site reads 248. Recorded verdicts for three sites are
in [`docs/reports/`](docs/reports/).

---

## Before you point it at anything

**Response bodies are not redacted**
([ADR 0009](docs/adr/0009-response-bodies-are-not-redactable.md)). Credentials, cookies and
known-sensitive request headers are
([ADR 0003](docs/adr/0003-redact-transport-credentials-before-publishing-captures.md)) — but an
archive of a page contains the page, which is the point. **Do not capture an authenticated page, an
internal tool, or anything behind a login** into a directory you would not hand to whoever can read
it.

**`capture_page` refuses to publish an archive served from a private address** — loopback,
link-local, private, unique-local, unspecified, or the CGNAT-shared `100.64.0.0/10` a Tailscale peer
answers from — unless you pass `allowPrivateNetwork`. It reads each HAR entry's `serverIPAddress`, so
it covers a subresource the page fetched itself, not only the URL you asked for. **The whole capture
is discarded, not the offending entry.** Capturing this repo's own fixture site needs the flag,
because it runs on localhost.

**Two things the interaction policy cannot catch**, and no structural rule can: a `type="button"`
whose handler calls `requestSubmit()`, and an `href="#x"` whose handler issues a `DELETE`. Their
consequence lives entirely in JavaScript no attribute describes. Treat an unfamiliar site as
production.

## What an archive is

One directory, all files written `0600`:

| File | What it records |
|---|---|
| `network.har` | Every request and response, bodies attached as separate files |
| `environment.json` | The browser and page environment, split into what was requested, what was observed, and what replay must reproduce |
| `capabilities.json` | Four tri-state flags: service worker, WebSocket, closed shadow root, declared sourcemap |
| `request-normalization.json` | The explicit volatile-query-key policy replay matches against |
| `targets.json` | Which targets existed during capture — OOPIFs, popups, workers — and when |
| `transcript.json` | What the driver did to the page, and what it refused to do, with the rule that refused it |
| `termination.json` | Why the sweep stopped, the budget it stopped against, and how many requests the archive holds no response for |
| `checkpoints.json` | The associations binding all of the above to one coherent run |
| `commit.json` | A SHA-256 of every other file, written last, after validation |

## How it is kept honest

| Mechanism | Scale | What it is |
|---|---|---|
| **Mutation corpus** — `bun run mutate` | **153 entries** | Re-applies a defect that actually happened and requires a named test to go red. A guard no test can fail against is indistinguishable from one that works |
| **Fixture sites** — `bun run fixture:serve` | **3 origins** | Controlled ground truth: motion, capability flags, and a cross-origin surface. Exit criteria are checked here, never on a live site |
| **ADRs** — [`docs/adr/`](docs/adr/README.md) | **9 records** | One per hard-to-reverse decision, including the alternatives rejected |
| **Metamorphic check** — `bun run metamorphic` | a **metric** | Deliberately outside every gate. Correct code still loses matches in some cases, so reporting it as pass/fail would manufacture false confidence in both directions |

Two consequences worth knowing before trusting a green run:

- **More tests written from the same design add no safety.** One defect stayed live while twelve
  tests passed, because every one of them was written from the design that contained it.
- **`SURVIVED` is a finding, and `MUTATION NOT APPLIED` is not `SURVIVED`.** The second means the
  corpus no longer matches the code and measured nothing at all.

## Development

Bun is the package manager and the runtime — except for code that drives a browser, which runs under
Node. Playwright's client does not complete its handshake under Bun; see
[ADR 0001](docs/adr/0001-node-drives-the-browser-bun-runs-everything-else.md) for the measurements
and what was rejected.

| Command | Runtime | What it does |
|---|---|---|
| `bun run verify` | Bun | lint → typecheck → test → browser tests → build. **The ship gate** |
| `bun run mutate [id…]` | Bun | re-apply the corpus; each entry must be caught by its own test |
| `bun run metamorphic` | Bun | the baseline metric above |
| `bun run equivalence <url>` | **Node** | capture → replay → diff one page; four exit codes |
| `bun run inspect <archive>` | **Node** | write a visual inspector page; `--no-extract` needs no browser |
| `bun run mcp:call <tool> <json>` | Node | call one tool with no transport and no agent |
| `bun run mcp:serve` | Node | the stdio MCP server an agent connects to |
| `bun run fixture:serve` | Bun | the fixture site, on three origins |
| `bun run spike` | **Node** | the CDP measurement harness |
| `bun run ci:lock` | Bun | is GitHub Actions still refused for billing — a command, not a memory |
| `bun run verify:status` | Bun | run verify and post the result to the head SHA as `t4-verify` |

## Where to read next

| You want | Open |
|---|---|
| To use the tools well, and know their limits | [`docs/agents/using-the-tools.md`](docs/agents/using-the-tools.md) |
| Why something is built the way it is | [`docs/adr/`](docs/adr/README.md) |
| What is open right now | [`docs/OPEN-WORK-LEDGER.md`](docs/OPEN-WORK-LEDGER.md) |
| What shipped, and what was refuted | [`DONE.md`](DONE.md) |
| Measured verdicts on real sites | [`docs/reports/`](docs/reports/) |
| What a term means here | [`UBIQUITOUS_LANGUAGE.md`](UBIQUITOUS_LANGUAGE.md) — it wins on any naming conflict |
| To work on this repo as an agent | [`CLAUDE.md`](CLAUDE.md) |

## Status

Alpha, and honest about it. All four stages run end to end; what is known-incomplete is tracked
rather than restated here where it would rot — see the
[open issues](https://github.com/xenodeve/clone-space-mcp/issues) and the ledger.

Two limits worth carrying off this page:

- **`listener_execution` is 0% in every recorded equivalence verdict.** No slice drives listeners
  yet, so no green verdict this project has produced is a claim about them.
- **Two replays of one archive can lay out to different heights**
  ([#187](https://github.com/xenodeve/clone-space-mcp/issues/187)) on a page that measures itself
  without ordering that measurement against its own resources. `restoreTiming` removes it and costs
  wall-clock.

## License

Not yet chosen.
