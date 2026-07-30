# DONE — Agent Session Log

> Newest entry on top. One dated `##` heading per shipped unit so an agent can jump to one.
> When this crosses ~a few hundred lines or a phase closes, move older entries to
> `DONE-archive-<period>.md` and leave a redirect line here.

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
