---
name: the-corpus-reach-ends-at-the-process-boundary
description: "`bun run mutate` applies a defect in memory to modules the test process loads, so anything running in a child process — a spawned CLI, the Bun fixture server — is unreachable and reports MUTATION NOT APPLIED, which is not SURVIVED and measures nothing"
metadata:
  type: feedback
---

# The mutation corpus reaches only what the test process itself loads

Since #82 a corpus defect is applied **in memory** — `--preload` plus `Bun.plugin` for the bun
entries, `--import` plus `registerHooks` for the browser ones. The tracked file on disk is never
touched, which is the whole point.

The consequence nobody wrote down: **the hook lives in one process, so a module loaded by a
different process never sees it.** Two instances, both measured, both in one day.

- **`test/fixtures/serve.ts`.** The fixture server runs as a **Bun child process** (`CLAUDE.md`'s
  runtime split says so). A `suite: "browser"` entry mutating a fixture route is loaded into the
  Node test process and the route it changed is served from somewhere else entirely.
- **`scripts/equivalence.ts`.** The browser test that covers the command's exit code **spawns** it.
  The first version of that corpus entry reported `MUTATION NOT APPLIED`.

## The fix, where one exists

Forward the parent's instrumentation to the child:

```ts
execFileSync(process.execPath, [...process.execArgv, scriptPath, ...args], { encoding: "utf8" });
```

`process.execArgv` carries the `--import` the corpus runner added, so the child loads the same hook.
That turned `MUTATION NOT APPLIED` into `CAUGHT` on the first re-run.

Where the child is a **different runtime** — the Bun fixture server under a Node test — there is no
equivalent, and the honest move is to say the entry cannot exist rather than ship one that reports a
state nobody reads carefully.

## Why this matters more than it looks

**`MUTATION NOT APPLIED` is reported as `FAILED`, not as `SURVIVED`** — and in a summary table of
forty `CAUGHT` rows it reads like an infrastructure hiccup rather than a check that measured
nothing. It is the same failure mode as
[[a-corpus-anchor-rots-when-review-feedback-edits-its-line]] arriving through a different door: the
entry looks present, the table looks populated, and the guard it names is uncovered.

**Before writing an entry, ask which process will load the file it names.** If the answer is "a
child", the entry needs `execArgv` forwarding or it needs to not exist.

Related: [[a-fixture-edit-can-delete-a-corpus-entry-silently]], [[mechanisms-over-judgment]].
