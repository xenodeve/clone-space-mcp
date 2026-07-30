# Open Work Ledger — consolidated single source (2026-07-30)

> **Why this file exists:** open work scatters across GitHub issues, ADRs, plans, and `DONE.md`.
> Agents read issues but often miss the MD. This ledger consolidates **everything still open** —
> GitHub-tracked **and** MD-only — into one place, deduped, with a phased plan.
> **Read this file at session start (it is linked from `CLAUDE.md`).** When you finish an item,
> update its row here AND its GitHub issue; when you discover new work, add a row here and (for
> anything non-trivial) file an issue so it doesn't vanish into MD again.
>
> GitHub issues remain the **source of truth** for tracked work — this ledger is the discovery
> index over them, not a competing record.

**Legend:** ✅ done, pending merge · 🟢 buildable now · 🟡 gated (needs merge / resource /
decision) · 🔴 **UNTRACKED** (MD-only, no GitHub issue — highest miss-risk)

---

## Track 1 — Foundations

| Item | Status | Gate | Next action |
|---|---|---|---|
| Repo operating layer (CLAUDE.md, hooks, guards, memory) | ✅ | — | Bootstrap commit; ruleset `20028550` active on `main` |
| #2 CI required checks (`lint`/`typecheck`/`test`/`build`) | 🟡 | **GitHub Actions is locked on this account for billing** | Human task — resolve billing, then add the four to the ruleset. Until then a web merge is ungated |
| #3 P0 — `test/fixtures/motion-site` + spike Q1–Q3 | ✅ | — | Fixture green (10/10), Q1–Q3 answered in `docs/reports/2026-07-30-cdp-spike.md` |
| #5 Runtime split — Playwright's client does not work under Bun | 🟡 | **developer decision** | Measured three layers; the fault is Playwright's client, not Bun's networking. Recommendation: Node for browser-driving code, Bun for the rest |
| P1 — element identity + archive schema | 🟢 | — | Unblocked: Q1–Q3 answered. Exit: 100% ID reconciliation capture→replay on the fixture |

## Track 2 — Pipeline

| Item | Status | Gate | Next action |
|---|---|---|---|
| P2 — capture (and measure spike Q5, adaptive vs naive sweep) | 🟡 | P1 | Exit: all artifacts + interaction transcript + sourcemaps present |
| P3 — replay (and measure spike Q4, `routeFromHAR` concurrency) | 🟡 | P2 | Exit: network off, zero unexpected requests, motion runs |
| P4 — extract | 🟡 | P3 | Exit: finds every animation the fixture declares |
| P5 — MCP server | 🟡 | P4 | Exit: manifest <50 KB + 4 drill-down tools answer correctly |

## Track 3 — Deferred / untracked

| Item | Status | Gate | Next action |
|---|---|---|---|
| Spike Q6 — sourcemap availability census across real sites | 🔴 | — | Parallel corpus job; gates nothing. File an issue when someone picks it up |
| `secret_scanning_validity_checks` + `non_provider_patterns` | 🔴 | GitHub Advanced Security | The `PATCH` returns 200 and the values stay `disabled`; not available on this repo. Secret scanning and push protection **are** on |
| `t4-e2e.yml` CI workflow | 🔴 | P3 | Deliberately **not** installed at bootstrap — there is no `bun run e2e` yet and a permanently-red check trains everyone to ignore red. Install it with P3 |
| `CONTEXT.md` / `UBIQUITOUS_LANGUAGE.md` / `PRODUCT.md` | 🔴 | — | Created lazily when a term or decision actually resolves (proceed-silently rule) |
| License | 🔴 | — | Not chosen. `README.md` says so |

---

## Management Plan — phased execution order

**Phase 0 — Unblock. DONE** (#3). The fixture exists and the three blocking questions are
answered, measured against it — full detail in `docs/reports/2026-07-30-cdp-spike.md`:

1. `getEventListeners({ depth: -1, pierce: true })` — **YES**, one call reaches the light DOM,
   an open shadow root and a same-origin iframe (4/4 declared click listeners). Budget one
   session per out-of-process iframe.
2. `DOMSnapshot.captureSnapshot` × 40 properties — **1.381 MB at 6160 nodes**, 237 B/node
   marginal, so ~0.7 MB at 3000. **No property allowlist needed in v1.**
3. `CSS.getStyleSheetText` — **YES**, it returns a cross-origin sheet the page cannot read
   (`SecurityError` in-page, 593 bytes via CDP).

Q4 (HAR concurrency), Q5 (sweep comparison) and Q6 (sourcemap census) are **not** blocking —
Q4 and Q5 cannot be measured until their implementations exist, and Q6 gates nothing.

**Phase 0.5 — an unplanned decision (#5).** Playwright's client does not complete its handshake
under Bun, on either transport, while raw CDP from Bun works in 99 ms. Since the replay
architecture rests on Playwright's `routeFromHAR`, the runtime split is now a decision that has
to be made before phase 2 writes any browser-driving code.

**Phase 1 — Contracts.** Element identity and the archive schema. This is the phase whose
mistakes are most expensive: everything downstream references these IDs.

**Phase 2–5 — Pipeline.** capture → replay → extract → serve, each with the exit criterion above,
each checked against the fixture's known ground truth rather than a real site.

**Gating summary:** Phase 1 is the multiplier. Identity is referenced by the behavior graph,
screenshots, styles, and diffs, so changing it later invalidates every archive already produced.
The extract phase is where the schedule will slip — detecting a *trigger* is much harder than
detecting an animation.
