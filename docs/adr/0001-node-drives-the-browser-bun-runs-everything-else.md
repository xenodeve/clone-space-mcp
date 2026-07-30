# ADR 0001 — Node drives the browser; Bun runs everything else

- **Status:** Accepted (2026-07-30) — implemented for the spike harness; binding on capture and replay when they are written
- **Area:** Infra
- **Related:** #5 (the decision), #3 (where it surfaced), `docs/reports/2026-07-30-cdp-spike.md` (the measurements)

## Context

The repo was set up Bun-only, deliberately, at bootstrap. The pipeline's architecture rests on
Playwright — specifically `recordHar({ mode: 'full', content: 'attach' })` at capture and
`routeFromHAR(har, { notFound: 'abort' })` at replay, which is what lets replay navigate the
**original URL** so the page's real JavaScript re-executes (see
`Obsidian-CloneSpaceMcp/replay-reexecutes-original-js.md`).

While building the spike harness for #3, Playwright turned out not to work under Bun. Measured
on this machine — same script, same Playwright `1.62.0`, same Chromium `151.0.7922.34`:

| Layer | Bun 1.3.14 | Node 22.23.1 |
|---|---|---|
| Raw CDP over websocket, no Playwright client | **OK, 99 ms** | not run |
| `chromium.connectOverCDP` (Playwright client, websocket) | **timeout, 20 s** | not run |
| `chromium.launch` (Playwright client, `--remote-debugging-pipe`) | **timeout, 30 s** | **OK, 68 ms** |

Bun spawns Chromium successfully and speaks CDP in 99 ms, so neither the browser nor Bun's
networking is at fault. The first hypothesis — that `--remote-debugging-pipe` needs extra stdio
descriptors Bun does not wire up — was falsified by the websocket probe, which fails too. The
fault is inside Playwright's client under Bun.

That put a constraint the repo's runtime choice could not satisfy, so the choice had to move.

## Decision

**Node runs anything that drives a browser. Bun runs everything else.**

| Runs under Bun | Runs under Node |
|---|---|
| `bun install`, `bun test`, `bun run lint`, `typecheck`, `build` | capture, replay, and the spike harness |
| the fixture server — `Bun.serve` + `Bun.build` (`test/fixtures/serve.ts`) | anything importing `playwright` |

Two things make the boundary cheap rather than a rewrite:

- Node 22 runs this repo's TypeScript directly (verified), so no build step or second toolchain
  is introduced.
- Where a Node process needs the fixture, it starts it as a **Bun child process** which announces
  its origins on stdout — `scripts/fixture-serve.ts` and `scripts/spike-cdp.ts:startFixtureServers`.
  That pattern was written as a stopgap for one script; this ADR makes it the sanctioned shape.

The ship gate is unchanged: `sh scripts/verify.sh` → lint, typecheck, `bun test`, build, all Bun.
Browser-level suites live in CI (`t4-e2e.yml`, not yet installed — see the ledger), never in the
fast local gate.

## Alternatives considered

- **Stay Bun-only and drop Playwright.** Rejected — it means re-implementing `routeFromHAR`, the
  single mechanism the replay architecture depends on. Raw CDP from Bun does work, so this is
  possible rather than impossible, but it puts the most load-bearing piece of the project on a
  home-grown implementation before anything else exists.
- **Wait for an upstream fix.** Rejected as a plan; not actionable. Nothing was filed or searched
  for, so this ADR should be revisited if Playwright-under-Bun starts working.
- **Node for everything.** Rejected — Bun is already carrying `bun test`, the fixture server's
  in-memory build, and the lockfile with no friction. Moving them would be churn with no
  measured benefit.

## Consequences

- **Positive:** the architecture keeps `recordHar`/`routeFromHAR`, which is what the whole replay
  fidelity claim rests on. The split is stated in one place instead of being rediscovered per
  module.
- **Negative / limits:** two runtimes on the machine and in CI. A Node-side module cannot use
  `Bun.*` APIs, and crossing the boundary means a child process rather than an import — a real
  cost paid at every capture/replay entry point. Contributors need both installed.
- **Follow-ups:** `t4-e2e.yml` will need Node alongside Bun when it is installed. If Playwright
  under Bun is fixed upstream, this ADR is worth reopening — the boundary is the kind of thing
  that quietly ossifies once modules are written around it.

**Scope of the evidence, honestly:** one machine (Windows 11), Bun 1.3.14, Playwright 1.62.0.
Not retested against a Bun canary, and no upstream issue was searched for or filed.
