# AGENTS.md

This repo's operating manual is **[`CLAUDE.md`](CLAUDE.md)** — read it first, regardless of which
agent you are. It carries the north-star, repo layout, commands, the session-start read protocol,
and what is mechanically enforced.

Two things that bind you even though the Claude Code hooks do not:

- **`pre-push` guards.** `.githooks/` re-checks that every push carries a GitHub issue reference
  and blocks a large dirty tree or committed build artifacts. Opt in once per clone:
  `git config core.hooksPath .githooks`.
- **Branch ruleset.** Direct pushes to `main` are blocked — everything arrives through a PR — and
  unresolved review threads block merge. **CI required checks are not active yet**: GitHub Actions
  is locked on this account for billing, so `lint`/`typecheck`/`test`/`build` never report and were
  deliberately kept out of the ruleset rather than deadlocking every PR (issue #2). Until that
  closes, a merge performed on the web is not gated by anything.

The ship gate is `bun run verify`.
