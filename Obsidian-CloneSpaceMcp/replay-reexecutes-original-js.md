---
name: replay-reexecutes-original-js
description: Replay navigates the original URL and re-executes the page's real JavaScript — serializing the hydrated DOM as the bootstrap is the rejected approach
type: project
---

Replay serves the archive with `routeFromHAR(har, { notFound: 'abort' })` and navigates the
**original URL**, with the **original document HTML**, so the page's own JavaScript runs again.

**Why:** the goal is motion that genuinely works offline — a carousel that slides, a GSAP timeline
that plays, a ScrollTrigger that fires. A serialized snapshot of the hydrated DOM cannot deliver
that: frameworks re-hydrate against markup they did not produce, and entry animations have already
run by the time the snapshot was taken, so they never play. During planning, the agents arguing
for the serialization approach conceded the outcome themselves — *"Interactivity: Nonexistent"*.

`notFound: 'abort'` is part of the contract, not a tuning knob. A request that leaks to the live
network silently poisons extraction: the archive then appears to work while depending on something
it does not contain.

`serviceWorkers: 'block'` is required at **both** capture and replay — HAR routing does not cover
requests a service worker intercepts.

**How to apply:** any proposal that makes the serialized DOM the executable bootstrap is
re-litigating a settled decision; point at this note and the ADR. Extraction runs against replay,
not against capture, so it stays deterministic and re-runnable.

Related: [[fixture-first-not-real-sites]]
