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
| #2 CI required checks (`lint`/`typecheck`/`test`/`build`) | 🟡 | **GitHub Actions is locked on this account for billing** | Human task — resolve billing, then add the four to the ruleset. Until then a web merge is ungated. **The expiry is now checkable rather than remembered: `bun run ci:lock`** reads the latest run and exits non-zero the moment one actually executes a step. Verified 2026-08-16 11:46 — still `LOCKED`, every job refused in 2 s. **And the web-merge hole no longer needs Actions to close:** `bun run verify:status` posts the verify result to the head SHA as the `t4-verify` context, proven end to end (`posted success for bc782f7a…`). **Armed 2026-08-16 on the owner's explicit authorization** — `20028550` now carries `["deletion","non_fast_forward","pull_request","required_status_checks"]` with the `t4-verify` context, and PRs #199 and #200 were the first two merged through it. So the web-merge hole is closed, by a **self-attested** check rather than by CI, and every PR from here needs `bun run verify:status` run against its head SHA. The undo payload is on #2. **Reopened 2026-08-16:** it had been closed as `COMPLETED` on 2026-08-14 with the billing lock still on and ruleset `20028550` still carrying no `required_status_checks` — and `CLAUDE.md` keyed *"do not describe the gate as complete"* on that close, so the rule returned the wrong answer for two days. The rule is now keyed on `bun run ci:lock` plus the ruleset's own rules list, and the `requireGreenCI` contradiction with `.claude/t4.json` is resolved in the config file's favour |
| #3 P0 — `test/fixtures/motion-site` + spike Q1–Q3 | ✅ | — | Fixture green (10/10), Q1–Q3 answered in `docs/reports/2026-07-30-cdp-spike.md` |
| #5 Runtime split — Playwright's client does not work under Bun | ✅ | — | Decided: Node drives the browser, Bun runs the rest. ADR [0001](adr/0001-node-drives-the-browser-bun-runs-everything-else.md) |
| #9 P1 — element identity | ✅ | — | Injector + ตัวจับคู่ merged. Exit criterion met on the fixture: 63/63, 0 unresolved, all five hard cases |
| #20 Fingerprint brittleness | ✅ | — | Key holds stable evidence only; ordinal and text rank. Frame key fixed with the injector |
| #21 Plan hardening | ✅ | — | Plan amended. The eleven archive contracts it names must land in P2 |
| #24 Safety mechanisms | ✅ | — | **Closed.** The rule is in `CLAUDE.md`; `bun run mutate` and the regression corpus shipped (#53, now **21 entries**, all caught); `bun run metamorphic` shipped (#24, PR #73) and is deliberately outside every gate. Its first figure, 78/400, was **retracted** by #76 — the transform measured a duplicate, not an unrelated node. Corrected baseline **2/400**, and #78 measured it against a real defect: **179/400 with #20 restored**, so the mechanism is no longer unproven. Read as two counts, not a ratio — the floor is too small to divide by |
| #75 `sourcemapDeclared` lied in two directions | ✅ | — | Ordering, misclassification and the observation boundary, all found by `/code-review` + `/scrutinize` run *after* the batch merged. The fixture now loads a script during the sweep |
| #76 The metamorphic transform measured a duplicate | ✅ | — | The injected node carries a reserved attribute absent from both identity snapshots; the harness asserts no `fingerprintKey` collision before reconciling |
| #8 MCP layering rule + inspector | 🟢 | — | **Layers 1–3 shipped (#124, PR #126).** `src/serve/mcp.ts` registers and maps errors and holds nothing else; `src/serve/tools/` are plain functions reachable from `bun test`; `bun run mcp:call` reaches them with no transport; a real client↔server handshake runs in `test/serve/mcp.test.ts`. `src/archive/read.ts` (#123, PR #125) is the read layer beneath. The SDK's in-memory transport question in the issue body is settled — `InMemoryTransport.createLinkedPair` exists in `@modelcontextprotocol/sdk@1.30.0`, verified against the installed package. **Layer 4, the inspector, is #128** and is no longer gated: it needed an archive to render and `capture_page` produces one. The stdio entry point an agent actually connects to has no automated coverage — #129 |
| #82 Apply corpus defects in memory, not on disk | ✅ | — | **Shipped.** `--preload` + `Bun.plugin` for the bun entries, `--import` + `registerHooks` for the browser ones; the tracked file is never written, and five guards plus `withMutatedFile` were deleted. The measurement is unchanged at 2/400 against 179/400 and `bun run mutate` is 21 CAUGHT. What the move gave away — a rotted anchor only signals if something loads the file — is bought back with a positive token |
| #89 Node 26 default reporter breaks the mutation-hook runtime guard | ✅ | — | Fixed locally, pending merge. The guard now asserts two applied tokens + both test names instead of reporter punctuation. Targeted test 6/6; `bun run verify` passes 150 Bun + 26 browser tests, lint, typecheck and build |

## Track 2 — Pipeline

| Item | Status | Gate | Next action |
|---|---|---|---|
| #29 P2 — capture (and measure spike Q5, adaptive vs naive sweep) | 🟢 | — | **Slices 1–5 shipped** (#30, #32, #34, #37, #42): HAR recording, adaptive sweep, sourcemap fetch, §6.1 credential redaction with private staging, and §6.2 `environment.json` with distinct requested/observed/replay surfaces, a default-deny exact storage allowlist, bounded declared-font evidence, and cross-origin redirect refusal. ADR 0004 is Accepted (#39). **Slice 6 shipped** (#47, PR #48): §6.3 checkpoint coherence — `checkpoints.json` with a run-level HAR association, `environment.json` bound to the final checkpoint, `documentEpoch` from Chromium's CDP `loaderId` read at checkpoint open and close, and fail-closed publish validation. ADR 0005 is Accepted. **Slice 7** (#52, PR #54) hardened the HAR association: shape-checked in the pure validator, `lstat().isFile()` plus realpath containment at publish. **§6.4 shipped** — `capabilities.json`, run-scoped and unbound (ADR 0006, PRD #59): four tri-state flags detected from the live page, with a second fixture site exercising the TRUE side of each. #60–#64 closed. **§6.5 shipped** — request normalization + unexpected-request taxonomy, full chain merged (#85 probe + ADR 0007 → #86 empty policy artifact → #90 pure operations → #91 explicit policy + ambiguity refusal → #87 positive fixture → #92 ambiguous fixture → #93 closeout). **§6.6 shipped (#102)** — versioned `TargetRef` union schema (`src/capture/target-ref.ts`, PR #106). **§6.8 shipped (#103)** — transactional integrity: `commit.json` hashes every published artifact, written last after validation (PR #107). **§6.10 shipped (#104)** — termination budget: sweep bounded by wall-clock/byte/node/height/event caps, `termination.json` records outcome/reason/stats, quiet-window maps to complete, budget/navigation to incomplete (PR #108). **§6.9 shipped (#117)** — browser-level target discovery: `Target.setDiscoverTargets` plus a `Target.getTargets` snapshot reconciled at the observation boundary, published as `targets.json` with a run association (PR #121). **§6.7 / §6.11 parked for grill** — §6.7 needs the transcript/injector format, §6.9 needs a browser-level CDP session (architecture/seam), §6.11 needs the transcript format first (§11: hard to reverse); decision each needs recorded in #29. Next: grill §6.7/§6.9/§6.11, then P3 replay. |
| #156 The run reports complete while responses are outstanding | ✅ | — | **Shipped on `main` and the issue was left open.** `src/capture/network-drain.ts` (bounded 5 s drain), `unansweredRequests` / `failedRequests` / `networkDrainSettled` in `termination.json`, the `/never-answers` fixture route, and four corpus entries. All six acceptance criteria verified 2026-08-16; closing with that evidence |
| #162 Private-address content can reach a published archive | ✅ | pending merge | `captureHar` refuses to publish when a HAR entry's `serverIPAddress` is private, unless `allowPrivateNetwork` (#162 branch). Closes all three vectors with one rule because the address is a fact about the connection, not a lookup. A delegated adversarial review found three classifier gaps, all fixed on the branch: `fe80::/10` narrowed to the literal `fe80:` prefix, IPv4-mapped addresses classified only in dotted form, and CGNAT `100.64.0.0/10` unclassified (Tailscale assigns from it). **The one deliberate remainder:** the refusal discards the whole archive rather than the offending entry, so one leftover loopback beacon fails a public capture — the alternative was rejected because #156 is the lesson that an archive quietly missing what the page asked for is worse |
| **#185 A WebSocket carries no `serverIPAddress`, so #162's rule cannot see it** | ✅ | pending merge | Measured on the fixture: the WS entry has `_resourceType: "websocket"` and no address, while the document and XHR entries beside it carry `"[::1]"`. Its only signal is the URL host, which is the name-based check #162 exists because it could not answer — so this is a policy decision, not a classifier gap. **Closed with option 1**, the deliberately weaker rule for one entry kind: a socket whose URL host is already an **IP literal** is refused on that host. A socket to a **hostname** is still not covered and the doc says so — resolving one at publish would be the time-shifted lookup #162 established cannot answer. Option 3 (read the remote address from CDP) would remove the special case rather than add one, and stays open as the better fix if anyone wants it |
| P3 — replay (and measure spike Q4, `routeFromHAR` concurrency) | 🟡 | P2 | Exit: network off, zero unexpected requests, motion runs |
| P4 — extract | 🟡 | P3 | Exit: finds every animation the fixture declares |
| P5 — MCP server | 🟡 | P4 | Exit: manifest <50 KB + 4 drill-down tools answer correctly |

## Track 4 — #169 Deep client comprehension

Plan: [`docs/superpowers/plans/2026-08-14-deep-client-comprehension.md`](superpowers/plans/2026-08-14-deep-client-comprehension.md).
The acceptance criterion is the developer's own and it is an equivalence, not a checklist: *a clone
that works offline exactly as it works online, for client-side code, makes the client codebase
complete by implication.* Server-side is explicitly out of scope.

**Slices 0, 1, 2, 3 and 6 are on `main`.** What the goal asks for works and is measured on a real
site: on `https://www.chaingpt.org/`, `extract_behaviour` cites a shader at
`/npm/three@0.151.2/build/three.module.js:18723:5` with the line's text, where the runtime reported
`three.module.min.js:12:326662`.

| Item | Status | Gate | Next action |
|---|---|---|---|
| #171 Slice 0 — equivalence gate | ✅ | merged (#172) | `classify` + `run`; verdicts `equal / allowed / different / unobserved / unstable`, coverage as a vector. Carries the #182 stability work merged through #183 |
| #173 Slice 1 — observation layer | ✅ | merged (#174) | Hooks at the **browser API** layer, so it is library-agnostic: 82,613 chars of GLSL off `www.chaingpt.org`, 9 canvases, 1,510 listener registrations. Stacks are in the schema from v1 because adding them later makes every earlier observation unresolvable |
| #167 / #168 Slice 2 — discriminating targets | ✅ | merged (#175) | `selectorFor` verifies uniqueness and falls back to an `:nth-child` ancestor path; ScrollTrigger nodes carry `start/end/scrub/pin/toggleActions` |
| #176 Slice 3 — bounded interaction | ✅ | merged (#177) | The refusal policy is the load-bearing half. Live: `www.chaingpt.org` 32/32 both passes, never navigating |
| #178 Slice 6 — runtime→source provenance | ✅ | merged (#179) | The resolving half of "which line?". Pure, no dependency; **every segment round-trips** against a map Bun's bundler produced |
| #180 The two seams | 🟢 | in review | `coverage.interaction` in the gate, and a shader cited at its original source line through `extract_behaviour`. Neither could be built on a slice branch because half of each was on another. Both measured on real sites |
| **#182 The gate's verdict is not reproducible** | 🟡 | half fixed, cause split | **The sampling half is fixed and measured.** The digest reads the end of a sampling budget instead of stopping at the first agreeing pair; on six real series every k-rule from 2 to 9 reads a plateau, and k from 6 to 9 reads *different* plateaus on different runs. After it, `motion.*` no longer appears in any residual. **What remains is not a gate defect at all** — the verdict now varies only on `dom.elements` and `layout.scrollHeight`, which are constant across all 30 samples of a run and differ *between replays of one archive*. That is **#187**. Until both close, a gate result is one sample and a `FAIL` must be re-run before anyone acts on it |
| **#187 Two replays of one archive lay out to different heights** | 🔴 | filed | 8544 live on every load; 8544, 8486, 8486 across three replays of one archive, constant within each run. **`dom.elements` turned out NOT to be part of it** — it was the post-scroll reading being taken from a single sample, measured at 2821 live against 2819 on the clone while every reading 400 ms later agreed at 2767, and it is fixed. What remains is `layout.scrollHeight` alone, and it is the only field the gate now varies on. **It is a per-replay race, measured, not an archive property** — three archives replayed three times each split *within* two of the three (8544/8486/8544 and 8544/8486/8486), refuting the hypothesis that the capture decides it. Roughly one replay in three. Reproducer committed: `node scripts/replay-height-race.ts <url> 3 3`. Live is 8544 on every load and 8544 is the majority replay value, so **8486 is the defect state**. **Root cause found:** identical DOM, identical fonts and images; one inline style differs — a heading a script measured and froze at `height: 115.906px` (two lines) or `57.9531px` (one), which is exactly the 58 px. Replay serves from disk with **no latency**, so the script sometimes measures before the layout that wraps it; the page has the race online too and the network made it lose the same way every time. Three options in the issue; the one that makes the clone more faithful rather than the gate more tolerant is serving each response no sooner than the HAR says it took — **built and measured on 2026-08-16, and it does not work as written: replaying every entry at its recorded time (capped at 3 s) makes `page.goto(..., waitUntil: "load")` exceed its timeout.** Reverted rather than shipped off-by-default. **The selective version was then built and measured too, and it is worse:** delaying only the document, stylesheets and fonts produced 8486 in nine of ten replays, against roughly one in three without it. That **inverts the mechanism** — serving instantly is what usually produces the correct state, and delaying the font reliably produces the wrong one, so the page never orders its measurement against font application at all. **A third attempt held the scripts back instead and read 15/15 at the live value — and the control, ten replays with the flag off in the same hour, was also 10/10 clean.** The defect had stopped reproducing, so the 15 proved nothing; reverted with the other two. Twenty clean replays after a morning of one-in-three means **the rate is not stable across hours and a live site is not a surface this can be validated against.** **The fixture exists (PR #200).** `/measure-and-freeze.html` with `?at=` picking the measurement point: `t100` diverges **12/12**, `module` agrees **0/6**, and the two are each other's control in `test/browser/height-race.browser.ts`. **The fourth candidate then survived its control (PR #202):** `replayArchive({ restoreTiming: true })` schedules each response at its recorded **offset from the start of the page load** rather than by its own duration — which is why it does not hit candidate one's timeout: on a 146-entry real site `goto` went 825 ms → **4577 ms** and completed. On the fixture **12/12 → 0/12**, control reproducing in the same session. Two corpus entries CAUGHT, one of them on the wiring. **Still open, and the reason is not bookkeeping:** the fixture reproduces the *opposite direction* from the live site (there, live is the resource-applied state), and the real-site probe read 8544 with the flag both off and on — the defect not reproducing, which measures nothing. So the mechanism is confirmed, the fix is graded on the fixture, and its effect on the live case is **unmeasured**. Off by default until it is |
| Slices 4, 5, 7, 8 — visual milestones · archive evidence index · symbol recovery · evidence graph | 🔴 | — | Not filed as issues yet. Ordered in the plan. Slice 6 jumped the queue because it was the only one with no dependency on an unmerged branch |

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
