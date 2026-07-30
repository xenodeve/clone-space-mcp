---
name: verify-where-the-bug-can-reproduce
description: A fix validated in conditions where the bug cannot occur proves nothing — confirm the bug reproduces without the fix first
type: feedback
---

Before accepting that a fix works, confirm the bug **actually reproduces without it**, in the same
conditions you are testing under.

**Why:** a fix was shipped and merged on the strength of validating runs that all happened to be
missing the environment variable that caused the bug. Every run passed, so the wrong mechanism was
credited and the real root cause stayed live. The tests were not wrong; the conditions were.

**How to apply:** the validation of a fix has two halves — *without the fix, the bug appears* and
*with the fix, it does not*. Running only the second half is the failure mode, and it is invisible
from the inside because everything is green.

This applies with force in this repo: capture and replay behave differently on network state,
service-worker registration, and viewport, so "it worked when I tried it" is a claim about a
configuration, not about the code.

Related: [[evidence-before-claims]]
