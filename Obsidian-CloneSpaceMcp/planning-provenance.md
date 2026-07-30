---
name: planning-provenance
description: Where the archiver plan came from — three multi-agent brainstorm rounds on 2026-07-30 — and which questions it already settled
type: reference
---

The architecture, the phase plan, and the spike list were produced on **2026-07-30** across three
`/clink-brainstorm` rounds with four independent CLI agents, then synthesised. They are not
guesses awaiting a first opinion.

**Already settled — do not re-litigate without new evidence:**

- Replay re-executes the original JavaScript ([[replay-reexecutes-original-js]]).
- `wa:<frame-key>:<sequence>` element identity, injected on both capture and replay, with
  fingerprint reconciliation and an explicit `identity-unresolved` state. Rejected: IDs assigned
  only at capture (replay rebuilds the DOM and order drifts) and pure structural paths (they break
  on duplicate siblings and delete/reinsert).
- Only 3 of the 6 spike questions block phase 1. Q4 and Q5 cannot be measured before their
  implementations exist; Q6 gates nothing. An early round had all six as blocking; one agent
  overturned it, correctly.
- Scope: a lean v1 is roughly three weeks; a full one with SSIM checkpoint gates, several motion
  adapters and network audit is nine to thirteen. Lean was chosen — but the **contracts** were
  adopted from the outset, because they are what is expensive to change later.

**Cut from v1 deliberately:** replaying the interaction transcript (record it — that part is
irreversible if skipped — but do not gate on replaying it), full frame ladders, SPA route graphs,
canvas/WebGL semantics, the coverage pass, un-minification without a published map, and concurrent
replay contexts.

**How to apply:** read `docs/OPEN-WORK-LEDGER.md` for the current phase state; this note only says
where the decisions came from and how much scrutiny they already survived.
