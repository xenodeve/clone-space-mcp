# ADR 0006 — Run-scoped archive artifacts, and the §6.4 capability contract

- **Status:** Pending — contract accepted; capture-side implementation not landed
- **Area:** Capture / archive integrity
- **Related:** #59 (PRD), #60 (this decision), #29 (P2), plan §6.4, ADR 0003, ADR 0005

## Context

Plan §6.4 requires the archive to carry capability flags. The reason it gives is precise: without
them, `extract` returns an **empty behavior graph that reads as success**. A page whose motion lives
behind a service worker, a WebSocket, or a closed shadow root produces nothing for the extractor to
find, and nothing in the archive says why. §6.4 also warns that adding the flags after the tool
manifest ships breaks every consumer — which is why the contract is settled before P4 exists.

Implementing it surfaced a conflict with ADR 0005. That ADR says every archive artifact must carry a
`checkpointId`, a frame/document epoch and a monotonic timestamp, and states plainly that *"an
artifact that omits the binding is incomplete."* The capability document cannot satisfy that
honestly, and the reason is not a special case — it is a second artifact class the archive already
contains without having named it.

**Three of the four flags describe events across the whole run; one describes state at an instant.**
`serviceWorkerDependent`, `webSocketDependent` and `sourcemapDeclared` are true if the condition
occurred at any point during capture. `closedShadowRootPresent` is read from the DOM at one moment.
Binding all four to the final checkpoint's epoch would assert that every field describes that one
document — and a page that navigates itself during the adaptive sweep breaks the assertion silently:
a socket opened in document A would be published under document B's epoch. That is a true statement
filed under the wrong label, which is exactly the incoherence §6.3 exists to detect.

ADR 0005 already contains the precedent, applied once and never generalized: **"HAR association is
run-level."** `network.har` spans the whole sweep, is not a per-checkpoint probe, and is recorded in
`checkpoints.json` as `har: { path, scope: "run" }` with no binding. It was written as a fact about
the HAR. It is a fact about a **class**.

## Decision

### Two artifact classes, and the test that separates them

An archive artifact is **checkpoint-scoped** or **run-scoped**.

- **Checkpoint-scoped** artifacts carry the ADR 0005 binding — `checkpointId`, document epoch,
  monotonic timestamp — because every field in them describes the same declared instant.
  `environment.json` is one.
- **Run-scoped** artifacts carry **no** binding. They describe the capture run as a whole, and
  `checkpoints.json` records their association as `<name>: { path, scope: "run" }`. `network.har`
  is one; `capabilities.json` is the second.

**The test is not taste: *would every field in this artifact still be true if the primary document
changed mid-run?*** If yes, it is run-scoped and must not be bound. If no, it is checkpoint-scoped
and must be. An artifact that binds when it should not is worse than one that omits the binding,
because the binding is read as a guarantee — it manufactures the confidence ADR 0005 was written to
protect.

ADR 0005's *"an artifact that omits the binding is incomplete"* is hereby **scoped to
checkpoint-scoped artifacts**. It was never true of the HAR, which that same ADR exempts two
paragraphs earlier.

### The §6.4 contract

`capabilities.json`, run-scoped, `schemaVersion` an integer with ADR 0004's reader rules — reject any
value other than the supported major, reject missing required fields, ignore unknown fields.

Four flags, each **tri-state**: `true`, `false`, or `"undetermined"`.

| Flag | True when |
|---|---|
| `serviceWorkerDependent` | the page **called** `navigator.serviceWorker.register` |
| `webSocketDependent` | the page opened at least one WebSocket |
| `closedShadowRootPresent` | a closed shadow root exists in the primary document |
| `sourcemapDeclared` | at least one script declared a `sourceMappingURL` |

**A flag is a statement about the page, never about replay fidelity.** P3 and P4 do not exist. What a
service worker means for replay is a conclusion those stages will draw from this evidence; writing
the conclusion here would be recording a guess as a contract, and a contract is the thing that cannot
be changed later without breaking every consumer.

**`"undetermined"` means the probe could not decide, and it is not decoration.** A script whose body
could not be read is not evidence that no sourcemap was declared. Collapsing that into `false` is the
silent failure the whole section exists to prevent; collapsing it into `true` over-reports and makes
every archive look broken on a transient error. Where a flag has no reachable `undetermined`
condition, that must be stated rather than left as surface nothing can produce.

**`sourcemapDeclared`, not `noSourcemap`.** Whether the `.map` bytes are in the archive is visible
from the archive itself and is not a fact about the page. Naming the flag for the page fact keeps the
class boundary above from being crossed by the first field that finds it inconvenient.

### Publish validation

Publication stays inside ADR 0003's private-staging boundary. Capture refuses to publish when:

- `capabilities.json` is missing, unreadable, or not a regular file inside the staging root;
- it is not valid JSON, or its `schemaVersion` is not the supported major;
- any of the four flags is absent, or holds a value that is not exactly `true`, `false` or
  `"undetermined"`;
- the association in `checkpoints.json` is missing or is not `scope: "run"`.

**A flag being `true` or `"undetermined"` must not refuse.** Those are measurement outcomes, not
archive damage. Refusing on them deletes a correct capture, and a validator that blocks honest
evidence teaches the operator to disable it.

### What is measured, and what that settles

Three design questions were decided by running Chromium rather than by argument. A panel of three
model families split on the first, and two of the three were wrong.

```
serviceWorkers=allow | SW cdp events=13 | /sw.js requests=0 | webSocketCreated=1 | closed-root via pierce=true
serviceWorkers=block | SW cdp events= 2 | /sw.js requests=0 | webSocketCreated=1 | closed-root via pierce=true
```

- **CDP `ServiceWorker` domain events fire in both context modes.** Two reviewers asserted they would
  not fire under `serviceWorkers: 'block'`. The detection therefore survives the blocking the plan
  calls for and has not yet set. The network-request fallback a third reviewer proposed is dead —
  zero `/sw.js` requests either way.
- **`DOM.getDocument({ depth: -1, pierce: true })` reports `shadowRootType: "closed"`.**
  `DOMSnapshot.captureSnapshot`, measured at 1.381 MB for 6160 nodes in the 2026-07-30 CDP spike, is
  not needed for one boolean.
- **`navigator.serviceWorker.controller` is false even when a worker registered**, because capture
  always opens a fresh context and is therefore always a first visit. This is why the flag means
  *the page called register* — the other reading would have been a permanent false negative that no
  test on a fresh context could ever catch.

**The page is not instrumented to obtain any of this.** Wrapping `navigator.serviceWorker.register`
through an init script is detectable by the page via `Function.prototype.toString` or function
identity, so a page that checks for a native implementation takes a different branch and capture
records a page that never existed. All three reviewers rejected it independently.

## Alternatives considered

- **Bind `capabilities.json` to the final checkpoint like `environment.json`.** Rejected: three of
  its four fields are run-scoped, so the binding would assert a coherence that a mid-sweep navigation
  breaks. This was the original design and was overturned during the grilling.
- **Put the flags inside `environment.json`.** Rejected: it reuses an existing binding at the cost of
  mixing page facts into a document about the browser and host, and it leaves §6.9's target inventory
  with no natural home either — `environment.json` becomes the drawer everything unclassified goes in.
- **Index `capabilities.json` through `checkpoints.json`'s `artifacts: []`.** Rejected for this
  slice: the per-artifact binding shape is undefined, so this would force that decision here. The
  run-level association already exists and already has a validated implementation.
- **Boolean flags instead of tri-state.** Rejected: `false` and *"the probe failed"* are different
  facts, and the archive already distinguishes them elsewhere (`fontFaces.truncated`, the `omissions`
  block in `environment.json`).
- **Include OOPIF now.** Deferred: it needs a browser-level CDP session `captureHar` does not have,
  and §6.9 already owns target inventory with attach/detach epochs.
- **`DOMSnapshot` for the closed-shadow-root flag.** Rejected on the measured cost — 1.381 MB for one
  boolean, when a single `DOM.getDocument` call answers it.

## Consequences

- Implementation lands as #61 (fixture server serves a second site), #62 (a fixture exercising the
  TRUE side of all four flags), #63 (schema, association, fail-closed validation) and #64 (the
  detections). #62 exists because every flag is currently observable only as `false`, and a flag never
  seen true is a guard that cannot fail — a defect class found four times across #47 and #52.
- `checkpoints.json` gains a required `capabilities` association, which invalidates every existing
  fixture literal in two test files. That is planned for in #63 rather than discovered mid-slice; the
  same schema-tightening trap has bitten this repo three times (`9137565`, #47, #52).
- Existing archives without `capabilities.json` are pre-contract and are not upgraded in place.
- `serviceWorkers: 'block'` stays unset and stays an open decision. Under it, a page's captured
  execution never runs with a worker, so `serviceWorkerDependent: true` would warn about a dependency
  the archive's bytes never exercised. The measurement shows detection survives; whether the flag's
  meaning should change is not settled here.
- Future run-scoped artifacts — §6.7 bounded traces, §6.10 capture budget reasons — now have a class
  to join rather than a precedent to argue for.
