---
name: replay-is-a-different-timing-environment
description: An archive served from disk answers instantly, so a page that races its own layout resolves that race differently offline — replay fidelity is about timing as well as bytes, and the difference shows up as an intermittent layout difference with an identical DOM
metadata:
  type: project
---

# A replayed archive is a different timing environment, not just the same bytes

`routeFromHAR` serves every response from disk with **no latency**. The bytes are the ones the site
sent; the *conditions* are not the ones the site was written against, and a page whose own scripts
race the browser will sometimes lose that race the other way.

Measured on `https://labs.chaingpt.org/` (#187). Two replays of **one** archive lay the document out
58 px apart, about one replay in three. The DOM is identical — same element count, same element
paths, the same five loaded font faces, the same images. The whole difference is an inline style the
page's own script wrote:

```
h2  tall : width: 563.422px; height: 115.906px
    short: width: 563.422px; height: 57.9531px
```

115.906 is exactly twice 57.953. The heading is **two lines in one state and one in the other**, and
a script measured it and froze the measurement inline. Live is the two-line state on every load,
because the network gave the layout time to happen first.

**The generalisable claim:** an archive is a faithful copy of *what the browser received* and not of
*when*. Anything on the page that reads a layout value and writes it back — split-text and heading
animations, pinned sections, carousels that size themselves, `ResizeObserver` handlers — is a race
whose outcome the archive does not carry. Byte-for-byte fidelity does not imply behavioural
fidelity, which is the whole reason [[replay-reexecutes-original-js]] is not enough on its own.

**What follows for the gate, and it is the useful half:** a field like `layout.scrollHeight` that
varies between replays of one archive is not a gate defect and no sampling rule fixes it — it does
not move *during* a run. The instrument for it is the stability baseline, and the fix, if one is
wanted, is on the replay side: serve each response no sooner than the archive says it took.

**That fix was built and measured on 2026-08-16 and it does not work as written.** Delaying every
entry by its recorded time, capped at three seconds, makes `page.goto(..., waitUntil: "load")`
exceed its timeout — hundreds of entries, each held back, and the load event never arrives. It was
reverted rather than shipped off-by-default, because an option that times out when you turn it on
is not an option. Any working version has to be **selective** — the document, the stylesheets and
the fonts, the things that gate layout — or scaled down, and both are fitted constants that need
their own measurement first.

**And a trap that cost most of an afternoon.** The effect appears about one replay in three, so
**thirteen replays that all agree is an unremarkable draw, not evidence it is gone.** A session
concluded "not reproduced" from exactly that and nearly stopped. Before calling an intermittent
effect absent, work out what rate your N runs could actually exclude — at one in three, thirteen
clean runs happen about one time in two hundred, which sounds decisive and is not, because the
prior that the earlier observation was real is much stronger than that. The reproducer is committed
as `scripts/replay-height-race.ts` for the same reason: an effect nobody can summon is an effect
nobody can fix. Related: [[evidence-before-claims]], [[verify-where-the-bug-can-reproduce]].
