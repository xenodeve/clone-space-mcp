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

## No verdict before evidence

*Fixed · works · passes · safe · done · the root cause is* are claims about the world. Each needs
the command you ran, its output, or the `file:line` you read, named alongside it. Otherwise label
it a hypothesis. **"Tests not run" is a complete sentence.** A claim's register never improves by
being repeated.

## Dev notifications

Notify the developer on: a long task or TDD cycle completing, needing a confirmation before
closing an issue or merging, or an AFK batch finishing. Not on routine sub-progress.
