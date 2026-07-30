---
name: fixture-first-not-real-sites
description: Every phase exit criterion is checked against test/fixtures/motion-site, whose declared animations are known ground truth — not against a live site
type: project
---

Development starts from a **controlled fixture site**, not from a real page, and every phase's
exit criterion is checked against it.

**Why:** on a real site there is no ground truth. "The extractor found 12 animations" is
unfalsifiable — you cannot tell 12-of-12 from 12-of-30. The fixture declares exactly what it
contains, so a miss is visible. It is also the only way to test capture and replay against
duplicate siblings, shadow DOM, iframes, delayed insertion, and delete/reinsert on demand rather
than by hunting for a site that happens to have them.

`test/fixtures/motion-site` must contain: a carousel, a CSS animation, a WAAPI animation, a GSAP
timeline, a ScrollTrigger section, a lazy-loaded asset, a cross-origin stylesheet, dynamic DOM
insertion, and a valid sourcemap.

**How to apply:** a real page is for confidence, never for a pass/fail gate. When an exit criterion
cannot be checked against the fixture, the fixture is missing a case — add it, rather than
downgrading the criterion to a judgement call about a live site.

Related: [[replay-reexecutes-original-js]]
