# ADR 0007 — Normalized HAR fallback for logically identical requests

- **Status:** Accepted — proved by `test/browser/request-normalization.browser.ts` on Playwright 1.62, Node v26.3.1
- **Area:** Capture / replay / archive contract
- **Related:** #85 (probe, this ADR), #84 (PRD), #29 (P2), plan §6.5, ADR 0003, ADR 0004

## Context

Playwright's HAR routing matches a request to an archived entry by **exact URL, exact method, and,
for POST, byte-identical body** (`node_modules/playwright-core/lib/coreBundle.js:55336-55355`). A
fresh nonce, timestamp, CSRF token or UUID query parameter therefore makes a logically identical
request miss, and `routeFromHAR(..., { notFound: "abort" })` aborts it. ADR 0003 compounds this:
attached request bodies and sensitive query values are redacted to `[REDACTED]` before publication,
so a live POST body can never equal its archived twin.

The first §6.5 draft assumed replay could simply hand a normalized URL to `routeFromHAR`. That is
not an API the fixture or the codebase measured. The archive contract must not commit to a replay
mechanism that has not been shown to work against the pinned runtime, because retrofitting it after
archives exist forces a re-capture. ADR 0003 already records the dependency: *"strict HAR replay
cannot match an original POST body or an original signed/query URL after redaction. Contract §6.5
must define request normalization before such requests can replay."*

## Decision

### The consumer contract, measured first

A minimal Node/Playwright probe (`test/browser/request-normalization.browser.ts`) records the
contract before any production capture or replay code exists. The probe owns a temporary origin
server that is **stopped before replay** and asserted down (`server.listening === false`,
`request-normalization.browser.ts:152`), so the archived HTML and every served body must come from
the HAR. A request that reached the live network would fail the page fetch (connection refused),
never produce an archived body.

The probe establishes four observable paths:

1. **Strict baseline (historical RED).** With only `routeFromHAR(..., { notFound: "abort",
   update: false })` registered, a page whose script appends a fresh `Date.now()` nonce fails the
   volatile-query request. Asserted as the baseline abort at
   `test/browser/request-normalization.browser.ts:186-189`.
2. **Normalized match (GREEN).** Register the HAR route first, then a normalizing route that strips
   allowlisted query keys and, when exactly one distinct archived raw URL remains, calls
   `route.fallback({ url: archivedRawUrl })` into the HAR handler
   (`request-normalization.browser.ts:199-222`). The page receives the archived response body —
   `ARCHIVED_ASSET_BODY` — proving the fallback rewrite reaches `routeFromHAR`; only the HAR can
   produce that body with the origin down.
3. **Three fail-closed classifications.** No candidate → `not-in-archive`; a POST whose archived
   body is redacted → `redacted-post-body`; more than one distinct archived raw URL collapsing to
   one normalized key → `ambiguous-normalized-match`. Each aborts before any live-network path.
   Ambiguity is checked before redaction so a collapse is always classified `ambiguous` regardless
   of whether one candidate is redacted (`request-normalization.browser.ts:203-216`).
4. **Network isolation.** The origin server is closed before navigation and asserted down, so a
   live leak is impossible and would read as a failed fetch rather than an archived body.

Registration order is load-bearing: `context.route` unshifts handlers, so registering the
normalizing route **after** `routeFromHAR` makes it run first, and its `route.fallback({ url })`
dispatches into the HAR handler that was registered earlier. This is what the probe pins — the
normalizer never fulfills from or falls through to the live network.

### Measurements

- Runtime: Playwright 1.62, Node v26.3.1, Chromium via `chromium.launch()`.
- Command: `node --test test/browser/request-normalization.browser.ts` — 2/2 tests, deterministic
  across repeated runs; also collected by `bun run test:browser` (the package's browser glob).
- Verified in the same probe file: baseline abort (strict `routeFromHAR` with a fresh nonce),
  normalized fallback serving `ARCHIVED_ASSET_BODY`, and the three abort classifications, all with
  `server.listening === false` asserted before navigation.
- `bun run verify` (lint, typecheck, 150 Bun tests, 28 browser tests, build) passes with the probe
  in place.

### The archive records a policy, not a duplicate index

Capture publishes `request-normalization.json` containing only a versioned, explicit,
default-empty `volatileKeys` list. `network.har` remains the single source of request entries and
response bodies; the artifact carries no URL copies, counts or collision metadata. Replay derives a
normalized in-memory index from the HAR and the policy at startup (PRD #84, issue #86–#91).

### Normalization is exact and explicit, never guessed

The probe strips exactly the one allowlisted key (`_t`, case-sensitively via
`URLSearchParams.delete`) to prove the mechanism. The production key-handling rules below are the
**policy #90 implements and unit-tests**, not claims the probe measured:

- Keys are lowercased and sorted; empty and duplicate keys are rejected.
- A key matches a query parameter case-insensitively and exactly. No separator folding, no regex
  inference, no UUID/timestamp/entropy detection, no built-in list. `_t` and `t` stay distinct.
- Normalization removes every occurrence of an allowlisted key and preserves all other components
  and relative order.
- POST bodies are never normalized or compared; a redacted POST is classified `redacted-post-body`
  and refused.

### The taxonomy

- `normalized-match` — success diagnostic; the request was rewritten to a unique archived raw URL
  and served from the HAR.
- `ambiguous-normalized-match` — two or more distinct archived raw URLs collapse under the policy;
  replay refuses rather than guess.
- `redacted-post-body` — a POST whose archived body was redacted; v1 does not claim it is replayable.
- `not-in-archive` — no archived candidate even after normalization; the real unexpected request.

## Alternatives considered

- **Hand the normalized URL directly to `routeFromHAR`.** Rejected by the probe's design: `routeFromHAR`
  only intercepts the requests the page actually makes. The normalized URL is a lookup key, not a
  network request — it has to be re-injected through `route.fallback({ url })` into the HAR handler,
  which is exactly what the probe measures.
- **Broad built-in volatile-key list.** Rejected in #84 review: keys like `t`, `v`, `cache` are
  frequently semantically meaningful, and silently collapsing them can serve the wrong response.
  Explicit caller policy, default-empty, keeps failure loud.
- **Persist a normalized request index alongside the HAR.** Rejected: it is a second source of
  truth that can drift from the HAR and invalidate response lookups. Deriving it in memory at replay
  keeps the HAR authoritative (ADR 0004's *capture writes, replay reads* split).
- **Try to replay redacted POST bodies.** Rejected: ADR 0003 redaction is content-independent and
  irreversible; no replacement body exists. The archive stays faithful by refusing.
- **Warn instead of abort on ambiguity.** Rejected: serving *some* archived response when the policy
  cannot disambiguate is exactly the silent-wrong-response failure the contract exists to prevent.

## Consequences

- **Positive:** replay can now match a logically identical request through a measured mechanism —
  `route.fallback({ url })` into `routeFromHAR` — with the live network proven unreachable.
- **Positive:** the archive schema carries only a small explicit policy; the HAR remains the single
  request source of truth, so no second index can drift.
- **Positive:** ambiguity, redacted POST and absent requests all fail closed with distinct
  classifications, so a truncated or guessing replay reads as failure rather than success.
- **Negative:** a page whose volatile keys are not allowlisted still aborts at replay; the caller
  must supply the policy, and the archive records the empty list so the gap is auditable.
- **Negative / limit:** redacted POST bodies remain unsupported in v1 by design; such requests abort
  at replay.
- **Negative / limit:** the probe proves the mechanism for GET requests on a local origin. It does
  not exercise cross-origin redirect normalization, navigation-request rewriting, or the production
  index build; those remain for P3, which must re-verify with the real fixture (`motion-site`) and
  the archive's actual `network.har`, and must confirm `routeFromHAR` concurrency under a real page
  (spike Q4).

## Follow-up

- #86 publishes and validates the empty policy artifact.
- #90 adds the pure key/URL operations.
- #91 wires the explicit policy and ambiguity refusal into capture.
- #87 / #92 add fixture ground truth and the Chromium ambiguity proof.
- #93 runs the closeout gates over the complete §6.5 implementation.
