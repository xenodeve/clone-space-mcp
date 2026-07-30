# Architecture Decision Records

Each ADR captures one significant, hard-to-reverse decision: its context, what was chosen, the
alternatives rejected, and the consequences. They document decisions **already in the codebase**
(unless marked *pending*), so a new maintainer — human or agent — can recover the *why* without
re-deriving it. A decision that overturns an earlier one marks the old ADR **Superseded**.

| # | Title | Area | Status |
|---|-------|------|--------|
| [0001](0001-node-drives-the-browser-bun-runs-everything-else.md) | Node drives the browser; Bun runs everything else | Infra | Accepted |

## Decisions that will need an ADR before the code lands

These were settled during planning and are hard to reverse. Each gets an ADR at the phase that
implements it, grounded in the code as it is then — not written speculatively now.

| Decision | Phase |
|---|---|
| Replay navigates the **original URL** through `routeFromHAR(..., { notFound: 'abort' })` so real JS re-executes — rather than serializing the hydrated DOM as the bootstrap | replay |
| `wa:<frame-key>:<sequence>` element identity, injected via `addInitScript` on **both** capture and replay, with fingerprint reconciliation and an explicit `identity-unresolved` state | identity |
| Archive schema and behavior-graph schema are versioned **separately**, and raw evidence is retained so a better extractor never forces a re-capture | identity |
| Sourcemaps are fetched during live capture — the page never requests `.map` itself, so they are unobtainable at replay if missed | capture |
| `serviceWorkers: 'block'` at both capture and replay, because HAR routing does not cover SW-intercepted requests | capture |

## Conventions

- Filename: `NNNN-kebab-title.md`, zero-padded. **Numbers must be unique** across *all* branches.
- Body: title line, a status/context bullet block, then `## Context`, `## Decision`,
  `## Alternatives considered`, `## Consequences`.
- Ground every claim in the code as it is **now**; cite `file:line`.
