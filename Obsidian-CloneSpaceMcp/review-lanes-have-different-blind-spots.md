---
name: review-lanes-have-different-blind-spots
description: Measured on #47 — three reviews on one model family missed what a different family found in one pass; and two calls to the same model are one voice, not two
metadata:
  type: feedback
---

# Review lanes have different blind spots — measured, not argued

On **#47** (§6.3 checkpoint producer, 2026-08-03) five reviews ran over the same diff. What each lane found was almost disjoint, and the split was by **family**, not by prompt quality.

| Lane | What it found |
|---|---|
| `cursor` Grok ×2 + Composer | run-level HAR association missing; the fail-closed call was never wired into a test; the checkpoint is stamped after the probe it claims to cover; an unqualified `id` in a comment |
| `antigravity` Gemini 3.1 Pro | `checkpoints.json` is written **before** redaction, which blocks it from ever being the §6.8 commit marker; what publishing it commits P3 to; what breaks for pre-change archives |
| `codex` `gpt-5.6-sol` | **what the validator actually accepts** — duplicate `checkpointId`, empty `checkpointId`, negative `openedAt`, and `1e309` parsing to `Infinity`, all returning `{ ok: true }` |

**The decisive difference was method, not intelligence.** Three Cursor passes read the code. `codex` **ran it with malformed input**. Nobody on the Cursor lane thought to. Four accepted-but-invalid documents fell out of one probe, and all four were confirmed locally afterwards.

`codex` also produced the sharpest finding of the whole slice, which no amount of reading the diff would surface: `epoch:${page.url()}` **cannot distinguish two loads of the same URL**, so artifacts from two different documents look coherent — the exact failure §6.3 exists to detect. It changed a parked decision that already had two candidate answers, because neither answer fixed it.

## The counting error to not repeat

Two of the Cursor reviews were reported as *"found the same thing independently"*. **Both were `cursor-grok-4.5-high`** — one model, two prompts. That is **one voice**, and `clink-brainstorm` already says to count it that way when a client and a direct call share a backend.

Convergence between two calls to one model is not evidence. What survived was the subset verified locally: a mutation showing the fail-closed call could be deleted with every test still green, and a probe showing four malformed documents accepted.

## How to apply

- **Spend at least two families before believing a clean review.** One family clean means one family's blind spot is untested, not that the code is good.
- **Ask one lane to run the code with bad input, not read it.** That is where the accepted-but-invalid cases live, and reading does not find them.
- **Count by backend, not by call.** Same model twice is one opinion at higher cost.
- **Do not carry a lane's availability forward.** "codex is at limit" was true on 2026-08-01 and false on 08-03; it was still being obeyed on 08-03. A time-bound fact treated as permanent silenced the lane that found the most.
- `antigravity` cannot run shell commands headlessly — it auto-denies and returns nothing. Give it **file paths to read**, never `git diff`.

See [[evidence-before-claims]] and [[verify-where-the-bug-can-reproduce]] — this is the same rule applied to reviewers rather than to fixes.
