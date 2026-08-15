---
name: a-selector-is-a-position-not-an-identity
description: A plan that names DOM elements by selector and acts on them later is acting on whatever now occupies that position; on #176 a live page invalidated 28 of 32 selectors while the plan ran, and the fix is to re-read the facts at action time rather than to write better selectors
metadata:
  type: feedback
---

# A selector is a position, not an identity

`src/capture/interaction.ts` discovers candidate elements, a pure policy judges each one's facts,
and `src/capture/interaction-drive.ts` performs the resulting plan a few seconds later. The plan
names each element by a CSS selector, because it must be serializable — the equivalence gate drives
the same plan on both the live and the replayed side.

**Between judgement and action, the selector stops naming the element that was judged.** Measured
on `www.firecrawl.dev`: while a 32-action plan ran, the document grew by about 200 elements and
**28 of the 32 selectors no longer resolved** — every one a full-depth
`html > … > main:nth-child(151) > …` path that any insertion shifts. This was not a hostile page or
an unusual one. It was a marketing site finishing its own mount.

**Two distinct failures share the one cause, and only one of them is visible in a test run.**

- *Coverage.* Each stale selector burned a 2 s Playwright actionability timeout and the run
  performed 4 of 32 actions. That is loud — the numbers are simply bad.
- *Safety.* An insertion can leave a `:nth-child(1)` path pointing at a **different** control, and
  the driver then activates an element the policy never saw. That is silent: the action succeeds,
  the report says `ok`, and nothing anywhere records that the thing pressed was not the thing
  judged. A reviewer found this by construction before the measurement explained it.

**The fix is not better selectors.** Anchoring a path at the nearest ancestor with an `id` helps
and is worth doing, but it only lengthens the odds; the guarantee has to come from re-reading the
element's facts immediately before acting and refusing when they no longer match. `isStale` is
pure, so the comparison is testable without a browser, and a mismatch is recorded as a skip with
its reason rather than a timeout.

**The generalisable test, for any plan that is decided at one moment and executed at another:** ask
what the plan's identifiers *denote*. If they denote a position — a DOM path, an array index, a
line number, a row offset — then the plan is only valid while nothing shifts, and the honest design
re-validates at use rather than assuming. If they denote an identity the target itself carries — an
`id`, a primary key, a content hash — the assumption is sound.

This is [[evidence-before-claims]] applied to a plan rather than a claim: the plan asserts *this
selector is that element*, and the assertion has an expiry nobody wrote down. It is also why the
policy's own guarantee was weaker than its tests suggested — every pure test supplied the candidate
facts by hand, so the gap between "the facts the policy judged" and "the element that receives the
click" could not appear in any of them. See [[review-lanes-have-different-blind-spots]].

Two of the same reviewer's counterexamples are **not** fixed and cannot be by anything structural:
a `type="button"` whose handler calls `requestSubmit()`, and an `href="#x"` whose handler issues a
`DELETE`. Their consequence lives entirely in JavaScript that no discovered fact describes. The
navigation postcondition does not undo either. A policy that reads structure has a floor, and
saying where it is beats implying there is none.
