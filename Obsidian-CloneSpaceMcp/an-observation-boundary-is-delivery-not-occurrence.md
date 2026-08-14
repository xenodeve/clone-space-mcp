---
name: an-observation-boundary-is-delivery-not-occurrence
description: A flag that makes listeners ignore events after a point bounds when the callback ran, not when the thing happened; on #117 that left a real page-caused close unrecorded, and the fix is a snapshot at the boundary, not a better flag
metadata:
  type: feedback
---

# An observation boundary is on delivery, not on occurrence

`src/capture/record.ts` bounds every listener with one flag: `observingDependencies` is set to
`false` at a defined point, and each handler returns early after that. It is the right pattern and
it is used consistently — capability flags since #75, and target discovery since `931732b` on #117.

**What the flag actually bounds is when the callback ran.** It says nothing about when the event it
carries occurred. Those are the same thing only if delivery is instant and ordered, which is not
true of CDP: target discovery runs on a *browser-level* session, separate from the page session, so
ordering across the two is not guaranteed. A target the page genuinely destroyed a moment before
the boundary can have its `targetDestroyed` delivered after it and be dropped.

**Both directions of this are worth holding, because only one of them is a defect.**

- Dropping an event *caused by* our own teardown is correct. That is the false record the guard
  exists to remove — a `closedAt` stamped for a window *we* closed.
- Dropping an event *about something that happened inside the window* loses real evidence. It is
  not a false record — an absent `closedAt` truthfully says "still open when the window closed" —
  but it is a coarser one than the run could have produced.

**The fix is not a better flag; it is a snapshot at the boundary.** Ask the browser what still
exists at the instant the window closes (`Target.getTargets`), and anything the run recorded as
created but which is absent from that snapshot is *known* closed. A pull at a known instant is
exact where a filter on a stream of pushes cannot be. This is why deliverable 2 of #117 is not only
a fallback for what discovery missed — it is what makes the boundary exact.

**The generalisable test, before you call any event-driven boundary exact:** ask whether the thing
you are filtering on is the event's *arrival* or the event's *cause*. If the two can separate — any
transport, any queue, any second connection — the boundary is approximate, and the honest move is
to say which direction it errs in. This one errs toward missing evidence rather than inventing it,
which is the direction ADR 0005's fail-closed stance asks for.

Found by a delegated reviewer pressing on a fix that already passed `bun run verify` and
`bun run mutate` — see [[review-lanes-have-different-blind-spots]]. Neither mechanism could have
surfaced it, because both test the code against the same synchronous fake whose ordering the test
chose. That limit is [[evidence-before-claims]] applied to a test double: a fake proves the code
against the ordering you gave it, never against the real transport's.
