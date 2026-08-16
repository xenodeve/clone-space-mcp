---
name: a-closing-keyword-fires-on-its-prefix
description: "`Closes #171's acceptance criteria 5 and 7` closed #171 — GitHub matches the keyword and the number and ignores the clause that narrows them, so a PR body sentence performs a tracker action the author decided against"
metadata:
  type: feedback
---

# A closing keyword in a PR body is a command, and it fires on its prefix

PR #207's body opened with:

> Closes #171's acceptance criteria **5** and **7**.

The sentence says *two of the criteria*. GitHub read `Closes #171` and **closed the issue** at the
moment the PR merged.

**The clause that narrows it is invisible to the parser.** `Closes`, `Fixes`, `Resolves` and their
variants match a keyword followed by an issue reference; everything after that is prose. Writing
*"closes part of"*, *"closes the first half of"* or *"closes #171's criterion 5"* all close #171.

## Why this one is worth a note

The same session had already recorded the mirror-image failure on **#2** — an issue closed as
`COMPLETED` while its condition was live, with two later comments asserting *"this issue stays
open"* written onto an already-closed issue. That produced
[[a-rule-keyed-on-a-tracker-state-inherits-that-state]] and a `CLAUDE.md` change.

**Hours later the same session did it again**, from the other direction: it decided deliberately not
to close #171, wrote a comment explaining why, and posted that comment onto an issue its own PR body
had closed an hour earlier. **Knowing the failure mode did not prevent it**, because the two look
nothing alike — one is a wrong click, the other is a sentence.

## The rule

- **Mean "closes" → write `Closes #N` and nothing else on that line.**
- **Mean anything narrower → write `Part of #N`.** It is the phrase every other PR in this repo used
  correctly, including four in the same session.
- **After a merge, read the issue's state rather than the PR body's intent.** `gh issue view <n>
  --json state,closedAt` is one command, and it is the only thing that distinguishes *what you meant
  to happen* from *what happened*.

The final state here happened to be right — the work was complete and a closing comment with
evidence went on afterwards — which is exactly why it would have gone unnoticed. **A silent action
that lands on the answer you wanted is still a mechanism you do not control.**

Related: [[a-rule-keyed-on-a-tracker-state-inherits-that-state]], [[evidence-before-claims]].
