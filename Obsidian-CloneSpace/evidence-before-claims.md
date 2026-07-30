---
name: evidence-before-claims
description: The developer requires a run before a claim; several confident conclusions here have been overturned by a single A/B test
type: feedback
---

Do not state a verdict — *fixed, works, passes, safe, done, the root cause is* — without naming
the command you ran, its output, or the `file:line` you read. Otherwise label it a hypothesis.

**Why:** during the session that produced this repo's plan (2026-07-30), several confident
conclusions were shipped and then disproven by measurement — including a root cause that was
credited to the wrong mechanism and merged before being corrected. The developer's standing
instruction was *"ลองใช้งานจริงก่อนเครม"* (try it for real before you claim it).

**How to apply:** run it, quote the output, then write the sentence. "Tests not run" is a complete
and acceptable sentence. A claim's register never improves by being repeated — when you carry a
claim forward from an earlier turn, carry its register with it.

Related: [[verify-where-the-bug-can-reproduce]]
