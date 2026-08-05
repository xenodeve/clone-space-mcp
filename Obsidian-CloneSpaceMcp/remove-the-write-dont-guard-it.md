---
name: remove-the-write-dont-guard-it
description: The mutation runner grew four guards to defend writing a defect into src/; the in-process half was measured not to fire for the kill that caused the incident, and applying the defect in memory deleted the whole problem
metadata:
  type: feedback
---

# Remove the write, don't guard it

`bun run mutate` applied each corpus defect by **writing it into the tracked source file** and restoring afterwards. Over #78 that restore accumulated defences, each one added in response to a real finding:

- a `finally` that puts the original back
- an ownership check, so a second runner cannot restore the *first* runner's mutation
- a read-back after the write, so a write that reports success but does not land is caught
- `SIGINT`/`SIGTERM` handlers, because a signal skips `finally`
- a `git status --porcelain` check before and after, because a hard kill skips the handlers too

Every one of those was justified by something that had actually gone wrong. The stack was still the wrong answer.

## The measurement that settled it

The signal handlers were the tell. They were added *because* a killed process left a defect applied in `src/capture/record.ts` — and then measured, on this platform:

```
Bun.Subprocess.kill()            exitCode=null signalCode=SIGTERM handlerRan=false
process.kill(pid,"SIGINT")       exitCode=1    signalCode=null    handlerRan=false
```

**Neither fires.** The kill that caused the incident was programmatic, so the guard written in response to it never covered it, while the code comment and the report both said it did. A guarantee defended by handlers fails in exactly the case nobody rehearsed.

## What replaced it

`Bun.plugin`'s `onLoad` via `--preload`, and Node's `registerHooks` via `--import`, rewrite the module **source as the runtime loads it**. The file is never written. `--import` reaches the children `node --test` spawns per file, which was measured rather than assumed, because a hook that silently fails to register turns every browser mutation into a false green.

The restore, the ownership check, the read-back, the signal handlers and the git guard were **deleted**, not kept as belt-and-braces. The measurement was re-run and landed on the same 2/400 against 179/400, which is what makes "equivalent" a finding rather than a hope.

## How to apply

- **When a design needs a restore, ask first whether the state change can be made somewhere it does not persist.** In memory, in a child, in a copy. The restore is the cost of writing; it is not the only option.
- **Count the guards.** One guard is a fix. Four guards around a single write, each added after a separate incident, is the design telling you the write is the problem.
- **A guard added in response to an incident must be run against that incident.** These were not, for two days, and the one that mattered did not work. That is `CLAUDE.md`'s unproven-mechanism rule pointed at a guard instead of at a test — see [[mechanisms-over-judgment]].
- **Prefer "cannot happen" to "is detected".** A detected failure still needs a human to read the output and act; an impossible one does not.

See [[a-reviewer-can-rewrite-your-working-tree]] for the incident, and [[a-blocked-method-is-not-a-blocked-task]] for the other half of the same session — both are about checking what a mechanism actually does rather than what it is described as doing.
