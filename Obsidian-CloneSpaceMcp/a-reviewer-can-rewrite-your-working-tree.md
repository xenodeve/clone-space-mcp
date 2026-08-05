---
name: a-reviewer-can-rewrite-your-working-tree
description: A clink reviewer runs with bypass-approvals — asked about a tool that rewrites files, it ran that tool, and killing it left the mutation applied in src/
metadata:
  type: feedback
---

# A delegated reviewer can rewrite your working tree, and killing it leaves the damage

On **#78** a `codex` reviewer was asked, among other things, *"whether the new `MUTATIONS` entry can interact badly with `scripts/mutate.ts` (which iterates ALL entries and rewrites files in place)"*.

It did the sensible thing: **it ran `bun run mutate`.** `clink` gives codex bypass-approvals, so nothing stopped it. The orchestrator noticed only because an unrelated check printed `M src/capture/record.ts`, and the diff turned out to be a corpus mutation — `closedShadowRootPresent = false` — sitting in the working tree.

`mutate.ts` restores in a `finally`, so a run that ends normally is safe. **`TaskStop` did not end it normally, and neither did it stop the process**: the MCP task was reported stopped while `codex` (pid 39460) kept running with a swarm of node children. Killing the process outright skipped the `finally`, and the mutation stayed applied.

## The two costs, and the second is worse

- **The tree was left holding a known defect.** Recoverable — the diff matched a corpus entry exactly, and `src/` had been verified clean beforehand, so restoring to `HEAD` lost nothing.
- **Every measurement taken during that window became untrustworthy.** A `bun run mutate` result of 21/21 CAUGHT had already been recorded and used as evidence that a refactor was behaviour-preserving. It overlapped the reviewer's own run, on the same files. The number was probably right and was **no longer evidence**, so it had to be re-run on a quiet tree.

## How to apply

- **Tell a reviewer not to run repo-mutating commands.** Reading is what a review needs. A line like *"read only — do not run any command that writes to the repository"* costs nothing and removes the whole failure mode.
- **Never take a measurement while a delegate is running against the same checkout.** Concurrency does not usually corrupt the result; it always corrupts the *evidence*, because you cannot afterwards say what state the tree was in.
- **Check `git status` before and after any delegated round**, not only at commit time. Between those two points is the only place this is visible.
- **A stopped MCP task is not a stopped process.** Confirm with the process list, and expect a `finally` to have been skipped when you kill one.

This is the concurrency half of [[delegate-to-clink-including-verification]]. `CLAUDE.md` already keeps the git and PR commands with the orchestrator because the gate only sees what the orchestrator runs — this is the wider case: **anything that writes to the checkout belongs to the orchestrator**, gate or no gate. See also [[a-blocked-method-is-not-a-blocked-task]], which is the same measurement discipline pointed at a park rather than at a delegate.
