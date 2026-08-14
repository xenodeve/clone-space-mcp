# ADR 0008 — Target discovery is enabled after navigation, and what that costs

- Status: **Accepted**
- Date: 2026-08-14
- Issues: #117 (S2 wiring), #122 (deliverable 2)

## Context

§6.9 opens a browser-level CDP session and enables `Target.setDiscoverTargets` so the archive
records which targets existed during capture. #117 specified enabling it **after `page.goto`**, and
the shipped code does that.

A review round raised the consequence: a target created **and** terminated during navigation is
never reported at all. Discovery is not listening yet when it appears, and it is gone before the
boundary snapshot is taken. #122 asked for the decision to be recorded rather than silently
patched, because changing it contradicts #117's own issue text.

## Decision

**Keep discovery enabled after navigation.** Do not move it before `goto`.

## Why

**The loss is narrower than it first reads.** Chromium reports `targetCreated` for targets that
*already exist* at the moment discovery is enabled, so every OOPIF, worker and popup the navigation
produced and left alive is still reported. What is lost is only a target whose entire lifetime fits
inside the navigation — created after `goto` began and destroyed before it settled.

**The alternative buys less than it costs.** Enabling discovery before `goto` means enabling it
before the context has a page, which changes what the session is attached to and widens what the
inventory contains: targets belonging to the browser's startup, not to this capture. That trades a
narrow, describable omission for a broad, undescribable inclusion — and §6.9's inventory is
supplemental evidence about *this run*.

**The boundary snapshot already covers the case that matters.** #117 deliverable 2 sends
`Target.getTargets` at the observation boundary, so anything alive at the end is in the inventory
regardless of when discovery started. Measured on #118: removing `Target.setDiscoverTargets`
entirely left the worker test green, because the snapshot reported it anyway. The two paths are
redundant for a target that survives the run, which is the common case.

## Consequences

- A target created and destroyed **during navigation** is absent from `targets.json`, and nothing
  in the archive records that it existed. This is a known omission, not a defect.
- `targets.json` therefore describes *targets observed from the end of navigation to the
  observation boundary*, which is narrower than "targets that existed during capture". Any consumer
  reasoning about completeness has to read it that way.
- Isolating `setDiscoverTargets` from the snapshot in a test requires a target with exactly that
  transient lifetime. No fixture has one, which is why neither path is mutation-proven today —
  recorded on #118 rather than papered over with an entry that cannot fail.

## What would reopen this

A capture where the transient case is load-bearing — a page whose behaviour depends on a worker it
spawns and kills during load — would make the omission material rather than narrow. That is a
reason to revisit, and this ADR is where the revisit starts.
