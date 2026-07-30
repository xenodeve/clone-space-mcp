# AGENTS.md

This repo's operating manual is **[`CLAUDE.md`](CLAUDE.md)** — read it first, regardless of which
agent you are. It carries the north-star, repo layout, commands, the session-start read protocol,
and what is mechanically enforced.

Two things that bind you even though the Claude Code hooks do not:

- **`pre-push` guards.** `.githooks/` re-checks that every push carries a GitHub issue reference
  and blocks a large dirty tree or committed build artifacts. Opt in once per clone:
  `git config core.hooksPath .githooks`.
- **CI required checks.** `lint`, `typecheck`, `test`, `build` are required on `main`, and direct
  pushes to `main` are blocked. Nothing merges past a red check.

The ship gate is `bun run verify`.
