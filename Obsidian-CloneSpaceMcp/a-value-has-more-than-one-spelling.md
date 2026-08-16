---
name: a-value-has-more-than-one-spelling
description: A guard that matches on the text of a value is only as good as the forms it was built from — one capture shows you one spelling, and the ones it does not show are where the guard silently passes what it exists to catch
metadata:
  type: feedback
---

# A value has more than one spelling, and a guard sees only the ones you looked for

#162 needed to decide whether an address is private. The range table already existed, so the work
looked like wiring. It was not: **the same address arrives in several spellings, and the table
answered correctly for some of them and `undefined` for the rest.**

Three, found by two different methods and worth separating by *how* each was found:

| Spelling | What the guard did | Found by |
|---|---|---|
| `"[::1]"` — bracketed IPv6 | `isIP("[::1]")` is `0`, so it fell through both families and returned `undefined` | **measuring one capture**: 11 of 12 HAR entries carried the bracketed form and one carried `"::1"`, in the same file |
| `fe81::` … `febf::` | the check was `startsWith("fe80:")` while link-local is `fe80::/10` | **an adversarial reviewer enumerating the range**, not a measurement |
| `::ffff:7f00:1` | IPv4-mapped matched only a dotted tail, so the hex form of `::ffff:127.0.0.1` classified as public | **the same reviewer**, same pass |

**The measurement could not have found the last two, and the review could not have found the
first.** A capture shows the spellings that host, that browser and that build actually produced —
which is why it caught the brackets and nothing else. Enumerating the *specification* of the value
catches the forms nobody happened to produce. Neither substitutes for the other, and a guard built
from only one of them looks tested.

**The tell that a guard is form-dependent** is a match on text where the meaning is not text:
`startsWith`, a prefix regex, a `split(".")`, a `match()` on a tail. Each is a decision about
spelling wearing the clothes of a decision about value. The durable fix is to normalise to the
value first — parse the address, mask the bits — and the cheap fix is to enumerate the forms and
test each; #162 took the cheap one and said so.

**And do not write a second table beside the first.** The range table was *moved* rather than
copied, so the pre-flight DNS check and the publish check classify with one function; when the
three gaps above were fixed, both got the fix. A copy would have been corrected once. That is the
same failure as [[an-existence-check-is-three-checks]], where the hardened form already existed in
the repo and a weaker one was written next to it.

Related: [[evidence-before-claims]] — "measured on a real capture" is evidence about the forms that
capture contained, and stating it as evidence about the value is the overreach this note is for.
