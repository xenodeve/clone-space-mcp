# Architecture Decision Records

Each ADR captures one significant, hard-to-reverse decision: its context, what was chosen, the
alternatives rejected, and the consequences. They document decisions **already in the codebase**
(unless marked *pending*), so a new maintainer — human or agent — can recover the *why* without
re-deriving it. A decision that overturns an earlier one marks the old ADR **Superseded**.

| # | Title | Area | Status |
|---|-------|------|--------|
| [0001](0001-node-drives-the-browser-bun-runs-everything-else.md) | Node drives the browser; Bun runs everything else | Infra | Accepted |
| [0002](0002-element-identity-wa-ids-with-fingerprint-reconciliation.md) | `wa:` element identity, with fingerprint reconciliation and an explicit unresolved state | Identity | Accepted — **injection impl pending** (#9) |
| [0003](0003-redact-transport-credentials-before-publishing-captures.md) | Redact transport credentials before publishing captures | Capture / security | Accepted |
| [0004](0004-separate-environment-evidence-from-replay-configuration.md) | Separate environment evidence from replay configuration | Capture / replay / security | Accepted — implemented by #42 |
| [0005](0005-checkpoint-coherence-for-archive-artifacts.md) | Checkpoint coherence for archive artifacts | Capture / archive integrity | Accepted — contract via #45, implementation via #47 |
| [0006](0006-run-scoped-archive-artifacts-and-capability-flags.md) | Run-scoped archive artifacts, and the §6.4 capability contract | Capture / archive integrity | Accepted — contract via #60, implementation via #61–#64 |
| [0007](0007-normalized-har-fallback-for-logically-identical-requests.md) | Normalized HAR fallback for logically identical requests | Capture / replay / archive contract | Accepted — implemented by #85–#93 |
| [0008](0008-target-discovery-is-enabled-after-navigation.md) | Target discovery is enabled after navigation, and what that costs | Capture / §6.9 target inventory | Accepted — records the #117 ordering and its known omission (#122) |
| [0009](0009-response-bodies-are-not-redactable.md) | Response bodies are not redactable, and what that obliges instead | Capture / redaction / tool surface | Accepted — closes #127 finding 3; the choice is archive or not |

## Decisions that will need an ADR before the code lands

These were settled during planning and are hard to reverse. Each gets an ADR at the phase that
implements it, grounded in the code as it is then — not written speculatively now.

| Decision | Phase |
|---|---|
| Replay navigates the **original URL** through `routeFromHAR(..., { notFound: 'abort' })` so real JS re-executes — rather than serializing the hydrated DOM as the bootstrap | replay |
| The remaining **archive contracts** found in the 2026-07-31 review (#21) — ~~capability flags~~ (ADR 0006), ~~request normalization~~ (ADR 0007), `TargetRef`, bounded traces, transactional integrity, target inventory, capture budget | capture |
| Archive schema and behavior-graph schema are versioned **separately**, and raw evidence is retained so a better extractor never forces a re-capture | capture |
| Sourcemaps are fetched during live capture — the page never requests `.map` itself, so they are unobtainable at replay if missed | capture |
| `serviceWorkers: 'block'` at both capture and replay, because HAR routing does not cover SW-intercepted requests | capture |

## Conventions

- Filename: `NNNN-kebab-title.md`, zero-padded. **Numbers must be unique** across *all* branches.
- Body: title line, a status/context bullet block, then `## Context`, `## Decision`,
  `## Alternatives considered`, `## Consequences`.
- Ground every claim in the code as it is **now**; cite `file:line`.
