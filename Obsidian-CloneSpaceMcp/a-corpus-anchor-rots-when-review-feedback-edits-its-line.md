---
name: a-corpus-anchor-rots-when-review-feedback-edits-its-line
description: Acting on a review finding can silently invalidate a mutation-corpus anchor written minutes earlier; mutate says FAILED, not SURVIVED, and FAILED reads like noise in a table of CAUGHT
type: feedback
---

A mutation corpus entry names a **literal line of source**. When a review finding changes that
line, the entry stops applying — and the failure mode is not the one the corpus is built to
report.

Measured on #155, inside one session. The entry was:

```
find: "    if (typeof status === \"number\" && status >= 100) continue;"
```

A delegated review found the surrounding logic too wide. Fixing it turned the loop into a ternary,
so that line stopped existing. `bun run mutate` then printed:

```
| unservable-detected-by-a-truthy-status | FAILED |
```

**`FAILED` means the mutation could not be applied. It does not mean the code is unprotected and
it does not mean the code is protected — it means nothing was measured.** That is a third state
next to CAUGHT and SURVIVED, and it is the one that disappears in a column of forty CAUGHT rows.

The generalisation, which is act-on-able before the next time rather than after it:

> **When you change a line because a reviewer asked you to, grep the corpus for it before you
> commit.** The entry you are about to break is most often one you wrote yourself, minutes
> earlier, for the code you are now editing — so nothing about it feels stale.

This is a different cause from [[python-text-mode-rewrites-every-line-ending]], which rots anchors
by rewriting line endings across a whole file. Same symptom, and the same reason it is worth
catching: an anchor that no longer matches turns a measured guarantee back into an assumption
without anything going red.
