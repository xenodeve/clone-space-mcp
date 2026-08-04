# DONE — Agent Session Log

> Newest entry on top. One dated `##` heading per shipped unit so an agent can jump to one.
> When this crosses ~a few hundred lines or a phase closes, move older entries to
> `DONE-archive-<period>.md` and leave a redirect line here.

---

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
