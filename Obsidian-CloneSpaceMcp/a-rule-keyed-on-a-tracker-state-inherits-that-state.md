---
name: a-rule-keyed-on-a-tracker-state-inherits-that-state
description: "\"Do not call it done until #N closes\" is only as true as #N's state, and a wrong close silently flips the rule to the wrong answer — key the rule on a command that reads the world instead"
metadata:
  type: feedback
---

# A rule keyed on a tracker state inherits that state, including a mistaken one

`CLAUDE.md` carried this sentence from `4767abc` (2026-07-30) until it was replaced:

> Do not describe this repo's gate as complete until #2 closes.

It reads like a safeguard. It is a lookup — and the thing it looks up is a value a human or an agent
can set in one click, for reasons that have nothing to do with the condition the rule cares about.

**What happened.** #2 was closed as `COMPLETED` on 2026-08-14T12:11:29Z. Its own first comment,
posted two and a half minutes later, listed four steps that had not been done, beginning with
*"Resolve billing."* The billing lock was still on — `bun run ci:lock` reported `LOCKED` two days
later — and ruleset `20028550` still carried `["deletion","non_fast_forward","pull_request"]` and no
`required_status_checks` at all. So for two days the sentence returned **"the gate is complete"** to
anyone who evaluated it, while a red PR remained mergeable by a human on the web.

**Why nothing caught it.** Two later sessions wrote comments onto #2 asserting *"this issue stays
open"* — prose arguing with the tracker, on an issue the tracker had already closed. Neither session
checked the state it was asserting. A closed issue is a fact a reader verifies in one second and
then trusts, which is exactly what makes a wrong one expensive.

## The rule

**Key a completeness rule on a command that reads the world, never on a tracker state.** The
replacement is two commands, and neither can be satisfied by closing anything:

```sh
bun run ci:lock                    # exits non-zero once a job actually runs a step
gh api repos/<owner>/<repo>/rulesets/20028550 --jq '[.rules[].type]'   # must contain required_status_checks
```

An issue is still the right place to **track** the work. It is the wrong place to **store the
predicate** a rule branches on. Issues move for administrative reasons — triage, cleanup, a session
tidying its queue — and none of those reasons know what depends on the state.

This is the *Mechanisms over judgment* rule applied to documents rather than to code: the section
already says to prefer things the machine decides, and a `gh issue view` is a machine reading a
field a person set, not a machine deciding anything.

## The second half, which is the same mistake in a different shape

The same section told readers the exemption ends by setting `.claude/t4.json`
`"requireGreenCI": true`, while that file's own note said the opposite and gave the better argument
— the flag binds only commands an agent runs, so it leaves the web-merge hole the exemption exists
to describe. The contradiction was **recorded in a comment and left**, then copied verbatim into
roughly fifteen PR bodies. Recording a contradiction is not resolving one; when two documents
disagree, decide which is wrong in the same change that notices, or the wrong one keeps being cited.

Related: [[evidence-before-claims]], [[a-blocked-method-is-not-a-blocked-task]].
