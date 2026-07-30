# clone-space — Agent Operating Manual

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
src/            pipeline stages: capture · replay · extract · serve (see src/index.ts)
test/           bun test suite; test/fixtures/ holds the controlled fixture site
docs/agents/    how agents work here — workflow, tracker, labels, domain
docs/adr/       architecture decision records
docs/OPEN-WORK-LEDGER.md   every open item, tracked AND untracked — read at session start
DONE.md         ship log, newest on top
Obsidian-CloneSpace/       team memory vault; Home.md is the index
.claude/        T4 hooks + the t4.json marker
.githooks/      agent-agnostic pre-push guards (opt in: git config core.hooksPath .githooks)
```

## Commands

Bun is the package manager **and** the runtime here.

| Task | Command |
|---|---|
| install | `bun install` |
| lint | `bun run lint` |
| typecheck | `bun run typecheck` |
| unit tests | `bun test` |
| build | `bun run build` |
| **ship gate** | `bun run verify` (lint → typecheck → test → build) |

`bun` and `gh` are installed but **not on this machine's process PATH**. Use the absolute paths:
`%USERPROFILE%\.bun\bin\bun.exe` and `C:\Program Files\GitHub CLI\gh.exe`.

## Session-start read protocol

1. `Obsidian-CloneSpace/Home.md` — skim the index; open only the notes this task touches.
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
- **CI required checks** — `lint`, `typecheck`, `test`, `build` are required on `main` and direct
  pushes to `main` are blocked. This is the layer that also binds a human merging on the web.

Everything else — TDD discipline, `/simplify`, review depth — is agent discipline.

## Writing conventions

- **GitHub tracker bodies are bilingual (EN + a full Thai mirror)** — issue bodies, PRD bodies,
  PR descriptions. The Thai mirrors the English exactly: same sections, same depth, same tables.
  "สรุป" does not mean "shorter". Code identifiers, filenames, and log excerpts stay English.
- **Governed agent docs** (`docs/agents/*`, and `CONTEXT.md` / `PRODUCT.md` / `DESIGN.md` once they
  exist) use `<!-- lang:en -->` / `<!-- lang:th -->` markers with a full mirror.
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
