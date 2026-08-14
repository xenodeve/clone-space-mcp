---
name: python-text-mode-rewrites-every-line-ending
description: Editing a file with Python's default text mode on Windows converts the whole file to CRLF; on #117 that silently broke two mutation anchors whose text had not changed, and git normalising on commit hides it from the diff
metadata:
  type: feedback
---

# Python text mode rewrites every line ending in the file

`io.open(path, "w", encoding="utf-8").write(s)` on Windows writes `\r\n` for every `\n`. So a
one-line string replacement performed that way **rewrites the entire file's line endings**, not just
the line it touched.

On #117 this converted `scripts/mutations.ts` and `src/capture/record.ts` to CRLF. Two mutation
corpus entries whose `find` is a **multi-line template literal** then stopped matching — the anchor
text was unchanged, but its embedded newline was now `\r\n` while the target file's was `\n`.
`bun run mutate` reported `MUTATION NOT APPLIED: the corpus no longer matches the code` for entries
the edit had nothing to do with.

**Three properties make this expensive to diagnose rather than merely annoying:**

- **The diff does not show it.** `.gitattributes` pins `* text=auto eol=lf`, so git normalises on
  commit and `git diff` shows only the intended change. The damage exists solely in the working
  tree — which is what every local tool actually reads.
- **The failure names the wrong thing.** "the corpus no longer matches the code" reads as a rotted
  anchor, so the instinct is to re-read the source and rewrite the anchor. The source was correct.
- **It is silent at write time.** Nothing warns, and the file still lints, typechecks and passes
  every test. Only a byte-exact consumer notices.

**Use the Edit tool.** If a script must do it, pass `newline=""` and read with `newline=""` too.
`file <path>` reports the ending, and `sed -i 's/\r$//'` repairs it.

The general rule this belongs to: **a tool that rewrites a whole file to change part of it can
break things the change never mentions.** That is the same shape as
[[remove-the-write-dont-guard-it]] — the risk came from writing the file at all, not from what was
written. And it is the second time this session that a Python-based edit failed quietly rather than
loudly; the earlier one reported success on zero matches.
