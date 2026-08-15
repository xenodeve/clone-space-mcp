---
name: a-control-that-samples-one-side-is-blind-to-the-other
description: The equivalence gate's stability control drove the live page N times and the clone once, so a field steady live and unsteady on the clone was reported as the clone's fault and no number of extra live passes could ever catch it; and four of five proposed fixes were refuted by building them
metadata:
  type: feedback
---

# A control that samples one side is blind to the other

The equivalence gate has a stability control: drive the live page twice, and a field that disagrees
with itself cannot be used to accuse the clone. It is a good mechanism and it is why the gate's
first real-site FAILs were correctly dismissed as noise.

**It drove only the live page.** On `labs.chaingpt.org`, three drives of each side:

```
live    scrollHeight  8544, 8544, 8544   stable
replay  scrollHeight  8486, 8544, 8486   VARIES
```

The live side is rock steady, so the control declared the field stable and sent the difference to
the residual as the clone's fault. **No number of extra live passes could ever have caught it**,
because the live side is not the one that moves. Widening the baseline from two passes to three
fixed the fields that wobble live and did nothing for this one — the fix looked like progress and
addressed a different failure.

**The generalisable test:** when a control establishes that something is trustworthy by sampling,
ask *what it sampled* and *what it is being used to judge*. If it samples A and judges A-against-B,
it is blind to every way B alone can move, and it will attribute B's movement to a difference
between them. Any A/B comparison with a one-sided control has this hole.

The related trap, one line further on: the two groups must be compared **within** themselves and
never against each other. Pooling live and replay passes makes every genuine difference look like
instability, which is the control excusing exactly what it exists to detect.

## The part worth more than the fix

Five approaches were proposed for #182 and four were refuted **by building and measuring them**:

| approach | why it failed |
|---|---|
| a larger plateau constant | one load's opening plateau filled the entire sample budget |
| a frame clock started when sampling begins | the counter started after `goto`, which takes different times per side |
| a frame clock started at page start, both sides | normalising the animation clock de-normalised everything the network drives |
| the union of animation names over the window | the set itself depends on how far the run got |
| stability measured on both sides | partial — it converges, it does not terminate |

The fourth is the one to remember, because the reasoning felt airtight: *a union is monotone, so it
cannot depend on when you look.* It is monotone in **time** and not in **progress** — on a
scroll-driven page, which animations exist at all depends on how far the page got. And the evidence
cited for it was a probe that had **settled first and then listed**, which is a different
measurement from "what ran during a fixed window". Two measurements were treated as one.

**A mechanism proposed is a hypothesis, including one that follows from a property you can name.**
Four of five here survived argument and died on contact with a measurement. See
[[equivalent-but-simpler-needs-evidence]] and [[mechanisms-over-judgment]] — this is the same rule
applied to the design of a control rather than to a refactor.

## What was shipped, stated at its real strength

Fields that cannot be sampled reproducibly are now *reported as unstable* rather than *accusing the
clone*, and the coverage vector says how much of the digest survived. The verdict is `INCOMPLETE`
instead of a false `FAIL` in most runs. It is not reproducible: with three passes a two-valued field
can still hand out three identical draws, so more passes lower the false-accusation rate at linear
cost and cannot reach zero. **That is arithmetic, not a bug left unfixed**, and saying which of the
two it is was the whole point of measuring.
