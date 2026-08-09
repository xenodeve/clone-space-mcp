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
| #5 Runtime split — Playwright's client does not work under Bun | ✅ | — | Decided: Node drives the browser, Bun runs the rest. ADR [0001](adr/0001-node-drives-the-browser-bun-runs-everything-else.md) |
| #9 P1 — element identity | ✅ | — | Injector + ตัวจับคู่ merged. Exit criterion met on the fixture: 63/63, 0 unresolved, all five hard cases |
| #20 Fingerprint brittleness | ✅ | — | Key holds stable evidence only; ordinal and text rank. Frame key fixed with the injector |
| #21 Plan hardening | ✅ | — | Plan amended. The eleven archive contracts it names must land in P2 |
| #24 Safety mechanisms | ✅ | — | **Closed.** The rule is in `CLAUDE.md`; `bun run mutate` and the regression corpus shipped (#53, now **21 entries**, all caught); `bun run metamorphic` shipped (#24, PR #73) and is deliberately outside every gate. Its first figure, 78/400, was **retracted** by #76 — the transform measured a duplicate, not an unrelated node. Corrected baseline **2/400**, and #78 measured it against a real defect: **179/400 with #20 restored**, so the mechanism is no longer unproven. Read as two counts, not a ratio — the floor is too small to divide by |
| #75 `sourcemapDeclared` lied in two directions | ✅ | — | Ordering, misclassification and the observation boundary, all found by `/code-review` + `/scrutinize` run *after* the batch merged. The fixture now loads a script during the sweep |
| #76 The metamorphic transform measured a duplicate | ✅ | — | The injected node carries a reserved attribute absent from both identity snapshots; the harness asserts no `fingerprintKey` collision before reconciling |
| #8 MCP layering rule + inspector | 🟡 | P2 | Constraint recorded, no code. The inspector needs an archive to render |
| #82 Apply corpus defects in memory, not on disk | ✅ | — | **Shipped.** `--preload` + `Bun.plugin` for the bun entries, `--import` + `registerHooks` for the browser ones; the tracked file is never written, and five guards plus `withMutatedFile` were deleted. The measurement is unchanged at 2/400 against 179/400 and `bun run mutate` is 21 CAUGHT. What the move gave away — a rotted anchor only signals if something loads the file — is bought back with a positive token |
| #89 Node 26 default reporter breaks the mutation-hook runtime guard | ✅ | — | Fixed locally, pending merge. The guard now asserts two applied tokens + both test names instead of reporter punctuation. Targeted test 6/6; `bun run verify` passes 150 Bun + 26 browser tests, lint, typecheck and build |

## Track 2 — Pipeline

| Item | Status | Gate | Next action |
|---|---|---|---|
| #29 P2 — capture (and measure spike Q5, adaptive vs naive sweep) | 🟢 | — | **Slices 1–5 shipped** (#30, #32, #34, #37, #42): HAR recording, adaptive sweep, sourcemap fetch, §6.1 credential redaction with private staging, and §6.2 `environment.json` with distinct requested/observed/replay surfaces, a default-deny exact storage allowlist, bounded declared-font evidence, and cross-origin redirect refusal. ADR 0004 is Accepted (#39). **Slice 6 shipped** (#47, PR #48): §6.3 checkpoint coherence — `checkpoints.json` with a run-level HAR association, `environment.json` bound to the final checkpoint, `documentEpoch` from Chromium's CDP `loaderId` read at checkpoint open and close, and fail-closed publish validation. ADR 0005 is Accepted. **Slice 7** (#52, PR #54) hardened the HAR association: shape-checked in the pure validator, `lstat().isFile()` plus realpath containment at publish. **§6.4 shipped** — `capabilities.json`, run-scoped and unbound (ADR 0006, PRD #59): four tri-state flags detected from the live page, with a second fixture site exercising the TRUE side of each. #60–#64 closed. **§6.5 shipped** — request normalization + unexpected-request taxonomy, full chain merged (#85 probe + ADR 0007 → #86 empty policy artifact → #90 pure operations → #91 explicit policy + ambiguity refusal → #87 positive fixture → #92 ambiguous fixture → #93 closeout). `request-normalization.json` carries an explicit default-empty `volatileKeys` policy; `network.har` stays the single request source; ambiguous collapse is refused at publication (producer + staged re-check, mutation-proven); redacted POST bodies remain fail-closed for replay (P3). **§6.6 (#102) / §6.8 (#103) / §6.10 (#104) sliced, ready-for-agent.** §6.7 / §6.9 / §6.11 **parked for grill** — §6.7 needs the transcript/injector format decided, §6.9 needs a browser-level CDP session (architecture/seam), §6.11 needs the transcript format first (§11: hard to reverse). Next: #102 (§6.6 TargetRef union). |
| P3 — replay (and measure spike Q4, `routeFromHAR` concurrency) | 🟡 | P2 | Exit: network off, zero unexpected requests, motion runs |
| P4 — extract | 🟡 | P3 | Exit: finds every animation the fixture declares |
| P5 — MCP server | 🟡 | P4 | Exit: manifest <50 KB + 4 drill-down tools answer correctly |

## Track 3 — Deferred / untracked

| Item | Status | Gate | Next action |
|---|---|---|---|
| Spike Q6 — sourcemap availability census across real sites | 🔴 | — | Parallel corpus job; gates nothing. File an issue when someone picks it up |
| `secret_scanning_validity_checks` + `non_provider_patterns` | 🔴 | GitHub Advanced Security | The `PATCH` returns 200 and the values stay `disabled`; not available on this repo. Secret scanning and push protection **are** on |
| `t4-e2e.yml` CI workflow | 🔴 | P3 | Deliberately **not** installed at bootstrap — there is no `bun run e2e` yet and a permanently-red check trains everyone to ignore red. Install it with P3 |
| `CONTEXT.md` / `PRODUCT.md` | 🔴 | — | Created lazily when a term or decision actually resolves (proceed-silently rule) |
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

**Phase 0.5 — an unplanned decision (#5). DONE.** Playwright's client does not complete its
handshake under Bun, on either transport, while raw CDP from Bun works in 99 ms. Since the replay
architecture rests on `routeFromHAR`, the runtime had to move: **Node drives the browser, Bun runs
everything else** (ADR [0001](adr/0001-node-drives-the-browser-bun-runs-everything-else.md)).
Crossing the boundary means a Bun child process, not an import.

**Phase 1 — Contracts.** Element identity and the archive schema. This is the phase whose
mistakes are most expensive: everything downstream references these IDs.

**Phase 2–5 — Pipeline.** capture → replay → extract → serve, each with the exit criterion above,
each checked against the fixture's known ground truth rather than a real site.

**Gating summary:** Phase 1 is the multiplier. Identity is referenced by the behavior graph,
screenshots, styles, and diffs, so changing it later invalidates every archive already produced.
The extract phase is where the schedule will slip — detecting a *trigger* is much harder than
detecting an animation.
