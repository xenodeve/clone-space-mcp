# DONE — Agent Session Log

> Newest entry on top. One dated `##` heading per shipped unit so an agent can jump to one.
> When this crosses ~a few hundred lines or a phase closes, move older entries to
> `DONE-archive-<period>.md` and leave a redirect line here.

---

## restoreTiming — the fourth candidate for #187, and the first with a control that reproduced (2026-08-16, #187, PR #202)

**What the archive does not carry is *when*.** `routeFromHAR` serves recorded bytes as fast as a route handler can be called, so a page that measures an element and freezes the result reads a different world offline. `replayArchive({ restoreTiming: true })` holds each response until the moment the archive says it finished.

**The design difference from candidate one, which is the whole reason this one runs at all.** That attempt delayed each entry by its own recorded **duration**, stacking a wait onto a request that had already started, so the cost was the sum over every entry and `goto(..., waitUntil: "load")` timed out. This schedules each response at its **offset from the start of the page load**, so entries that overlapped in the recording overlap again. Measured on a 146-entry real site: `goto` 825 ms → **4577 ms**, completed. *Duration and arrival time are not the same quantity.*

**Graded on the fixture, with the control in the same session:** `?at=t100` off → **12/12 diverge**; on → **0/12**. Two corpus entries, both CAUGHT, and one of them (`restore-timing-never-waits`) covers the **wiring** — the criterion the three earlier attempts failed, having tested pure functions and left the wiring untested.

**What is deliberately not claimed.** The fixture reproduces the *opposite direction* from `labs.chaingpt.org` — there the live page is the resource-applied state, here it is the not-arrived one. The real-site probe read 8544 with the flag off **and** on, which is the defect not reproducing rather than the fix working. Mechanism confirmed, fix graded on the fixture, live effect **unmeasured**, and the option stays off by default until that changes. #187 stays open.

## `t4-verify` armed, and the web-merge hole closed (2026-08-16, #2)

**The developer authorized it explicitly, so the paragraph below this one about it being deliberately unarmed is now history rather than policy.** Ruleset `20028550` carries `["deletion","non_fast_forward","pull_request","required_status_checks"]` with the `t4-verify` context. **The three pre-existing rules were preserved deliberately** — `PUT` replaces the whole `rules` array, so a payload naming only the new rule would have silently deleted squash-only, the deletion block and the force-push block. The ruleset was read first and both the arming payload and its one-command undo are on #2.

**The two open PRs were given green statuses before arming, not after.** Each ran `bun run verify:status` **on its own branch** — posting from whichever tree happened to be checked out is the exact failure this script nearly shipped with. #199 and #200 then merged through the new gate, which is the only evidence that it passes what it should.

**What it is not.** Self-attested: the machine that ran verify reports its own result, and anyone with push access can post a green status by hand. It guards against forgetting, not against lying. **The five Actions checks are still the real answer and #2 stays open** — `bun run ci:lock` still reports `LOCKED`.

**The practical consequence for every future PR:** `t4-gate` runs `bun run verify` before a merge but posts nothing, so a green local run is not a green check. Run `bun run verify:status` on the PR branch or the merge is blocked.

## The gate-complete rule was keyed on a tracker state (2026-08-16, #2, PR #199)

**#2 was closed as `COMPLETED` on 2026-08-14 while none of its four steps had happened** — its own first comment, posted 2m29s after the close, listed them. `CLAUDE.md` keyed a rule on that state: *"do not describe this repo's gate as complete until #2 closes."* So for two days the sentence returned **the wrong answer**, while `ci:lock` said `LOCKED` and the ruleset carried no `required_status_checks`. Two later sessions wrote *"this issue stays open"* into comments on an already-closed issue without checking.

The rule is now keyed on two commands that read the world — `bun run ci:lock` and the ruleset's own rules list — neither of which can be satisfied by closing anything. The `requireGreenCI` contradiction that #2's own runbook recorded and left is resolved in `.claude/t4.json`'s favour: the exemption ends by putting the jobs on the ruleset, not by flipping a flag that binds only agent-run commands.

**Memory:** `a-rule-keyed-on-a-tracker-state-inherits-that-state`.

## A fixture that reproduces measure-and-freeze on demand (2026-08-16, #187, PR #200)

**Three candidate fixes had been rejected, the third despite measuring 15/15** — its control was also 10/10 clean, because the bug had stopped reproducing that hour. The live rate went from three-in-nine to zero-in-twenty inside one day, so no candidate could be graded.

`/measure-and-freeze.html` measures an element and freezes the result inline without ordering that measurement against the image its size depends on. Measured: image `responseEnd` is **71–83 ms live** and **8–11 ms in replay**, with `domContentLoadedEventEnd` ≈ 8 ms on both — so parse-time precedes the image everywhere and only a deferred measurement separates the sides. `?at=t100` → **12/12 diverge**; `?at=module` → **0/6**, the negative control that proves the fixture can also show a fix.

**Deterministic on purpose, which departs from the issue's own criterion of "both states across N replays"** — a bimodal fixture would reproduce the property that made the live site useless as an instrument. **No corpus entry, and that is a finding:** corpus defects are applied in memory to the test process, and the fixture server is a separate Bun child a mutation never reaches, so an entry would report `MUTATION NOT APPLIED` — which is not `SURVIVED`. Two browser tests act as each other's control instead.

## A merge gate that does not need Actions (2026-08-16, #2)

**Goal:** `CLAUDE.md` states the consequence of the locked CI plainly — *"a human merging on the web is currently ungated"* — because `t4-gate` and the `pre-push` guards only ever see commands run locally. That is the actual hole, and it does not need Actions to close.

**A commit status does not need Actions.** Anything with a token can post one against a SHA and a ruleset can require its context. `bun run verify:status` runs the verify command and posts the result to the head SHA as `t4-verify`. Proven end to end today: `posted success for bc782f7a… : bun run verify passed locally`.

**Its first run posted a `failure` that was not the repo's.** It spawned `bun run verify` through a shell, and `bun` is not on this machine's process PATH — the constraint `CLAUDE.md` records — so the output was `'bun' is not recognized as an internal or external command` and the status said the repo was red. It now spawns `process.execPath`, which **is** bun. A reporter that can post someone else's failure as yours is worse than no reporter.

**Arming it is deliberately not done in code.** Adding the context to ruleset `20028550` blocks any PR the command was never run against — the same failure #2 cites for the Actions checks — and that is the owner's call. And it is **self-attested**: the machine that ran verify reports the result, so it guards against forgetting, not against lying. The four Actions checks remain the real answer and #2 stays open for them.

**One false sentence removed.** `.githooks/pre-push` told anyone it blocked that *"the same checks run in CI, where they cannot be bypassed."* They do not, and have not since the account was locked. It now says so and points at `bun run ci:lock`.

**Evidence:** `bun run verify` — green at the SHA the status was posted for. Corpus entry `verify-status-reports-a-failed-run-as-success` CAUGHT.

## The CI exemption became a command instead of a thing to remember (2026-08-16, #2)

**Goal:** GitHub Actions is locked account-wide for billing, so this repo merges under a standing exemption. `CLAUDE.md` already said the important half is the **expiry** — and that expiry was a thing a person had to notice.

**`bun run ci:lock` answers it.** It reads the latest workflow run and reports `LOCKED` while every job is refused for billing and none ran a step, `UNLOCKED` once any job ran one, and exits non-zero on `UNLOCKED` so a session cannot miss it.

**Two decisions in it that are the whole point.** A job that ran a step ends the exemption **whatever it concluded** — the exemption is about jobs that cannot start, not jobs that fail, and a genuinely red suite means CI works and the gate should be armed. And a stepless run with no billing annotation is reported `UNREADABLE`, not `LOCKED`: a disabled workflow and a permissions failure look identical from outside, and reading one of those as this exemption would launder an unrelated breakage into a rule everyone already merges past. Both are corpus entries and both are CAUGHT.

**What it deliberately cannot do is arm the gate.** Editing `.claude/t4.json` is refused by the permission classifier, which is correct — that file decides what the gate denies, and a script that could rewrite it would be a gate that can disarm itself.

**Verified against the real repo today, 11:46:** `LOCKED`, every job refused in two seconds, annotation `The job was not started because your account is locked due to a billing issue.` The exemption still holds and #2 stays open; it is a billing state no code here can change.

**Evidence:** `bun run verify` — 539 Bun · 92 Node browser · lint, typecheck, build clean.

## A socket to a private address is refused, by a weaker rule that says it is weaker (2026-08-16, #185)

**Goal:** close the hole #162 left. A WebSocket entry carries **no `serverIPAddress` at all** — measured on this repo's own fixture, where the document and XHR entries beside it carry `"[::1]"` and the socket carries nothing — and `privateNetworkEntries` passes every addressless entry on purpose, because a cached or ServiceWorker response opened no connection.

**The rule is the one the issue called weaker, adopted as such.** A socket whose URL host is already an **IP literal** is refused on that host. A socket to a **hostname** is not: resolving one at publish time is a lookup at a moment that is not the moment the socket opened, which is the property #162 established cannot answer, and reintroducing it quietly for one entry kind would be worse than the gap. `using-the-tools.md` states the gap rather than implying the refusal is total.

**Four corpus entries, all CAUGHT.** One removes the rule; one makes it fall back to `"private"` for an unresolvable host, which is the mistake of treating a hostname as an address — caught by the test asserting a hostname is *passed*. The other two came from a delegated adversarial review and were both real: the rule gated on `_resourceType`, **Playwright's own field that no part of the HAR format guarantees**, so a socket entry without the marker bypassed it; and it refused a socket that *never connected*, which served nothing and made a page probing `wss://127.0.0.1:9/` fail an otherwise public capture. The scheme is what the entry is, and `_failureText` is the same signal `termination.json` already refuses to let into the outcome.

**No URL-spelling bypass was found, by either of us.** WHATWG `URL` treats `ws:`/`wss:` as special schemes, so `ws://2130706433/`, `ws://0177.0.0.1/`, `ws://0x7f.1/`, `ws://user@127.0.0.1/`, `ws://127.0.0.1./` and `WS://127.0.0.1/` all normalise to `127.0.0.1` before the rule sees them, and `ws://[::ffff:7f00:1]/` is classified by the hex-mapped branch added in #186.

**Evidence:** `bun run verify` — 531 Bun · 92 Node browser · lint, typecheck, build clean.

## The gate stopped reading instants, and #187 got a root cause (2026-08-16, #182, #187, #189, #190)

**Goal:** finish making the gate's verdict reproducible, and find out what the one remaining varying field actually is.

**There were two places the gate read an instant, not one.** #188 fixed the settle loop. The reading taken *after the scroll pass* still came from a single sample, and every count in the digest that is not from the settle loop comes from it. Measured on `labs.chaingpt.org`, three runs of live against replay — `dom.elements` at the moment the gate reads it, then fourteen more times at 400 ms:

```
live    2821  2767 2767 2767 … (fourteen identical)
replay  2819  2767 2767 2767 … (fourteen identical)
```

The first read differs by two elements on two of three runs; every read after it agrees. That was the `dom.elements` residual, and it was never the clone's fault. Fixed by sampling that reading over a short budget and publishing its counts only when the tail held still — `hasSettled` generalised into `tailIsConstant`, so it is the same rule and the same code.

**After it, `layout.scrollHeight` is the only field the verdict varies on.**

**#187 went from "did not reproduce" to a named line, and a wrong hypothesis of mine died on the way.** Thirteen replays across three archives all read 8544, which looked like the effect was gone; it is not, it is **one replay in three**, and thirteen clean draws at that rate is unremarkable. I then proposed the state belonged to the *archive*, on the strength of one gate run whose three replay passes agreed. Measured immediately — three archives, three replays each — and the split is *inside* two of the three archives. Refuted in one command.

**The cause, with the line.** Eight replays deep, diffing every element's box height between an 8544 and an 8486 replay of one archive: identical DOM, identical five loaded font faces, identical images, and exactly one difference —

```
h2  tall : height: 115.906px      short: height: 57.9531px
```

115.906 is twice 57.953, and 57.95 px is the 58 px the document differs by. A script measures the heading and freezes the result inline; **replay serves from disk with no latency**, so it sometimes measures before the layout that wraps the heading to two lines. The page has the race online too — the network just made it lose the same way every time.

**Two fixes were built for it and both were measured to fail, the second in the informative direction.** Serving every entry at its recorded latency times the navigation out. Serving *only* the document, stylesheets and fonts at their recorded latency — the obvious repair, with a readable rule rather than a fitted constant — produced the defect state in **nine of ten replays**, against roughly one in three without it. That inverts the mechanism: replay being fast is what usually produces the *correct* state, and delaying the font is what reliably produces the wrong one. The page never orders its measurement against font application at all. Both were reverted rather than shipped off-by-default.

**A third attempt read 15/15 at the live value and was reverted anyway, because of the control.** The second measurement said the order that matters is font-before-script, so the third held the *scripts* back and left fonts at disk speed. Fifteen replays, fifteen correct, against a baseline failing about one in three — a result worth shipping. Then the control, ten replays with the flag **off**, same machine, same hour: **also ten out of ten clean.** The defect had stopped reproducing, so the fifteen measured nothing. Twenty clean replays after a morning of one-in-three is the finding that matters: **the rate is not stable across hours, so a live site is not a surface a fix for this can be validated against**, and #187's next step is a fixture that reproduces the race on demand rather than a fourth candidate fix.

**What that means for the gate, and it is the useful half:** a field that varies between replays and is constant *within* each one is not a sampling defect and no clock fixes it. The gate noticed something real.

**Evidence:** `bun run verify` — 524 Bun · 92 Node browser · lint, typecheck, build clean. Corpus entry `post-scroll-counts-read-once` CAUGHT. Reproducer committed as `scripts/replay-height-race.ts` because an effect nobody can summon is an effect nobody can fix.

## The gate reads the end of its budget, not the first plateau (2026-08-16, #182)

**Goal:** make the equivalence gate's verdict reproducible — it returned FAIL, PASS and INCOMPLETE on the same unchanged site, and a mechanism whose verdict depends on sampling phase is a measurement being read as one.

**What was refuted, by measuring rather than reasoning.** Six real series from `labs.chaingpt.org` — three live loads and three replays of one archive, 30 samples at 400 ms, recorded by the newly committed `scripts/digest-series.ts`. Against them, every rule of the form *stop when k consecutive samples agree*:

| k | reads |
|---|---|
| 2 (the rule in use) to 5 | 59 on all six, on a page that rests at 52 — the entry plateau is six to nine samples long |
| 6 to 9 | 59 on some runs and 52 on others — **#182's non-reproducible verdict, expressed as a constant** |
| 10 | 52 on all six, and fitted to the loads observed; an earlier measurement of the same page needed 6 |

A second observable was tried and also refuted: *no finite animation is still running* reads zero at the **first** sample, before the transition begins, and oscillates between 0 and 2 forever once the page is at rest.

**What shipped.** The loop runs its whole budget and the digest reads the last sample; `hasSettled` became a *report about* the reading rather than the thing that chose it, so a page whose intro outlives the budget says `motion.settled: false` instead of presenting a mid-transition value as settled. Budget 20 samples — eight seconds — with the six measured series reaching their resting value by sample 12 at the latest.

**The result, and the half it did not fix.** After it, `motion.css` and `motion.gsap` are identical across all six runs and no motion field appears in any residual — including `gsap` 49-live-against-50-on-the-clone, a difference that was never one. Three gate runs still gave INCOMPLETE, FAIL and PASS, and **every field they varied on was `dom.elements` or `layout.scrollHeight`**. Those are constant across all 30 samples of a run and differ *between replays of one archive*: 8544 live always, 8544/8486/8486 on the clone. No clock fixes that, because it does not move during a run. Filed as **#187**.

**The cost, stated because it is real.** Sampling the whole budget takes the fixture's equivalence tests from seconds to about 100 s, and `bun run verify` with them. One test leaves the default budget alone so the number a real site is measured with is exercised once per run; the other passes a short budget with the reason written beside it.

**Evidence:** `bun run verify` — 516 Bun · 91 Node browser · lint, typecheck, build clean. Two new corpus entries CAUGHT, one restoring the early stop and one moving the reading off the end of the budget.

---

## The archive may not come from a private address (2026-08-16, #162)

**Goal:** close the three ways private-network content still reached a *published* archive — a page-initiated subresource no origin policy covers, DNS rebinding between the pre-flight lookup and the navigation, and a same-host rebind whose origin never differs from the requested one.

**One rule replaces three that could not work.** Every check before this resolved a *hostname* at a moment that was not the moment the socket opened. A HAR entry's `serverIPAddress` is a fact about the connection that happened, so `captureHar` now refuses to publish when any entry classifies as loopback/link-local/private/unique-local/unspecified, unless `allowPrivateNetwork` says otherwise. It does not stop the fetch; it stops the archive, which is where this project's other guarantees are enforced. Absent means refuse, the same stance `assertOriginAllowed` already took.

**The measurement that made the guard correct.** Playwright writes IPv6 into the HAR **bracketed**: 11 of 12 entries of one fixture capture carried `"[::1]"` and one carried `"::1"`, in the same file. `isIP("[::1]")` is `0`, so the range table that already existed — reused rather than rewritten, in `src/capture/private-address.ts` — had to normalize brackets before classifying or it would report the loopback address it exists to catch as public. Corpus entry `private-address-not-normalized-for-brackets` encodes exactly that.

**42 call sites had to say what they were doing.** The fixture servers run on loopback, so every capture in this repo's own suite *is* a capture from a private address; the default was left denying and each site now passes the opt-in. `capture_page`, `runEquivalence` and the MCP tool schema thread the caller's choice through to the archive check.

**Two things found by running the corpus rather than the suite.** `coverage-claims-an-interaction-it-never-drove` had been `MUTATION NOT APPLIED` on `main` since #180 rewrote the line it anchored to — an entry measuring nothing while reading as one of 120 passing. And `capture-tool-reaches-the-private-network`, with its guard removed, *publishes* into the fixed `never-created` path the test names, after which the next honest run fails on "already exists" and blames the wrong rule; the test now uses a unique directory.

**Evidence:** `bun run verify` — 505 Bun · 91 Node browser · lint, typecheck, build clean. Three new corpus entries CAUGHT, plus the re-anchored one; 27 entries anchored in the changed files re-run and CAUGHT.

**A delegated adversarial review found three classifier gaps and all three were real.** Asked to refute "no published archive can contain content served from a private address", `codex` returned: link-local narrowed to the literal `fe80:` prefix while the block is `fe80::/10`, so `fe81::` through `febf::` classified as public; IPv4-mapped addresses matched only in dotted form, so `::ffff:7f00:1` and `::ffff:127.0.0.1` — the same address — classified differently; and CGNAT `100.64.0.0/10` unclassified, which is not routable on the public internet and is the block Tailscale assigns from. Each was fixed test-first, with a corpus entry for the first two.

**Its fourth finding was filed rather than fixed (#185).** A WebSocket entry carries no `serverIPAddress` at all — measured on the fixture, where the WS entry has none while the document and XHR entries beside it carry `"[::1]"` — so a socket to a private address is published. The only signal it offers is its URL host, which is the name-based check this whole rule exists because it could not answer. Adopting it is a policy decision for one entry kind, not a classifier gap, so it got an issue with the measurement in it.

**Known and deliberate:** refusing the whole archive rather than dropping the entry. A second reviewer flagged the cost — one leftover `http://127.0.0.1/…` beacon, or a corporate split-horizon answer, fails an otherwise fine public capture. Dropping the entry was rejected because #156 is the lesson that an archive quietly missing what the page asked for is the worse failure.

---

## §6.5 request normalization shipped end-to-end (2026-08-09, AFK batch, #84 #85 #86 #87 #90 #91 #92 #93)

**Goal:** make a logically identical request (fresh nonce/timestamp) replayable from the archive, and never let replay guess between distinct archived responses.

**The consumer contract was proved first, then built.** The #85 probe measured, against pinned Playwright 1.62 with the live origin stopped, that `route.fallback({ url })` registered after `routeFromHAR(..., { notFound: "abort", update: false })` serves the archived body — and that `not-in-archive`, `redacted-post-body` and `ambiguous-normalized-match` all abort with the network unreachable. That became ADR 0007 before any production code existed, so the archive schema commits to a measured mechanism rather than an assumed one.

**The archive records a policy, not a duplicate index.** `request-normalization.json` (V1) carries only the caller's explicit, default-empty `volatileKeys` list. `network.har` remains the single request source; replay derives its normalized index in memory. The pure operations (`normalizePolicyKeys`, `normalizeRequestUrl`, `requestKey`, `findAmbiguousNormalizedRequests`) are unit-tested, and URL normalization edits only the query segment so host/port/path/encoding are never canonicalized (PRD out-of-scope).

**Ambiguity fails closed at both ends.** Distinct archived raw URLs that collapse under the policy for the same method refuse publication — once in the producer (after redaction) and again independently in the staged validator, so a tampered policy cannot bypass the producer. Both guards are mutation-proven (the staged containment test was strengthened so only the containment check can refuse a valid escaped policy).

**A discovered shadowing, not a scope change.** The new staged re-check reads the HAR, which refuses a directory association too — making `isStagedRegularFile`'s `isFile()` guard fail nothing (its mutation reported SURVIVED). Per the mechanism rule (#68), the guard was deleted and its obsolete corpus entry removed; directory refusals still hold via the downstream reads.

**Validation:** `bun run verify` — lint 0, typecheck 0, 189 Bun tests, 30 browser tests, build. `bun run mutate` — 25/25 CAUGHT, none SURVIVED/NOT APPLIED. The #85 probe re-runs green. Fixture ground truth: a positive page (one `_t` request, raw evidence preserved, pure normalizer removes only `_t`) and an ambiguous page (two collapsing requests, refused in Chromium, no archive, clean retry).

**PRs:** #94 (docs + #89), #95, #96, #97, #98, #99, #100. **Next:** §6.6 (versioned `TargetRef` union).

---

## The mutation corpus stopped writing to the working tree (2026-08-05, `/tdd`, #82)

**Goal:** stop defending a write that did not need to exist.

**#81 ended with five guards around one write** — a restore in a `finally`, an ownership check, a
read-back, `SIGINT`/`SIGTERM` handlers, and a `git status` check before and after. Each was added in
response to something that had actually gone wrong. The stack was still the wrong answer.

**The signal handlers were the tell.** They were added *because* a killed process left a defect
applied in `src/capture/record.ts`, and then measured: on this platform neither
`Bun.Subprocess.kill()` nor `process.kill(pid, "SIGINT")` runs them. The kill that caused the
incident was programmatic, so **the guard written for it never covered it**, while the code and the
report both said it did.

**The defect is now applied in memory** — `Bun.plugin` `onLoad` via `--preload`, Node
`registerHooks` via `--import` — so the tracked file is never written and all five guards are gone,
along with `withMutatedFile`, `restoreIfOurs` and the test file that existed only to hold them up.

**What the move gave away, and the gates caught it.** Writing to disk failed *before the suite
started*, whatever the suite imported; a load hook only fires if something loads the file, so an
entry whose target no test imports would have come back `SURVIVED`. Bought back with a **positive**
token the hook prints when it rewrites, whose absence the runner reads as NOT APPLIED. `/scrutinize`
found it with a probe, and it was latent rather than live.

**And a claim in the branch that nothing backed:** the Node hook said `--import` reaching
`node --test`'s per-file children was *"measured, not assumed"* — true, but only in a scratch probe.
The runtime tests ran `bun run` and a bare `node <file>` while the runner uses `bun test --preload`
and `node --test --import`. Both now run the runner's own commands through shared flag constants.

**Validation:** the measurement is unchanged at **2/400 against 179/400**, which is what makes
"equivalent" a finding rather than a hope. `bun run mutate` exits 0 — 21 CAUGHT and no other status,
including all five browser entries through the Node hook, with the tree never written.
`bun run verify` exits 0 — 150 Bun, 26 Node browser, lint, typecheck, build.

---

## The metamorphic check, measured against the bug it was built for (2026-08-05, `/tdd`, #78)

**Goal:** stop the corrected metamorphic check being an unproven mechanism.

**It was unproven and the repo's own rule said so.** #76 corrected the transform, and in doing so
retired the evidence that justified building the check: 32/400 against 135/400 belonged to the
transform #76 showed was wrong. Measured properly at the same seed — **2/400 with the fix in place,
179/400 with #20 restored.**

**No ratio is reported, and the first draft led with one.** `179 / 2` is 89.5, but on a floor of 2 a
single case moves that multiplier by tens. The script and the report now print two counts and say
why there is no third number. An outsider review lens made this point; it was right.

**What produces the rise, stated so it is not oversold.** `addUnrelatedNode` bumps `siblingOrdinal`
for same-tag siblings, the restored key gates on that field, and `reconcile` pools by that key. It is
**#20's own failure path, not a second signal** — the narrower claim it earns is the one #78 asked
for: the corrected harness responds to a real defect.

**The park was wrong, and that is the reusable part.** #78 had been written up as needing the
developer, because reverting a merged fix reads as `git reset --hard`. #20's fix is **one line**, so
the defect is a find/replace of the kind `scripts/mutations.ts` has held since #53 — no git at all.
Recorded as `a-blocked-method-is-not-a-blocked-task`.

**A defect this change introduced and removed.** The corpus guard first asserted the anchor matches
the on-disk source exactly once, which `mutate.ts` falsifies while running that very entry —
reproduced at exit 1 with `occurs 0 times`, now `"fixed, or carrying the defect, never both"`.

**An incident worth the note.** A delegated `codex` reviewer ran `bun run mutate` because the prompt
named it; killed, it skipped that runner's `finally` and left a mutation applied in
`src/capture/record.ts`. The tree was restored to `HEAD` and every measurement from that window was
re-run on a quiet tree — including a 21/21 that had already been written down. Recorded as
`a-reviewer-can-rewrite-your-working-tree`.

**A correctness lens then found five defects this change had introduced** — the first `writeFile`
outside its `try` (a regression against the inline version it replaced), `Number("") === 0` turning
an empty child stdout into a published `0/400`, `--against` accepting capture-side corpus ids the
harness never executes, `--against --emit-count` silently emitting the baseline, and an entry whose
`find` equals its `replace` reporting CAUGHT while mutating nothing. A change whose whole subject is
*"do not publish a measurement you cannot trust"* had shipped five ways to publish one.

**Then `/simplify`, `/code-review` and `/scrutinize` found more, including two the change had
claimed the opposite of.** `mutate.ts` assigned `process.exitCode` unconditionally at the end, so it
**erased the non-zero exit the new restore-refusal sets** — the alarm was wired to a line that
overwrote it. And the `SIGINT`/`SIGTERM` restore was measured, not assumed: on Windows neither
`Bun.Subprocess.kill()` nor `process.kill(pid, "SIGINT")` runs the handler, so **the programmatic
kill that actually caused the incident above was never covered**, while the code comment and the
report both said it was. The mechanism is now a `git status --porcelain` check on the target file,
before the measurement and again before any number is printed — it runs outside the process whose
death is the failure. #82 records the deeper fix: apply the defect in memory via `--preload`, so the
tracked file is never written at all.

**Validation:** `bun run verify` exits 0 — 135 Bun, 26 Node browser, lint, typecheck, build.
`bun run mutate` exits 0 — 21 CAUGHT and no other status. `git status --porcelain src/` empty after
every `--against` run.

---

## What the skipped gates were hiding (2026-08-05, `/code-review` + `/scrutinize` + `/tdd`, #75 #76 #77 #78 #79)

**Goal:** run the review gates that were skipped across seven merged slices, and fix what they found.

**The gates were skipped, and that was the finding.** `/simplify`, `/code-review` and `/scrutinize`
never ran on #53, #61–#64, #68 or #24, and no exemption was written — which the workflow calls a
violation rather than an exemption. Running them afterwards on the merged diff produced **five real
defects in code that TDD, mutation proofs, `bun run verify` and `bun run mutate` at 17/17 had all
passed.** Two independent model families flagged the most serious one at the same line.

**`sourcemapDeclared` told the truth only by accident.** Pending script reads were drained before the
adaptive sweep, and the sweep exists precisely to trigger lazily-loaded content — so a script
arriving during it was never awaited. The flag could publish `false` for a page that declared a map,
and because the same set drives the fetch, **a map discovered during the sweep was never pulled into
the HAR at all.** That half predates §6.4: it is lost archive evidence, not a wrong boolean.
Separately, `new URL(...)` sat inside the then-handler, so an unparseable URL threw into the catch
meaning *body unreadable* and the archive answered `"undetermined"` about something it knew. And the
dependency listeners stayed live through `context.close()` while the flags were copied earlier.

**Why the net missed it:** the fixture loaded every script before the sweep, so the race never fired
and the flag was right for the wrong reason. Mutation testing cannot reach an ordering bug the
fixture never creates. The fixture now loads one during the sweep.

**The metamorphic check was measuring a duplicate.** Its injected node spread `...source`, copying
tag, frameKey and every stable attribute, so it landed in the same fingerprint bucket as its source —
"duplicate an existing element", not "add a node that corresponds to nothing in capture". Corrected,
the figure moves from **78/400 to 2/400** at the same seed, with nothing tuned toward either. The
harness now asserts the property before reconciling and treats a collision as a harness failure.

**That correction cost the mechanism its evidence, and it is filed rather than buried.** #24
justified the check by measuring 32/400 against 135/400 with #20 restored. That belongs to the old
transform, so by this repo's own rule the corrected harness is an **unproven mechanism** until it is
run against #20 — #78, with the instruction to keep it and say so if it turns out not to
discriminate.

**`bun run mutate` refused two runs.** Both times a fix moved source text an anchor matched, and the
runner reported `MUTATION NOT APPLIED` rather than a pass — the silent no-op class that cost #47 a
false *the guard is covered*. Second and third time it has caught that in the wild.

**Validation:** `bun run verify` exited 0 — 104 Bun tests, 26 Node browser tests, lint, typecheck and
build. `bun run mutate` exits 0 with 20 caught and none surviving. Every fix had an observed RED and
is caught by its own test. PRs #77 and #79 merged; #75 and #76 closed.

**Next:** #78 measures whether the corrected metric still discriminates. §6.5 request normalization
needs a grill before it needs an issue.

## Safety mechanisms complete, and fifteen guards that could not fail (2026-08-04, `/tdd`, #24 #68 #72 #73)

**Goal:** finish the mechanisms `CLAUDE.md` names, and answer the question #63's isolation sweep
raised — how many of this repo's guards read as validation without being it.

**Shipped:** `bun run metamorphic`, the last of #24's four deliverables, and a validator in which
every remaining refusal point is reachable and tested.

**Fifteen of the validator's refusal points failed nothing when deleted.** An exhaustive sweep —
every guard in `src/capture/checkpoints.ts`, not the five the issue named — found exactly one that
was reachable and merely untested: a checkpoint whose `artifacts` is not an array. It has a test
now. The other fourteen could not be reached at all, because an earlier or later guard already
refuses everything they would, and they are gone with the reason in each one's place. The shape the
removals take is normalization rather than a check: a non-record JSON value becomes `{}` and the
guard below refuses it for the field it lacks. The binding type checks went the same way — strict
inequality against the final checkpoint already refuses every value of the wrong type.

**Behaviour was proven preserved, not argued.** This is the only change in the run that deletes
validation code, so twenty-six malformed documents — `null`, array, string and number in every
position the removed guards covered — were run against `main` and against the branch. Byte-identical
output. The refactor changes which guard refuses, never whether one does.

**`bun run mutate` earned its keep on something that was not a rehearsal.** The normalization moved
source text four corpus entries matched on, and the runner refused the run with `MUTATION NOT
APPLIED` rather than reporting a pass — the first time the loud-failure requirement from #53 caught
that class in the wild rather than in its own self-proof. It is the exact silent no-op that cost
#47 a false "the guard is covered".

**The metamorphic check measured 78/400, not the 32/400 #24 records, and the generator was not
tuned toward the recorded number.** A figure adjusted until it matches an expectation measures
nothing. The two describe different corpora, and the script says so in its own output rather than
only in the report — printing a delta without that line invites reading 46 as drift in `reconcile`
when nothing about `reconcile` changed, which is the category error #24 exists to prevent, one level
up. It is outside `bun test`, `bun run verify` and the corpus by design: correct code legitimately
loses matches when an unrelated node exposes a genuinely ambiguous element.

**Validation:** `bun run verify` exited 0 — 102 Bun tests, 26 Node browser tests, lint, typecheck
and build. `bun run mutate` exits 0 with 17 caught and none surviving, up from 7 at the start of the
day. PRs #72 and #73 merged; #24 and #68 closed.

**Next:** §6.5 request normalization, which needs a grill before it needs an issue.

## P2 archive contract 6.4 — capability flags (2026-08-04, `/grill-me` + `/clink-brainstorm` + `/tdd`, #29 #59 #60 #61 #62 #63 #64 #65 #66 #67 #69 #70)

**Goal:** make an archive say when `extract` will come back empty for a reason that is not
absence of motion — a service worker, a WebSocket, a closed shadow root, or a missing sourcemap.

**Shipped:** `capabilities.json`, run-scoped and carrying no checkpoint binding, associated in
`checkpoints.json` as `capabilities: { path, scope: "run" }` beside the HAR. Four tri-state flags —
`serviceWorkerDependent`, `webSocketDependent`, `closedShadowRootPresent`, `sourcemapDeclared` —
detected from the live page, with fail-closed publish validation. A second fixture site exercises
the TRUE side of all four; `motion-site` is untouched. ADR 0006 is Accepted.

**Three design decisions were overturned during the grilling, each by evidence.** The service-worker
flag was going to mean *a worker controls this page*; `controller` is false even when one registered,
because capture always opens a fresh context — it would have been a permanent false negative that no
test on a fresh context could catch. `noSourcemap` described the archive rather than the page and
became `sourcemapDeclared`. And `capabilities.json` was going to carry a checkpoint binding until it
became clear that three of its four fields are run-scoped, so binding them would assert a coherence a
mid-sweep navigation breaks — the failure §6.3 exists to detect, reappearing in a new artifact.

**The panel was wrong where it mattered, and only running Chromium showed it.** Three model families
were asked what survives `serviceWorkers: 'block'`. Two asserted CDP `ServiceWorker` events would not
fire; they fire in both modes (13 and 2). The third proposed falling back to the `/sw.js` network
request; that is dead at zero requests either way. What the panel did converge on — rejecting an
init-script wrapper around `navigator.serviceWorker.register` as page-observable, and the fail-closed
list including *a flag being true must not refuse* — held up.

**Found by a sweep, not by luck:** #63's acceptance criteria required proving every pre-existing
guard still fails exactly the test named for it. Five fail nothing at all. Measured on `main` as well
as the branch, identically, so it is a pre-existing gap rather than a regression — filed as **#68**.
That is the sixth guard-that-cannot-fail this repo has found, and the first found by a check that ran
because it was required rather than because someone thought to try.

**Validation:** `bun run verify` exited 0 — 101 Bun tests, 26 Node browser tests, lint, typecheck and
build. `bun run mutate` exits 0 with 16 caught and none surviving, up from 7. Every slice had an
observed RED failing on its assertion, and every new guard is proven load-bearing by mutation. PRs
#65, #66, #67, #69 and #70 merged; #60–#64 closed and §6.4 is checked on #29.

**Next:** §6.5 request normalization. `serviceWorkers: 'block'` stays unset and stays an open
question named in ADR 0006 — under it a page's captured execution never runs with a worker, so the
flag would warn about a dependency the archive's bytes never exercised.

## `bun run mutate` and the regression corpus (2026-08-03, `/tdd`, #24 #53 #55)

**Goal:** make the two rules `CLAUDE.md` already states — a green suite is not evidence the suite
has teeth, and a mechanism is unproven until run against a bug that actually happened — into a
command instead of a habit.

**Shipped:** `scripts/mutations.ts` holds seven entries, each a defect that actually shipped or was
actually found; `scripts/mutate.ts` re-applies each one, runs the suite it names, and requires the
suite to go red **through the test that entry names**. Four of the seven are guards that were
measured returning a fully green suite when deleted. It is deliberately **not** part of
`bun run verify` — it runs the whole suite once per mutation.

**The requirement that was easy to get wrong:** a mutation that fails to apply is a loud failure,
never a pass. During #47 a `perl` substitution matched nothing because the file was CRLF, the suite
stayed green, and the run read as *"the guard is covered"* when the guard had never been touched.
The runner also separates **CAUGHT BY THE WRONG TEST** from CAUGHT — a mutation that reddens the
suite through an unrelated test proves nothing about the guard it names.

**The runner is proven, not asserted.** Each probe was run by the orchestrator rather than taken
from the delegated worker's report: clean tree exits 0 with 7/7; an entry whose `find` cannot match
exits 1 with `MUTATION NOT APPLIED`; an entry whose `expect` names no real test exits 1 with
`CAUGHT BY THE WRONG TEST`; and `git status` afterwards shows only the three intended files, so
every mutated source file was restored. Restoration is in a `finally`.

**Validation:** `bun run verify` exited 0 — 73 Bun, 24 Node browser, lint, typecheck, build.
`bun run mutate` exits 0. PR #55 merged as `ce5fcca`; #53 closed.

**Next:** #24 stays open for the metamorphic check on `reconcile`. It is a **baseline metric**, not
an assertion — correct code legitimately loses matches in 32/400 cases — so it cannot be expressed
as a mutation that must be caught, and reporting it as one would be the false confidence #24 was
filed about. Two browser-only defects are named in a comment in the corpus and left out until
`suite: "browser"` is actually exercised.

## P2 archive contract 6.3 — the HAR association (2026-08-03, `/tdd` + `/code-review` + `/scrutinize`, #29 #52 #54)

**Goal:** stop `checkpoints.json` from publishing a HAR association that points outside the archive
or at nothing.

**Shipped:** `har.path` is now validated in two layers. The pure `validateCheckpoints` judges shape
— no leading `/`, no drive letter, no backslash, no `..` segment. `validateStagedArchive` adds what
shape cannot answer: `lstat().isFile()` so a symlinked final component fails rather than being
followed, plus a `realpath` containment comparison that catches a junctioned **intermediate**
component `lstat` cannot see.

**Neither guard can fire from the producer**, which always writes the `HAR_FILE_NAME` constant.
That is the reason they need tests rather than the reason they do not — `2d29a66` answered the same
objection when the publish-validation call could be deleted with the whole suite staying green.

**The first version of the fix was too weak, and two independent lanes found it.** `codex gpt-5.6-sol`
and `antigravity` Gemini separately flagged that `stat` succeeds on directories and follows
symlinks. Reproduced before acting: `har.path` of `"."`, of a directory named `network.har`, and of
an existing subdirectory all returned `{ ok: true }`, none needing a symlink. **An existence check
is three checks and `stat` performs only the first.**

**The reuse failure worth naming:** `src/capture/redact.ts` already held this logic as `staysWithin`
and `resolveAttachedFile`, and it was not reused — a weaker version was written from scratch beside
it. The duplication that remains is deliberate and commented, because that module is the
secret-handling one and a standing park condition for unattended runs. Recorded in the vault as
`an-existence-check-is-three-checks`, the first use of the rule added in #50.

**Validation:** `bun run verify` exited 0 — 73 Bun, 24 Node browser, lint, typecheck, build. RED was
observed on every slice and each guard is proven load-bearing by mutation with disjoint failure
sets. PR #54 merged as `5399b0b`; #52 closed.

**Next:** the per-artifact binding shape — `artifacts: [null, 42, "not-a-binding"]` still validates.
That defines a published schema rather than tightening an existing field, so it is its own decision.

## P2 archive contract 6.3 — checkpoint coherence (2026-08-03, `/tdd` + `/simplify` + `/security-review` + `/code-review` + `/scrutinize`, #29 #45 #46 #47 #48)

**Goal:** make every published archive carry a checkpoint identity that says which document its
evidence describes, and refuse to publish when the parts disagree.

**Shipped:** `captureHar` publishes a versioned `checkpoints.json` with a run-level HAR association,
binds `environment.json` to the final checkpoint, and fail-closed validates the staging directory
after redaction and before rename. `documentEpoch` is Chromium's CDP `loaderId`, read at checkpoint
open and again at close; a change between the two throws, so a same-origin navigation during
environment collection cannot bind one document's evidence to another document's epoch. ADR 0005
is now Accepted.

**The design was wrong twice before it was right, and the second time is the lesson.** `epoch:${page.url()}`
leaked query-string secrets into `checkpoints.json`, which never passes through `redactHarArchive` —
that function takes the HAR path and touches nothing else, so two of three published artifacts are
unredacted. Its replacement counted main-frame `framenavigated` events, chosen over the reviewer's
CDP `loaderId` proposal with the sentence *"same properties, smaller change"* — **and the properties
were never tested.** Playwright fires that event for same-document routing, so `history.pushState`
drove the value: measured 0 → 3 across two `pushState` calls and a `replaceState`. The leak changed
shape and was not closed. CDP's identically-named `Page.frameNavigated` fired **0** times over the
same sequence and left `loaderId` byte-identical; same-document routing arrives on
`Page.navigatedWithinDocument`. That distinction is the whole property ADR 0005 asks for. The
architecture cost that justified rejecting it was also overstated — `record.ts` already used
structural interfaces, so `newCDPSession` is a few lines and ADR 0001 is untouched.

**RED → GREEN and what mutation found:** every slice had an observed RED. Four guards were found
unable to fail by deleting them and watching the suite stay green — the `validateStagedArchive`
call itself, the epoch half of the binding check, the `openedAt` half, and a post-filter length
comparison that no input can reach. The first three now fail exactly one test each; the fourth was
removed with the reason left in its place. Reverting the real `e892a5b` defect on top of the new
validator makes publish validation refuse the archive, where before it published silently — the
mechanism was run against a bug that actually happened, not predicted to catch one.

**Validation:** `bun run verify` exited 0 — 64 Bun tests, 24 Node browser tests, lint, typecheck and
build. Nine review passes ran across three model families; four findings were rejected as false
positives, including an invented `closedAt` field and a session-leak claim disproved by the
`finally` block two lines below. The finding worth acting on — the epoch read after
`collectEnvironment` — was raised **independently by `codex gpt-5.6-sol` and `antigravity` Gemini**,
which is why it was fixed rather than filed. Every GitHub job had zero steps and the exact
annotation *The job was not started because your account is locked due to a billing issue.*, so the
documented #2 exemption applied and was restated in the PR body. PR #48 merged as `1322e57`; #47
closed and §6.3 is checked on #29.

**Next:** three refusals ADR 0005 names are still not implemented — `har.path` traversal outside the
archive, `har.path` pointing at a missing file, and the per-artifact binding shape, which is
undefined so `artifacts: [null, 42, "not-a-binding"]` validates. The producer writes `artifacts: []`
today, so nothing is published unbound. P2 remains open for §6.4–§6.11.

## P2 archive contract 6.2 — `environment.json` (2026-08-01, `/tdd` + `/security-review` + `/code-review` + `/scrutinize`, #29 #39 #42 #43)

**Goal:** record the browser environment that shaped capture as auditable archive evidence without
publishing storage or font claims that replay cannot safely or faithfully restore.

**Shipped:** `captureHar` now publishes `environment.json` v1 transactionally beside the redacted
HAR. It keeps caller-requested values, browser/page observations, and normalized replay context
distinct; pins the Chromium, Playwright, and optional channel tuple; and maps observed DPR to replay
`deviceScaleFactor` only when the caller did not request one. Storage is default-deny and limited to
exact allowlisted local/session keys from the primary origin. Non-allowlisted names and values,
cookies, IndexedDB, Cache Storage, and cross-origin frame storage are absent. Declared font evidence
is tuple-sorted, deduplicated, bounded to 256 entries, and marked when truncated. Invalid URLs,
duplicate allowlist keys, and cross-origin redirects fail without publishing the archive. ADR 0004
is now Accepted.

**RED → GREEN and review repairs:** the first environment test failed because no artifact existed.
The allowlist and duplicate-key tests were proven by temporary mutations that leaked all storage or
silently deduplicated. Separate browser REDs proved that prefix-capping fonts missed a late
lexicographically-small face and that a cross-origin redirect was accepted; both passed after the
bounded full-set selector and origin guard. Review also added cross-origin iframe sentinels, missing
allowlisted-key coverage, UA hints/channel evidence, invalid-URL preflight, and a private-staging
cleanup assertion.

**Validation:** fresh `bun run verify` exited 0 — 37 Bun tests, 19 Node browser tests, lint,
typecheck and build. Independent Grok 4.5, GLM 5.2, and Composer 2.5 review plus an adversarial
challenge found the origin and font-cap defects; post-fix scrutinize returned no actionable
findings. PR #43 had no review threads. Every GitHub job had zero steps and the exact annotation
*The job was not started because your account is locked due to a billing issue.*, so the documented
#2 exemption applied. PR #43 merged as `cc5cb20`; #42 closed and §6.2 is checked on #29.

**Next:** split archive contract §6.3, checkpoint coherence, into its dedicated issue before
implementation. P2 remains open for the remaining contracts and artifacts.

---

## P2 archive contract 6.1 — credential redaction (2026-08-01, `/tdd` + `/security-review` + `/code-review` + `/scrutinize`, #29 #36 #37)

**Goal:** prevent a capture archive from publishing reusable transport credentials while retaining
the HTTP response bodies that offline replay needs.

**Shipped:** `captureHar` now records each run into a private sibling staging directory and refuses
to mix a new run with a non-empty output root. After Playwright closes, the redactor removes
credentials from HAR headers, cookie arrays, URL userinfo, credential-like query fields,
URI-bearing headers and redirects. Attached request bodies and WebSocket frame streams become a
deterministic `[REDACTED]` payload. Every attachment path is contained under the archive root;
traversal, symlink, non-file, real-path escape and multi-link cases are rejected. Successful runs
publish the sanitized directory by rename; ordinary failures remove staging. ADR 0003 records the
threat model, Windows permission limit, and strict-replay consequences.

**RED → GREEN and review repairs:** the initial browser RED passed 7/8 and named five fake
sentinels in `network.har` and the attached request body. Independent security rounds then
reproduced four additional classes: failed-capture→retry leakage, custom header/URL credential
carriers, hard-link writes, and Playwright's WebSocket frame sidecar. Each became a controlled
regression test before the final gate. The end-to-end archive scan is recursive and requires a real
WebSocket sidecar; all ordinary HTTP response attachments are compared byte-for-byte with the
fixture origin so redaction cannot silently destroy evidence.

**Validation:** fresh `bun run verify` exited 0 — 33 Bun tests, 17 Node browser tests, lint,
typecheck and build. Final Security and Spec reviews passed with no findings; Standards passed with
no hard violation; Scrutinize returned `ship`. PR #37 had no review threads. Every GitHub job had
zero steps and the exact account-billing-lock annotation covered by #2, so the documented exemption
applied. PR #37 merged as `23dac8f`; security issue #36 closed and §6.1 is checked on #29.

**Next:** split archive contract §6.2, `environment.json`, into its dedicated issue before
implementation. P2 remains open for the remaining contracts and artifacts.

---

## P2 slice 3 — fetch published sourcemaps (2026-07-31, `/tdd` + `/simplify` fallback + `/scrutinize` + `/code-review`, #29 #34)

**Goal:** capture a published sourcemap while the live network is still available. Browsers do not
request `sourceMappingURL` targets themselves, so replay cannot recover a map that capture omitted.

**Shipped:** `captureHar` listens to Playwright script responses, reads their bodies without
requesting each script twice, resolves relative `sourceMappingURL` values against the response URL,
and fetches discovered maps through the BrowserContext request client. That path records attached
map bodies in the same HAR and works for a cross-origin script whose body page JavaScript cannot
read because it has no CORS header.

**RED → GREEN and sensitivity:** the original map assertion passed only after explicit fetching;
removing that fetch returned it to RED. Review then found that page-side discovery duplicated every
script request and missed no-CORS cross-origin maps. With the final tests against the old
implementation, 5/7 browser tests passed: the instrumented script appeared twice and the
cross-origin map was absent. Response-based discovery plus `context.request.get` made the suite
7/7. A fixture mutation returning 404 for the map failed with `404 !== 200`, proving the test
requires a successful attached map rather than only a matching request URL.

**Validation:** fresh pre-merge `bun run verify` exited 0 for PR #34's tree — 27 Bun tests,
15 Node browser tests, lint, typecheck and build. The PR had no unresolved review threads. All four
GitHub jobs had zero steps and the annotation *The job was not started because your account is
locked due to a billing issue.*, so PR #34 used the #2 standing exemption recorded in its body.

**Next:** split the first remaining archive contract, §6.1 redaction, into its dedicated
security-labelled issue before implementation. Issue #29 remains open until every §6 contract and
capture artifact reaches its phase exit criterion.

---

## P2 slice 2 — adaptive sweep reaches lazy content (2026-07-31, `/tdd` + `/simplify` fallback + `/scrutinize` + `/code-review`, #29 #32)

**Goal:** make capture reach a resource that plain navigation cannot request. The fixture's
`lazy-hero-panel` exposes `/assets/lazy-panel.svg` only through `data-lazy-src`; its
`IntersectionObserver` assigns `src` only after the element enters the viewport.

**Shipped:** `captureHar` now runs an adaptive document sweep in `src/capture/record.ts:38`.
It advances by 0.8 viewport, waits two animation frames plus 75 ms, adapts when document height
changes, and stops after three checkpoints where both scroll position and document height remain
unchanged. Browser coverage lives at `test/browser/capture.browser.ts:75` and `:91`.

**RED → GREEN:** before the sweep, the browser suite passed 1/2 and failed with *the HAR is missing
the lazy image request triggered by the capture sweep*. After implementation it passed 2/2.
Disabling the sweep loop returned the same test to RED, proving the assertion depends on the new
mechanism rather than an eager fixture fetch.

**Review finding reproduced and fixed:** the first implementation reset its empty-checkpoint
counter whenever it had not reached the bottom. A page whose `window.scrollTo` was a no-op therefore
never terminated. The added browser test timed out at 1.5 seconds with *the capture sweep did not
terminate* (the runner reported about 1.8 seconds); after the fix it completed in about 419 ms.

**Validation:** fresh pre-merge `bun run verify` exited 0 for merge commit `85f2757`'s tree —
27 bun tests, 11 node browser tests, lint, typecheck and build. PR #32 had no unresolved review
threads. GitHub Actions did not execute because the account-wide billing lock in #2 prevented every
job from starting; PR #32 restates that standing exemption.

**Deferred deliberately:** bounded network quiet and the full `capture-incomplete` termination
budget remain §6.10; nested and horizontal scrollers remain §6.11. `captureHar` still has only test
callers and is not exported from `src/index.ts`, so this slice does not silently approximate either
contract before its dedicated work lands.

**Next:** slice 3 — explicitly fetch the fixture's published sourcemap into the HAR/archive.

---

## P2 slice 1 — record a HAR of the fixture (2026-07-31, `/tdd` + `/simplify` + `/scrutinize` + `/security-review` + `/code-review`, #29 #30)

**Goal:** the first artifact of the capture stage, and the phase's most expensive decision made on
its first line — the HAR is what replay reads back through `routeFromHAR`.

**Shipped:** `src/capture/record.ts`, `test/capture/record.test.ts`, `test/browser/capture.browser.ts`.
`captureHar` imports no `playwright`; the browser arrives through a structural type, because
`bun build` bundles `src` (ADR 0001). The context closes in a `finally` — Playwright only flushes
the HAR on context close, so a navigation failure would otherwise leave nothing to diagnose with.

**Scope, narrowed deliberately:** it asserts the two resources plain navigation must produce —
the cross-origin stylesheet and the iframe document. `lazyImage` needs a sweep and `sourcemap`
needs an explicit fetch. **#29 originally said slice 1 asserts all four**, which no implementation
of this slice could have satisfied; the issue body was corrected rather than the criterion quietly
ignored.

**Written by delegated agents, so nothing here was ever observed RED.** The evidence is mutation
instead, run by the orchestrator: `harResourceUrls` → `return []` failed 2/4 bun tests and the
browser test; `content: "attach"` → `"embed"` failed the browser test with *the stylesheet entry is
missing attached content*. Both restored to green. **A test never seen to fail is not yet known to
test anything** — that is the whole reason these were run.

**A seam was proposed, built, and deleted inside one PR.** `src/capture/har.ts` split pure from
driver. Three independent lenses — test-quality, `/simplify`, `/scrutinize` — converged on it with
no sight of each other, and `/scrutinize` stated it plainly: the claimed seam did not exist at HEAD.
The cause was self-inflicted: accepting *"an integration test must not observe through the unit it
also tests"* removed `harResourceUrls`'s only caller. The deeper fact is that slice 1 has **no
consumer for a HAR reader at all** — that is P3's work — so the module was premature, not orphaned.

**Two measurements that change later contracts:**
- **`content: 'attach'` writes bodies to sidecar files**, referenced from `response.content._file`.
  The HAR JSON carries the reference, not the bytes. **Contract 6.1's redactor must cover the
  sidecar directory**, or every credential that travelled in a body sits in plaintext beside a
  redacted HAR. Found by an assertion failing, not by reading docs.
- **`recordHar` cannot see a request a service worker answers from its own cache.** `serviceWorkers:
  "block"` is missing, and no current test would catch it because the fixture registers none. This
  is exactly the silent-incompleteness §6.4 exists to flag.

**`/security-review` found three real findings and none of them blocked**, on a checkable fact
rather than a judgement: `grep -rn "captureHar"` returns two call sites, both tests, one on the
localhost fixture and one on a fake browser; `src/index.ts` does not export it. Redaction,
restrictive file modes, and archive-root containment for `outDir` are now part of 6.1's scope.

**Validation:** `bun run verify` exit 0 on `main` after merge — 27 bun tests, 9 node browser tests,
lint, typecheck, build.

**Said plainly rather than smoothed over:** capture launches **headless**, and plan §3 specifies
headful — a real divergence, recorded on #29 rather than closed here. The four review gates ran
only after the developer asked whether they had; two self-designed review rounds before that had
found none of the four defects the gates did.

**Next:** slice 2 — the adaptive sweep, which is what makes `lazyImage` reachable at all.

---

## P1 — element identity, end to end (2026-07-31, `/tdd` + `/scrutinize` + `/security-review` + `/code-review`, #9 #20 #21 #24)

**Goal:** the contract every later stage references — name an element, and recognise it again in a
different construction of the same page.

**Shipped:** `src/identity/{fingerprint,reconcile,inject}.ts`, `test/identity/reconcile.test.ts`
(16 cases), `test/browser/identity.browser.ts` (8 cases), `scripts/fixture-client.ts`, ADR 0002,
and two core rules in `CLAUDE.md`.

**Exit criterion, measured:** 63 elements · 63 matched · 0 unresolved · 0 replay-only · all five
identity hard cases matched. **That number compares two runs of the same page under the same
conditions — the easiest form of capture→replay. It is a floor, not a ceiling.**

**Three defects found and fixed, none by reasoning about the code:**
- **#20** — `siblingOrdinal` and `textHash` were equality components of the bucket key, so one
  inserted sibling made a uniquely-attributed element `missing` with zero candidates while the
  node it should have matched appeared in `replayOnly`. Found by `codex` running a probe during a
  `/clink-brainstorm` round; reproduced here before being accepted. Twelve tests were passing.
- **`addInitScript` accumulates** — measured: four registrations, four executions on the next
  navigation. Every capture installed another `MutationObserver`. The output stayed correct,
  which is why it would not have been noticed.
- **`textHash` stored raw text** — the full source of every `<style>` element was landing in
  `identity.json`, colliding with the archive's redaction contract. 9177 → 8098 bytes.

**Two documented claims were wrong and the documents were corrected, not the code bent to match:**
`attachShadow` needs no patch for the walk (an open root is readable), and the frame key's
occurrence index was the same positional flaw as #20 one level up.

**Validation:** `sh scripts/verify.sh` exit 0 · `bun test` 26 pass · `node --test` 8 pass ·
determinism measured over 12 runs · `bun run spike` re-run unchanged after the dedup.

**Said plainly rather than smoothed over:** the branch mixed #9 and #24, so neither can be
reverted alone. `settleMs` is a fixed delay, not a settle signal. The observer re-walks each added
subtree, so a page appending N nodes one at a time costs O(N²).

**Next:** P2 capture — unblocked. Its exit criterion now includes the eleven archive contracts.

---

## Renamed to clone-space-mcp (2026-07-31, branch `chore/16-rename-to-clone-space-mcp`, #16)

**Goal:** follow the repository rename through the project, so no doc states a path that no longer
resolves.

**How it surfaced:** a push reported `This repository moved` — the rename had happened on GitHub
while work was in flight. Pushes still worked through the redirect, which is exactly why it could
have gone unnoticed; a redirect stops the moment anything else claims the old name.

**Shipped:** `package.json` + `bun.lock` name, `CLAUDE.md`, `README.md`, `UBIQUITOUS_LANGUAGE.md`,
`src/index.ts`, `.github/workflows/t4-verify.yml`, the fixture's title and heading, the GitHub path
in `docs/agents/{issue-tracker,workflow}.md` (both language mirrors), and
`Obsidian-CloneSpace/` → `Obsidian-CloneSpaceMcp/` with every referencing path updated.

**Left alone deliberately:** the narrative in the bootstrap entry below still says `clone-space`.
It is a dated record of what the repo was called then; rewriting a ship log to match the present
makes it a worse record. Only the *paths* in it were updated, because a path that resolves to
nothing helps nobody.

**Validation:** `sh scripts/verify.sh` exit 0 · `bun test` 22 pass / 0 fail ·
`rg 'xenodeve/clone-space[^-]'` and `rg 'Obsidian-CloneSpace[^M]'` both return nothing.

**One acceptance criterion was written on a wrong assumption.** #16 said `bun.lock` would be
"regenerated, not hand-edited" — but `bun install` does not rewrite the root `name` when no
dependency changed, and deleting the lockfile to force it would have re-resolved three
`"latest"` dependencies. The field was edited by hand and `bun install --frozen-lockfile`
re-run to prove the lockfile is still accepted.

---

## P0 — motion fixture + CDP spike Q1–Q3 (2026-07-30, `/t4-dev-workflow` + `/tdd`, branch `feat/3-motion-site-fixture`, #3)

**Goal:** produce the ground truth every later phase is judged against, and replace three
load-bearing CDP assumptions with measurements.

**Shipped:**
- `test/fixtures/motion-site/` — a page declaring every motion mechanism the plan depends on,
  plus the five identity hard cases. `fixture-manifest.json` is the **single** source of truth
  for its contents; the copy of that list previously in `Obsidian-CloneSpaceMcp/` is now a pointer.
- `test/fixtures/serve.ts` — two `Bun.serve` origins on OS-allocated ports, so the cross-origin
  stylesheet is genuinely cross-origin rather than a same-origin file with a different path.
  The sourcemapped module is built in memory, so nothing generated ever lands on disk.
- `test/fixtures/motion-site.test.ts` — bidirectional conformance: the manifest cannot claim a
  case the page doesn't mark, and the page cannot carry one the manifest doesn't declare.
- `scripts/spike-cdp.ts`, `scripts/fixture-serve.ts` — the measurement harness, re-runnable.
- `docs/reports/2026-07-30-cdp-spike.md` + `docs/reports/README.md`.

**Answers (all measured against the fixture, not inferred):**
- **Q1 YES** — one `getEventListeners({depth:-1, pierce:true})` call returned 4/4 declared click
  listeners across light DOM, an open shadow root, and a same-origin iframe.
- **Q2 1.381 MB at 6160 nodes**, 237 B/node marginal → ~0.7 MB at 3000. No allowlist in v1.
- **Q3 YES** — `SecurityError` in-page, 593 bytes via CDP, containing the fixture marker.

**Validation:** `sh scripts/verify.sh` → exit 0; oxlint clean, `tsc --noEmit` clean, `bun test`
10 pass / 0 fail, `bun build` bundled 1 module. Spike re-run after the type fixes returned the
same three verdicts.

**A wrong answer caught before it was recorded:** Q3 first reported NO with
`No style sheet with given id found`. That was a harness bug — `styleSheetId`s are invalidated
by navigation and the harness reloaded after collecting them. Removing the reload changed the
answer to YES. Written up in the report, because a measurement bug that produces a plausible
negative is exactly the failure that would have shaped a v1 interface around a capability that
in fact exists.

**Unplanned finding → #5:** Playwright's client does not complete its handshake under Bun, on
either transport, while raw CDP from Bun works in 99 ms and `chromium.launch` under Node works
in 68 ms. The replay architecture rests on `routeFromHAR`, so the runtime split is now a
developer decision. Worked around for this script only: the spike runs under Node with the
fixture server as a Bun child process.

**Next:** #5 (runtime decision — blocks phase 2), then P1 element identity, which is unblocked.

---

## Repo bootstrap — T4 operating layer (2026-07-30, `/t4-project-bootstrap`, branch `main`)

**Goal:** stand up `clone-space` as an agent-primary T4 repo before any pipeline code exists, so
the first feature already lands on the rails rather than being retrofitted onto them.

**Shipped:**
- `package.json`, `tsconfig.json`, `.gitignore`, `src/index.ts`, `test/index.test.ts` — a minimal
  Bun + TypeScript skeleton whose only job is to make `lint`/`typecheck`/`test`/`build` real
  commands rather than aspirational ones.
- `CLAUDE.md`, `AGENTS.md`, `README.md` — operating manual, agent-agnostic pointer, public readme.
- `docs/agents/{workflow,issue-tracker,triage-labels,domain}.md` — bilingual, per the T4 governed-doc convention.
- `docs/adr/README.md` — index plus the five hard-to-reverse decisions already settled in planning,
  each deferred to the phase that implements it rather than written speculatively.
- `docs/OPEN-WORK-LEDGER.md`, `DONE.md`, `Obsidian-CloneSpaceMcp/` — the memory layer.
- `.claude/` hooks + `t4.json` marker · `.githooks/` pre-push guards · `.github/workflows/t4-verify.yml`
  + `.github/dependabot.yml`.

**Validation:** `bun run verify` → `oxlint` clean, `tsc --noEmit` clean, `bun test` 1 pass / 0 fail,
`bun build` bundled 1 module. Exit code 0, run on Windows with Bun 1.3.14.

**Deliberate omission:** `t4-e2e.yml` was **not** installed. There is no `bun run e2e` yet, and a
workflow that runs a script which doesn't exist is a permanently-red check — which trains everyone
to ignore red. Tracked 🔴 in the ledger; install it with the replay phase.

**Enforcement actually in place — stated precisely, because the T4 standard is stronger than this:**

- Ruleset `20028550` on `main`: PRs required (no direct pushes), review threads must resolve,
  no force-push, no deletion, squash-only.
- `PreToolUse` gate + `.githooks/pre-push` — both bind local commands only.
- **CI required checks are NOT in place.** GitHub Actions is locked on this account for billing;
  all four jobs failed in 2s before running a step. Adding them as required checks would leave
  every PR on *"Expected — waiting for status"* forever, so they were left out on purpose.
  Tracked as #2. **A human merging on the web is currently ungated** — that is the honest gap.
- Secret scanning and push protection verified enabled; Dependabot alerts and security PRs
  enabled. `secret_scanning_validity_checks` and `non_provider_patterns` could not be turned on
  (the API returns 200 and leaves them `disabled`).

**Next:** #3 — build `test/fixtures/motion-site` and answer the three blocking spike questions.

---
