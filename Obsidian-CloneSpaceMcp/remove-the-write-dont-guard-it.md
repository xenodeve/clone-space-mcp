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

`Bun.plugin`'s `onLoad` via `--preload`, and Node's `registerHooks` via `--import`, rewrite the module **source as the runtime loads it**. The file is never written.

**Both runtime claims are pinned by tests that run the runner's own commands**, not an approximation of them — `bun test --preload …` and `node --test --import …`, the second over two fixture files so it shows the hook registers in each per-file child `node --test` spawns. The first version of that test used `bun run` and a bare `node <file>` instead, which would have stayed green while every real mutation reported SURVIVED.

The restore, the ownership check, the read-back, the signal handlers and the git guard were **deleted**, not kept as belt-and-braces. The measurement was re-run and landed on the same 2/400 against 179/400, which is what makes "equivalent" a finding rather than a hope.

## What the move cost, and how it was bought back

Writing to disk gave one guarantee for free: a rotted anchor failed **before the suite started**, whatever the suite imported. A load hook only fires if something loads the file, so an entry whose target no test imports would have come back `SURVIVED` — a plausible-looking verdict on a defect that was never applied. `/scrutinize` found this; it was latent rather than live, because all four target files happen to be imported today.

The fix is five lines: the hook prints a **positive** token when it rewrites, and the runner treats its absence as NOT APPLIED. **Look for what the old design gave you for nothing before you delete it** — the guarantee was not in the guards that were removed, it was in the write itself.

## How to apply

- **When a design needs a restore, ask first whether the state change can be made somewhere it does not persist.** In memory, in a child, in a copy. The restore is the cost of writing; it is not the only option.
- **Count the guards.** One guard is a fix. Four guards around a single write, each added after a separate incident, is the design telling you the write is the problem.
- **A guard added in response to an incident must be run against that incident.** These were not, for two days, and the one that mattered did not work. That is `CLAUDE.md`'s unproven-mechanism rule pointed at a guard instead of at a test — see [[mechanisms-over-judgment]].
- **Prefer "cannot happen" to "is detected".** A detected failure still needs a human to read the output and act; an impossible one does not.

See [[a-reviewer-can-rewrite-your-working-tree]] for the incident, and [[a-blocked-method-is-not-a-blocked-task]] for the other half of the same session — both are about checking what a mechanism actually does rather than what it is described as doing.
