---
name: equivalent-but-simpler-needs-evidence
description: Rejecting a reviewer's design as "same properties, smaller change" is a claim about runtime behaviour and needs a probe — measured on #47, where it was wrong
type: feedback
---

When you decline a reviewer's proposal in favour of a smaller one, **name the property you are
claiming both designs share, then run something that would tell them apart** — before writing code.

**Why:** on #47 the CDP `loaderId` proposal was rejected with the sentence *"same properties,
smaller change"* and nobody tested whether the properties held. They did not. The replacement
counted Playwright `framenavigated` events, and `history.pushState` moved that counter 0 → 3 —
violating the same ADR 0005 rule the previous design violated. The leak changed shape and was not
closed, across four commits. The probe that settled it was four lines and one browser run.

The trap was a **name collision between two APIs**: Playwright's `page.on("framenavigated")` fires
for same-document routing, CDP's `Page.frameNavigated` does not — same-document navigation arrives
on `Page.navigatedWithinDocument` and leaves `loaderId` byte-identical. The two differ in exactly
the property that mattered, and nothing in either name says so.

The second error was worse than the first: the architecture cost used to justify the rejection —
*"`src/` may not import playwright, ADR 0001"* — was also never checked. `record.ts` already used
structural interfaces, so the rejected design was a few added lines.

**How to apply:** *"simplest thing that works"* only applies once **works** is established, so an
equivalence claim carries the same evidence burden as *fixed* or *passes*. If no experiment can
distinguish the two designs, take the reviewer's — they proposed a mechanism, you proposed a
judgement. This binds hardest when the shared property is a security or integrity invariant, where
being wrong is silent.

Related: [[evidence-before-claims]], [[verify-where-the-bug-can-reproduce]],
[[review-lanes-have-different-blind-spots]]
