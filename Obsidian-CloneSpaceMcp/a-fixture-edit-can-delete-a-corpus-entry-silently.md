---
name: a-fixture-edit-can-delete-a-corpus-entry-silently
description: Changing a fixture can remove the only case that made a corpus entry falsifiable, and the corpus reports that as SURVIVED — so a fixture edit needs a corpus run, not just a green suite; and running only the entries a change touches misses rot in the ones it does not
metadata:
  type: feedback
---

# A fixture edit can delete a corpus entry, silently

`bun run mutate` answers one question: *would the tests fail if the code were wrong?* An entry
answers it by naming a defect and a test that must catch it. **What makes the entry work is not the
test alone — it is the fixture case the test exercises.** That third thing is invisible from both
the entry and the test, and it is editable from a file that mentions neither.

On #178 the fixture's shader moved from an inline `<script>` into a minified module with a
sourcemap, so the runtime→source citation had something real to resolve. The suite stayed green.
What the move also did was make the captured stack *readable*, which removed the only case
exercising `shader-origin-invented-when-the-stack-is-unreadable`. The corpus reported **SURVIVED**.
Nothing else did.

**The attempted repair is the more useful half.** A new fixture route compiled the shader inside
`new Function`, on the assumption that generated code yields an unreadable frame. Measured, it
yields `unreadable-origin-case.html:2:14` — the *call site*, which is perfectly readable. Since
`parseStackFrames` returns the innermost **readable** frame and a real page always has one, the
entry's branch is unreachable from any page the fixture can serve. It was deleted rather than kept,
because an entry that cannot fail is not evidence — see [[evidence-before-claims]].

**Three things to do differently, none of them obvious from the failure itself:**

- **A fixture edit is a corpus change.** Run `bun run mutate` after touching `test/fixtures/`, not
  only `bun run verify`. The suite cannot see this: every test still passes, which is the problem.
- **Run the whole corpus, not the entries your change names.** Chunked over the integrated branch it
  found `incomplete-verdict-collapsed-into-pass` rotted since `850310a` on PR #172's *own* branch,
  where a rename of `anyUnobserved` to `inconclusive` left the anchor behind. Nothing in any file
  this session edited points at that entry. Related: [[a-corpus-anchor-rots-when-review-feedback-edits-its-line]].
- **A repointed anchor needs re-running, not just re-reading.** Repointing
  `coverage-claims-an-interaction-it-never-drove` at the coverage *numerator* looked right and
  **SURVIVED**: on a fixture where the clone performs every planned action, the performed count and
  the plan size are the same number. Only the *denominator* encodes the claim that coverage is a
  ratio of driven to planned.

  **What it was left as, and why that is not the same entry.** The repoint was abandoned and the
  rotted anchor stayed, so on `main` the entry answered `MUTATION NOT APPLIED` — reading as one of
  120 passing lines — until #162 ran the whole corpus again. It is now anchored at the numerator
  with the replacement `0` rather than the plan size, which **is** CAUGHT, because zero coverage
  fails the same assertion that full coverage satisfies. That is a different claim from the one the
  entry was written for: it proves the numerator is *what the clone drove* rather than a constant,
  and it still cannot express over-claiming. **An entry whose original claim has no falsifier should
  say so in its own `why`** — otherwise the next reader takes its id at face value, which is exactly
  how a repoint gets abandoned twice.

**The generalisable form:** a mechanism has a dependency it does not declare. Ask what the check is
*standing on* — a fixture, a variable name, a value that happens to differ between two paths — and
whether the thing you are about to edit is that. `FAILED` and `SURVIVED` are both this failure
wearing different clothes: `FAILED` means the entry never ran, `SURVIVED` means it ran against
nothing.
