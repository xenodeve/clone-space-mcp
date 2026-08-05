---
name: a-blocked-method-is-not-a-blocked-task
description: On #78 a whole item was parked as "needs the developer" because reverting a merged fix was assumed to require git reset — the state change was reproducible in-process, and the park was wrong
metadata:
  type: feedback
---

# A blocked method is not a blocked task

**#78** asked for evidence that the corrected metamorphic check discriminates against **#20**, a defect that actually happened. Its acceptance criteria say *"revert #20's fix in a scratch working tree"*.

That was read as **`git reset --hard` on merged code**, which `t4-gate` denies unless `.claude/t4.json` sets `"afk": true` — and the auto-mode classifier denies every edit to that file. So the item was written into a handoff as *"needs the developer in the room"* and left undone.

**It never needed git at all.** `git show 44e2671 -- src/identity/fingerprint.ts` shows #20's fix is **one line**:

```
return [el.frameKey, el.tag, attrs].join("|");                                        // fixed
return [el.frameKey, el.tag, attrs, el.siblingOrdinal, el.textHash ?? ""].join("|");  // the defect
```

A text find/replace with a `finally` that writes the original back reproduces the state and undoes it, and `scripts/mutate.ts` had been doing exactly that for twenty other defects since #53. The measurement ran unattended: **2/400 fixed, 179/400 with the defect restored, 89.5× separation.**

## The error, stated so it is act-on-able

**"This task requires a blocked operation" is two claims, and only the second was checked.** The task requires a *state* — the tree carrying the old code. The operation is one way to reach that state. Parking on the operation skips the question of whether any other route reaches the same state.

The tell is the shape of the sentence: *"it needs `git reset`"*, *"it needs the flag we cannot set"*, *"it needs a browser we cannot drive"*. Each names a mechanism. Ask what **state** it was going to produce, then ask what else produces it.

## How to apply

- **Before parking on a blocked tool, name the state the tool was for.** Then ask whether the repo already has a mechanism that reaches it — here the mutation corpus, which existed and was built for precisely this.
- **Reversibility is the property that matters, not the tool.** A change applied and undone in a `finally`, verified with `git status --porcelain` afterwards, is *safer* than a `git reset`, not a worse substitute for it. The probe that proved the restore worked also proved it left no diff.
- **Re-derive a park from the issue text, never from a previous message.** This park survived two handoffs and a compaction because each retelling carried the conclusion and not the reasoning — the same laundering failure `t4-dev-workflow` describes for verdicts.

See [[equivalent-but-simpler-needs-evidence]] — the mirror image: there a design claim was accepted without a probe, here a blocker was accepted without one. Both are claims about behaviour, and both cost a probe to settle.
