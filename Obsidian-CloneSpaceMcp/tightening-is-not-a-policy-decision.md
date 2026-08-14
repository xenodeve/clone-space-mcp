---
name: tightening-is-not-a-policy-decision
description: A security review returned three findings and all three were parked as the developer's call; two were changes that only ever narrow what a tool may do, which any agent may adopt and anyone may loosen later
metadata:
  type: feedback
---

# Tightening is not a policy decision

On #124 a delegated `/security-review` returned do-not-ship on the first tool surface in this repo
that takes caller-controlled input. Three High findings: an unsandboxed output path, protocol-only
URL validation, and response bodies surviving redaction. **All three were parked as decisions only
the developer could make.** Two of them were not.

**The test that separates them: does the change narrow what the tool may do, or widen it?**

- Refusing an `outDir` that already exists, and refusing UNC paths, only ever **removes**
  capability. Nobody's working call breaks that was not already relying on the destructive case.
- Refusing a URL that resolves into the private network, with an explicit opt-in, only ever
  **removes** reach. The opt-in exists because this repo's own fixture is on localhost.
- Deciding whether an archive may contain response bodies from an authenticated page is a
  **product** question. It changes what the tool is *for*. That one is genuinely the developer's.

A narrowing change can be adopted now and loosened later by whoever wants it looser, with the
conversation happening against working code instead of a paragraph. A widening one cannot be taken
back from anyone who has already relied on it.

**Why this is worth a note rather than a shrug.** `t4-afk` warns that the two AFK failure directions
are not symmetric: guessing past a real decision produces a visible wrong artifact and somebody
says so, while over-asking produces *"a polite, well-organised list that looks like diligence"* and
has **no natural corrective signal**. This was that failure exactly, and it survived writing a park
note, filing an issue, and marking a PR draft — every one of which felt like rigour. It was caught
only because the developer's standing goal made stopping visible.

**The related trap, which is the reason the park felt obviously right:** the findings arrived from a
*security* review, and this repo's rules say security boundaries are never exemptable by argument.
That rule is about **not shipping past a finding**. It says nothing about who may *fix* one. Reading
"security" as "therefore not mine to touch" converts a rule against shrugging into a reason to
shrug.

Related: [[run-the-mandated-gates-not-your-own]] — the gate produced the right findings here. What
went wrong was entirely in what was done with them.
