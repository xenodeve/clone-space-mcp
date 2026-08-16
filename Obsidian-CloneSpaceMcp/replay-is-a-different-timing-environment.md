---
name: replay-is-a-different-timing-environment
description: A page that measures its own layout without waiting for its webfont races, and a replay resolves it differently with an identical DOM; three fixes were refuted, and the fourth — scheduling each response at its recorded offset rather than its duration — took the live case from 5/20 to 0/20 with a control that reproduced in the same session, which is the reading that separates it from the near-miss
metadata:
  type: project
---

# A replayed archive is a different timing environment, not just the same bytes

`routeFromHAR` serves every response from disk with **no latency**. The bytes are the ones the site
sent; the *conditions* are not the ones the site was written against, and a page whose own scripts
race the browser will sometimes lose that race the other way.

**What that does NOT license is a guess about which way.** Both guesses in this note's first draft
were wrong, and both were killed by one command each — see the two measurements below.

Measured on `https://labs.chaingpt.org/` (#187). Two replays of **one** archive lay the document out
58 px apart, about one replay in three. The DOM is identical — same element count, same element
paths, the same five loaded font faces, the same images. The whole difference is an inline style the
page's own script wrote:

```
h2  tall : width: 563.422px; height: 115.906px
    short: width: 563.422px; height: 57.9531px
```

115.906 is exactly twice 57.953. The heading is **two lines in one state and one in the other**, and
a script measured it and froze the measurement inline. The short state is the one where the
**webfont had not applied yet** when the script measured — a fallback face with different metrics
fits the line. Live is the two-line state on every load; a replay is two-line most of the time and
one-line about one run in three.

**The generalisable claim:** an archive is a faithful copy of *what the browser received* and not of
*when*. Anything on the page that reads a layout value and writes it back — split-text and heading
animations, pinned sections, carousels that size themselves, `ResizeObserver` handlers — is a race
whose outcome the archive does not carry. Byte-for-byte fidelity does not imply behavioural
fidelity, which is the whole reason [[replay-reexecutes-original-js]] is not enough on its own.

**What follows for the gate, and it is the useful half:** a field like `layout.scrollHeight` that
varies between replays of one archive is not a gate defect and no sampling rule fixes it — it does
not move *during* a run. The instrument for it is the stability baseline, and the fix, if one is
wanted, is on the replay side: serve each response no sooner than the archive says it took.

**Two versions of that fix were built and measured on 2026-08-16 and both were refuted.**

- **Every entry at its recorded time**, capped at three seconds: `page.goto(..., waitUntil: "load")`
  exceeds its timeout. Hundreds of entries each held back and the load event never arrives.
- **Only what gates layout** — document, stylesheets, fonts — which was the obvious repair and had
  a readable rule behind it rather than a fitted constant. Measured across ten replays of two
  archives: **8486 nine times out of ten**, against roughly one in three without it. It did not fail
  to help; **it made the defect state the normal one.**

Both were reverted rather than shipped off-by-default, because an option that makes things worse
when you turn it on is not an option.

**The second result inverts the mechanism this note first claimed.** "Replay is too fast, so the
script measures too early" predicts that adding latency moves replay *towards* live. It moves it
away. Serving instantly is what usually *produces* the correct two-line state; delaying the font is
what reliably produces the wrong one. So the page is not losing a race that latency would fix — it
**never orders its measurement against font application at all** (no `document.fonts.ready`, no
`FontFaceSet` wait), and live wins by luck that holds every time on the real network. Any fix has
to change *when the page measures*, which is the page's code, or accept that this field varies.

**A third attempt looked like it worked, and the control is the only reason it did not ship.**
The second measurement said the order that matters is *font before script*, so the third held the
**scripts** back instead and left fonts at disk speed. Fifteen replays, fifteen at the live value —
against a baseline that had been failing about one run in three, which is a result you would ship.
Then the control: the same ten replays with the flag **off**, same machine, same hour. **Also ten
out of ten clean.** The defect was simply not reproducing in that window, so the fifteen proved
nothing at all, and the fix was reverted with the other two.

Twenty clean replays in a row after a morning of one-in-three is itself a fact worth carrying: the
rate is not stable across hours, and a *live site* is therefore not a surface a fix for this can be
validated against. What #187 needs before another attempt is a **fixture that reproduces the race
on demand** — a page served with a slow font and a script that measures a heading and freezes its
height — because every candidate fix will otherwise be graded by whichever hour it was run in.

**And a trap that cost most of an afternoon.** The effect appears about one replay in three, so
**thirteen replays that all agree is an unremarkable draw, not evidence it is gone.** A session
concluded "not reproduced" from exactly that and nearly stopped. Before calling an intermittent
effect absent, work out what rate your N runs could actually exclude — at one in three, thirteen
clean runs happen about one time in two hundred, which sounds decisive and is not, because the
prior that the earlier observation was real is much stronger than that. The reproducer is committed
as `scripts/replay-height-race.ts` for the same reason: an effect nobody can summon is an effect
nobody can fix. Related: [[evidence-before-claims]], [[verify-where-the-bug-can-reproduce]].

## The fixture was built, and a fourth candidate survived its control

`/measure-and-freeze.html` (2026-08-16). An image delayed 300 ms server-side, a script that measures
a box on a timer and freezes the result inline. `?at=t100` measures past replay's arrival and short
of live's: **12/12 replays diverge**. `?at=module` measures before the image on both sides: **0/6**.
The two ends are each other's control and both run every time, in one file.

**`restoreTiming` holds each response until the archive says it finished, and it took 12/12 to
0/12** with the control reproducing in the same session — the thing candidate three never had.
It also did not time out where candidate one did: on a 146-entry real site, `goto` went from 825 ms
to **4577 ms** and completed.

**Why candidate one timed out and this did not, which is the reusable part.** It delayed each entry
by its own recorded **duration**, stacking a wait on top of a request that had already started, so
the cost was the *sum* of every entry's duration. This schedules each response at its recorded
**offset from the start of the page load**, so entries that overlapped in the recording overlap
again and the whole replay is bounded by the recorded page load. *Duration and arrival time are not
the same quantity*, and the first attempt failed on the arithmetic rather than on the idea.

## The live case was then measured, and it is the row that was missing

Same day, two invocations of `scripts/live-height-race-graded.ts`, **control and candidate in the
same invocation** so a non-reproducing window shows up as a clean control instead of a false pass:

```
live  8544x3
restoreTiming=false   1/4 · 1/4 · 3/12  off-live      →  5/20
restoreTiming=true    0/4 · 0/4 · 0/12               →  0/20
```

The control reproduced at **25%**, which matches the rate this note recorded from the start — so
unlike the third candidate, the twenty flagged replays were drawn in a window where the defect was
live. **Read it as two counts and one stated calculation:** if the flag changed nothing, twenty
clean draws from a 25% rate has probability `0.75^20 = 0.3%`.

It is still **off by default**, and now for a reason that is a cost rather than a doubt: on that
site it takes a replay from 825 ms to 4577 ms.

## What was not shown until that run, and why the gap mattered

**The fixture reproduces the opposite direction from the live site.** On `labs.chaingpt.org` the
live page is the *resource-applied* state and a replay is sometimes the *not-applied* one. On the
fixture, live is *not-arrived* and replay is *arrived*. Both are the same class — a measurement not
ordered against a resource — but a fix that moves replay toward live on one direction is **not
thereby shown to** on the other, and the earlier measurement in this note is a live case where
adding latency moved it the wrong way.

The first real-site probe measured 8544 with the flag off **and** on — the defect not reproducing
rather than the fix working, which is the same reading candidate three got. Reporting *that* as
success would have repeated the exact mistake this note exists to record. The claim only moved to
**verified** when a later run in the same session had a control that actually failed.

**The transferable rule: a clean candidate is worth nothing until the control in the same session
is dirty.** Not "run a control" — run one and *check that it reproduced*. Both of this issue's
near-misses were clean-candidate-plus-clean-control, and only the second reading distinguishes
them.
