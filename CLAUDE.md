# clone-space-mcp — Agent Operating Manual

> **This repo is agent-primary.** The coding agent is the main developer; these docs are its
> operating manual, not team paperwork. Read this file, then follow the session-start protocol below.

## Entry point: `using-t4`

**Invoke the `using-t4` skill first.** It is the map that routes a task to the right `t4-*` skill.
Don't work from memory — skills evolve.

## Engineering north-star

Archive a live web page so that:

1. it **replays offline with real fidelity** — carousels, GSAP/ScrollTrigger, CSS animation
   genuinely run, not a frozen skeleton; and
2. an **AI agent can consume it** and explain how the page is built and where the motion is.

The measure of done is not "the HTML was saved". It is: disconnect the network → `capture` a
GSAP-heavy page → `replay` and watch the motion actually run → `extract` a behavior graph →
`serve` it and have an agent answer *"what makes the hero move?"* correctly, citing file and line.

**The load-bearing architectural commitment:** replay navigates the **original URL** with the
original document HTML, served from a HAR via `routeFromHAR(..., { notFound: 'abort' })`, so the
page's **real JavaScript re-executes**. Serializing the hydrated DOM as the executable bootstrap
is the approach this project explicitly rejects — it breaks hydration and entry animations, which
is the whole point. See `docs/adr/`.

## Repo layout

```
UBIQUITOUS_LANGUAGE.md     canonical term glossary — it wins on any naming conflict
src/            pipeline stages: capture · replay · extract · serve (see src/index.ts)
test/           bun test suite; test/fixtures/ holds the controlled fixture site
docs/agents/    how agents work here — workflow, tracker, labels, domain
docs/adr/       architecture decision records
docs/superpowers/plans/    the pipeline design and its reasoning — read before proposing a change to it
docs/OPEN-WORK-LEDGER.md   every open item, tracked AND untracked — read at session start
DONE.md         ship log, newest on top
Obsidian-CloneSpaceMcp/       team memory vault; Home.md is the index
.claude/        T4 hooks + the t4.json marker
.githooks/      agent-agnostic pre-push guards (opt in: git config core.hooksPath .githooks)
```

## Commands and the runtime split

**Node runs anything that drives a browser. Bun runs everything else.** This is not a preference
— Playwright's client does not complete its handshake under Bun, measured on both transports
(ADR [0001](docs/adr/0001-node-drives-the-browser-bun-runs-everything-else.md)). Don't "fix" a
browser script by moving it to Bun.

| Task | Command | Runtime |
|---|---|---|
| install | `bun install` | Bun |
| lint | `bun run lint` | Bun |
| typecheck | `bun run typecheck` | Bun |
| unit tests | `bun test` | Bun |
| build | `bun run build` | Bun |
| **ship gate** | `bun run verify` (lint → typecheck → test → build) | Bun |
| fixture server | `bun run fixture:serve` | Bun (`Bun.serve` + `Bun.build`) |
| CDP spike | `bun run spike` | **Node** |

A Node process that needs the fixture starts it as a **Bun child process** and reads its origins
from stdout — `scripts/fixture-serve.ts` plus `startFixtureServers` in `scripts/spike-cdp.ts`.
That is the sanctioned way to cross the boundary; capture and replay will use the same shape.

`bun` and `gh` are installed but **not on this machine's process PATH**. Use the absolute paths:
`%USERPROFILE%\.bun\bin\bun.exe` and `C:\Program Files\GitHub CLI\gh.exe`.

## Session-start read protocol

1. `Obsidian-CloneSpaceMcp/Home.md` — skim the index; open only the notes this task touches.
2. `docs/OPEN-WORK-LEDGER.md` — current open work. 🔴 UNTRACKED rows are the highest miss-risk.
3. The GitHub issue you are picking up — `gh issue view <n> --comments`.
4. `DONE.md` / `docs/adr/` — only if the task needs history or a prior decision.

Stop pulling detail once you have enough for the task.

## Workflow

Full pipeline in `docs/agents/workflow.md`. The short form:

**`/grill-me` → survey the change sites → `/to-prd` → `/to-issues` → `/tdd`**

**Hard gate: PRD → issues → PR.** Never open a PR without a referenced issue.

## What is mechanically enforced

- `PreToolUse` gate (`.claude/hooks/t4-gate`) — denies `gh pr create` with no referenced issue;
  denies dangerous git (`reset --hard`, force-push, `clean -f`, `branch -D`); **runs
  `bun run verify` itself** before `gh pr merge` and denies on failure.
- `pre-push` guards (`.githooks/`) — re-check the issue reference and block a large dirty tree or
  committed build artifacts, for every agent and human on the clone, not just Claude.
  Opt in once per clone: `git config core.hooksPath .githooks`.
- **Branch ruleset `20028550`** on `main` — direct pushes blocked (everything arrives through a
  PR), unresolved review threads block merge, no force-push, no deletion, squash-only.
- **CI required checks — NOT in place.** `.github/workflows/t4-verify.yml` is installed and
  correct, but **GitHub Actions is locked on this account for billing**, so the jobs never run.
  They were deliberately left out of the ruleset: a required check that never reports leaves every
  PR stuck on *"Expected — waiting for status"*. Tracked as **#2**.

  **The honest consequence: a human merging on the web is currently ungated.** The two bullets
  above only bind commands run locally. Do not describe this repo's gate as complete until #2 closes.

Everything else — TDD discipline, `/simplify`, review depth — is agent discipline.

## Writing conventions

- **GitHub tracker bodies are bilingual (EN + a full Thai mirror)** — issue bodies, PRD bodies,
  PR descriptions. The Thai mirrors the English exactly: same sections, same depth, same tables.
  "สรุป" does not mean "shorter". Code identifiers, filenames, and log excerpts stay English.
- **Governed agent docs** (`docs/agents/*`, and `CONTEXT.md` / `PRODUCT.md` / `DESIGN.md` once they
  exist) use `<!-- lang:en -->` / `<!-- lang:th -->` markers with a full mirror.
- **Domain terms come from `UBIQUITOUS_LANGUAGE.md`**, which wins on any conflict. Three words are
  ambiguous in this project and must never appear unqualified: **snapshot** (CDP call vs identity
  snapshot vs doc status), **manifest** (fixture vs tool), and **id** — a `wa:` id is a **handle**
  within one run, never a key across runs. Reading it as a key is how you write a ตัวจับคู่ that
  compares strings and reports total failure on a good archive.
- **Never invent a Thai word for a term of art.** This is the rule agents get wrong: "identifiers
  stay English" is not enough, because a *concept* like `pure function` gets calqued into
  something no one says and the sentence stops meaning anything. The glossary below is the
  developer's own choice — a mixed list, not a preference for English:

  | Concept | Call it | | Concept | Call it |
  |---|---|---|---|---|
  | pure function | **pure function** | | source of truth | **source of truth** |
  | reconciler | **ตัวจับคู่** | | constraint | **ข้อบังคับ** |
  | parent node | **โหนดแม่** | | layering | **layering** |
  | handle | **handle** | | failure mode | **รูปแบบความผิดพลาด** |
  | transitive | **transitive** | | attribute | **attribute** |

  For anything not listed, the test is: **would a Thai developer say it out loud in a stand-up?**
  If not, keep the English term. And prefer plain description to metaphor — say which part is
  riskiest and why, rather than that something "แบกความเสี่ยง".
- **Chat, reports, and status updates are Thai** (the developer's language). Code, commit
  messages, and inline comments stay English.

## Mechanisms over judgment

**An agent's diagnosis is not reliable enough to be the safety net — including its diagnosis of
which safety net works.** This repo leans on things the machine decides: types, tests, mutation
checks, the ground-truth fixture, CI gates. Prefer those over anything that depends on an agent
reading code carefully.

Three consequences that are not obvious:

- **More tests written from the same design add no safety.** #20 was live while twelve tests
  passed, because every one of them was written from the design that contained the flaw. It was
  found by an agent that ran an experiment nobody had thought to run.
- **A safety mechanism is unproven until it is run against a bug that actually happened.**
  "This would have caught X" is a hypothesis. Reverting X, running the mechanism, and restoring X
  is the evidence. A partition invariant was predicted to catch #20 and measurably does not
  (0/400 either way); a metamorphic check does (32/400 → 135/400). The prediction was wrong and
  only measurement showed it.
- **Say whether a check is a pass/fail assertion or a baseline metric.** That metamorphic check is
  a metric — correct code still loses matches in 32/400 cases, legitimately. Reporting a metric as
  an assertion manufactures false confidence in both directions.

## A red check is fixed, not merged past

If a PR's checks are not green, **fix them**. Merging anyway requires a **checkable fact** about
why the check cannot pass — one a reviewer can verify without redoing your reasoning. "It's
unrelated", "it's flaky", "it's slow", and "I'm confident" are not facts.

**There is exactly one standing exemption today, and it has an expiry.**

GitHub Actions is locked account-wide for billing (#2). Verified by reading the job annotation
rather than inferred: `The job was not started because your account is locked due to a billing
issue.` Every job of every run fails in seconds without executing a step. Conditions on using it:

- It is **restated in the body of every PR that merges under it**, so the exemption is visible
  rather than assumed.
- It **expires the moment a workflow run actually completes.** At that point
  `.claude/t4.json` gets `"requireGreenCI": true` and this stops being a rule anyone has to
  remember — `t4-gate` denies the merge itself.

**Why the expiry is the important half:** a perpetually-red gate that everyone merges past is
worse than no gate, because it teaches that red means nothing. This exemption is only tolerable
because it names one externally-caused, verifiable condition and says when it ends.

## No verdict before evidence

*Fixed · works · passes · safe · done · the root cause is* are claims about the world. Each needs
the command you ran, its output, or the `file:line` you read, named alongside it. Otherwise label
it a hypothesis. **"Tests not run" is a complete sentence.** A claim's register never improves by
being repeated.

## Dev notifications

Notify the developer on: a long task or TDD cycle completing, needing a confirmation before
closing an issue or merging, or an AFK batch finishing. Not on routine sub-progress.
