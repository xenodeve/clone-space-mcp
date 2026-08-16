---
name: a-mutation-run-can-leave-the-defect-behind
description: A corpus entry runs the suite with a guard removed, so any side effect that guard was preventing actually happens — and one that outlives the process makes the next honest run fail and blame the wrong rule
metadata:
  type: feedback
---

# A mutation run can leave the defect's side effect behind

`bun run mutate` removes a guard and runs the suite. The point is that a test goes red. What is
easy to miss is that **everything the guard was preventing also happens for real** — and a side
effect that survives the process is now sitting on the machine when the next ordinary run starts.

On #162 the entry `capture-tool-reaches-the-private-network` removes the private-address refusal.
The test it names captures `http://127.0.0.1:8080/` into `join(tmpdir(), "never-created")` — a
*fixed* path, chosen to express "this must never be created". With the guard removed the capture
proceeds and **publishes a complete archive there**. The mutation is correctly reported CAUGHT, the
run restores the source, and the directory stays.

The next `bun run verify` then failed with:

```
capture_page: C:\Users\xenod\AppData\Local\Temp\never-created already exists — pass a path that does not yet exist
```

**A test asserting the loopback refusal, failing on the "already exists" refusal instead** — a
correct rule firing on a leftover, reading as a broken guard. Nothing in the working tree explains
it, and nothing in the failure names the mutation run that caused it. The fix was one line: give
the directory a unique parent so each run creates its own.

**The generalisable form:** a test that names a fixed path is fine while the code under it refuses
early, and becomes stateful the moment a corpus entry removes that refusal. So the question to ask
of any entry is not only *"does a test catch this"* but **"what does the code do when it is not
stopped, and does any of it outlive the process?"** Files, directories, ports, and anything written
outside a per-run temp directory all qualify.

This is the same shape as [[a-reviewer-can-rewrite-your-working-tree]] — a mechanism with a side
effect on the environment it is measuring — and the same shape as
[[a-fixture-edit-can-delete-a-corpus-entry-silently]] in the other direction: there the corpus
depended on something undeclared, here something undeclared depends on the corpus. Both are cases
where `bun run verify` alone cannot see the interaction, which is the argument for running the
whole corpus rather than the entries a change names.
