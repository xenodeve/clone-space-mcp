# ADR 0005 — Checkpoint coherence for archive artifacts

- **Status:** Accepted — landed in #47 / PR #48 (`1322e57`)
- **Area:** Capture / archive integrity
- **Related:** #45 (decision), #29 (P2), plan §6.3, ADR 0003, ADR 0004

## Context

Plan §6.3 requires every archive artifact to carry a `checkpointId`, a frame/document epoch, and a
monotonic timestamp. The reason is load-bearing: `DOMSnapshot`, listeners, library state, styles,
and screenshots are separate probes taken while the page mutates. Without an epoch the archive can
describe a page that never existed, and nothing downstream can detect it.

Today `captureHar` publishes only `network.har` and `environment.json`
(`src/capture/record.ts`). The adaptive sweep counts empty scroll pauses inside the page but does
not write checkpoint identity. Future probes are not implemented yet. ADR 0004 already reads
allowlisted storage "at the final capture checkpoint" and explicitly defers checkpoint identity and
coherence rules to §6.3 so environment collection does not invent a second timing model.

The ADR index lists checkpoint epochs among decisions that need an ADR before code lands. Retrofitting
checkpoint identity after probe artifacts ship would force a re-capture of every existing archive —
the same asymmetry that put all of §6 into the plan before P2.

Two approaches were rejected during the #45 review panel:

- **Embedding checkpoint fields into Playwright HAR JSON.** `network.har` is one continuous record
  spanning the whole adaptive sweep, not one probe per checkpoint. Nonstandard fields also risk
  third-party HAR tooling.
- **A metadata sidecar that leaves published artifacts unbound.** Plan §6.3 says every artifact
  carries the three fields; an unbound `environment.json` would still describe evidence without a
  declared epoch.

## Decision

### What a checkpoint is

A **checkpoint** is an intentional capture moment opened by the producer. Probes recorded while that
checkpoint is open share its `checkpointId`. Coherence means "same declared checkpoint", not a claim
that the DOM was frozen across sequential CDP or Playwright calls. The producer may open multiple
checkpoints in one run (for example during a future multi-probe sweep); v1 must still define the
shape even if the first implementation records only the final checkpoint used for `environment.json`.

### Identifiers and clocks

- **`checkpointId`** is an opaque run-local handle (`cp:<seq>` or equivalent). It is a **handle**
  within one capture run, never a key across runs — the same rule as `wa:` handles.
- **Frame/document epoch** is a producer-recorded identifier for the primary frame/document at
  checkpoint open. The field shape must allow §6.9 multi-target inventory to extend later without
  rewriting the meaning of existing fields. V1 records the primary target only.
- **Monotonic timestamp** is capture-relative time from run start, taken from a host high-resolution
  clock. Wall-clock time is not the coherence clock; if recorded at all, it is separate evidence.

Page JavaScript must not be able to mint or alter `checkpointId`, epochs, or the coherence clock.
Checkpoint metadata is producer integrity evidence, not untrusted page input.

### Artifact layout

Publish a versioned **`checkpoints.json`** beside the other archive artifacts. It lists every
checkpoint in the run with:

- `checkpointId`
- frame/document epoch for the primary target
- monotonic open (and close, when the producer closes the checkpoint)
- the artifact bindings for that checkpoint

`schemaVersion` is an integer with the same reader rules as ADR 0004: reject any value other than the
supported major, reject missing required fields, ignore unknown fields.

**HAR association is run-level.** Do not mutate Playwright `network.har` with nonstandard checkpoint
fields. `checkpoints.json` (and/or capture metadata it owns) records that the continuous HAR spans
the run. The HAR remains evidence of network traffic across checkpoints, not a per-checkpoint probe.

**`environment.json` is bound to the final checkpoint.** Capture continues to collect environment at
the end of the run (ADR 0004). The published document must carry — or unambiguously reference — that
final checkpoint's `checkpointId`, frame/document epoch, and monotonic timestamp. Prefer an additive
nested `checkpoint` object so existing `schemaVersion: 1` readers that ignore unknown fields keep
working. Bump `environment.json` `schemaVersion` only if a v1 reader would misinterpret the shape.

Future probe artifacts (`DOMSnapshot`, listeners, styles, screenshots, library state) must each
carry the three fields (or an equivalent binding that resolves through `checkpoints.json` to the
same three values). An artifact that omits the binding is incomplete.

### Publish validation

Publication stays inside ADR 0003's private-staging boundary. After redaction and before rename,
capture refuses to publish when any of the following hold:

- `checkpoints.json` is missing or fails schema validation;
- `environment.json` lacks a coherent final-checkpoint binding;
- any bound artifact references an unknown `checkpointId`;
- monotonic timestamps within the run are not non-decreasing.

Mismatch fails closed: the archive must look incomplete, never look complete. Soft-success with
missing checkpoint metadata is forbidden.

### Boundary with §6.8 and §6.9

Staging, redaction, and same-filesystem rename remain the publication mechanism (ADR 0003). §6.8's
future hashes, producer/schema versions, and commit marker are out of scope here. §6.3 is
cross-artifact coherence inside a successfully published archive, not crash recovery.

§6.9 multi-target inventory is out of scope except for the requirement that epoch fields be shaped
for later extension. V1 does not invent a second target model.

## Alternatives considered

- **Invent timing ad hoc in the first probe implementation.** Rejected: ADR 0004 already forbids a
  second timing model, and the ADR index requires checkpoint epochs to be decided before code.
- **Stamp custom fields into `network.har`.** Rejected: HAR spans the sweep; custom fields risk HAR
  tooling; Playwright owns the file format.
- **Sidecar only, artifacts unbound.** Rejected: plan §6.3 requires every artifact to carry the
  fields; unbound evidence recreates the original failure mode.
- **Claim instantaneous multi-probe atomicity.** Rejected: sequential probes cannot honestly claim a
  single DOM instant; declared checkpoint identity is the checkable contract.
- **Wall-clock as the coherence clock.** Rejected: `Date.now()` can go backwards and is not
  comparable across hosts; run-local monotonic time is enough for within-run ordering.
- **Combined ADR+implementation without a settled contract.** Rejected for this slice: the schema
  decisions are hard to reverse and were unsettled before this ADR, same reason §6.2 used #39 before
  implementation.

## Consequences

- Implementation must land a producer that writes `checkpoints.json`, binds `environment.json` to the
  final checkpoint, associates HAR at run level without mutating HAR JSON, and fail-closed validates
  before publish. That work is a separate issue after this ADR is Pending in tree.
- Existing archives without checkpoint metadata are pre-contract; they are not upgraded in place.
- Replay (P3) gains a coherence check it can eventually enforce; this ADR does not implement replay.
- Probe slices that ship later inherit the binding rules; they do not redefine checkpoint identity.
