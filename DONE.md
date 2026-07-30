# DONE — Agent Session Log

> Newest entry on top. One dated `##` heading per shipped unit so an agent can jump to one.
> When this crosses ~a few hundred lines or a phase closes, move older entries to
> `DONE-archive-<period>.md` and leave a redirect line here.

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
- `docs/OPEN-WORK-LEDGER.md`, `DONE.md`, `Obsidian-CloneSpace/` — the memory layer.
- `.claude/` hooks + `t4.json` marker · `.githooks/` pre-push guards · `.github/workflows/t4-verify.yml`
  + `.github/dependabot.yml`.

**Validation:** `bun run verify` → `oxlint` clean, `tsc --noEmit` clean, `bun test` 1 pass / 0 fail,
`bun build` bundled 1 module. Exit code 0, run on Windows with Bun 1.3.14.

**Deliberate omission:** `t4-e2e.yml` was **not** installed. There is no `bun run e2e` yet, and a
workflow that runs a script which doesn't exist is a permanently-red check — which trains everyone
to ignore red. Tracked 🔴 in the ledger; install it with the replay phase.

**Next:** P0 — build `test/fixtures/motion-site` and answer the three blocking spike questions.

---
