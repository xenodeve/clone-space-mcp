# ADR 0002 — `wa:` element identity, with fingerprint reconciliation and an explicit unresolved state

- **Status:** Accepted (2026-07-31) — reconciliation **and** injection implemented (#9)
- **Area:** Identity
- **Related:** #9 (the work), #3 (`test/fixtures/motion-site`, which supplies the hard cases), `UBIQUITOUS_LANGUAGE.md` (the terms used here)

## Context

Every later stage references elements by name: the **behavior graph** attributes each animation to
a target, screenshots and computed styles are keyed by element, and comparing **capture** to
**replay** is element-by-element. Change the naming scheme after archives exist and every one of
them becomes unreadable. That is why this is decided in its own phase, ahead of capture, rather
than falling out of whichever stage happened to need it first.

The difficulty is not naming. It is that **capture and replay are two separate constructions of
the same page.** Replay re-executes the page's own JavaScript (ADR 0001 context, and the
commitment in `CLAUDE.md`), so the DOM is built again, in an order that is only mostly the same.
A name meaning "the 47th node I walked" does not survive that.

The fixture's `delete-and-reinsert` case sharpens it: an element leaves the tree and an identical
one comes back. No amount of recorded structure distinguishes them.

## Decision

### 1. The id form and who assigns it

`wa:<frame-key>:<sequence>`, assigned by **the same injected module on capture and on every
replay pass** — not an equivalent script, the same one, or the two runs drift by construction.

- **`sequence`** is a per-frame counter assigned in deterministic preorder, driven by a
  `MutationObserver` on `document` from init time so nodes added during parsing are seen. The
  snapshot returns **everything ever seen**, not everything currently attached: an element removed
  before the snapshot keeps its last known fingerprint, because otherwise the archive's contents
  depend on which side of a timer the snapshot landed on (`src/identity/inject.ts` — `seen`).
- **`attachShadow` is patched, but not for the walk.** An open root is readable through
  `el.shadowRoot`, so the walk enters it without any patch. What needs the patch is the
  **observer**: a `MutationObserver` on `document` does not see inside a shadow root, so each new
  open root has to be observed as it is created. Closed roots remain unreachable either way.
- **`frame-key`** is `<parent key>/<owning element's stable evidence>` — tag plus its stable
  attribute subset. Top frame is `0`; the fixture's iframe yields
  `0/iframe|data-identity-case=iframe`.

  An earlier draft used the occurrence index among same-URL siblings. That was the same
  positional flaw as #20 one level up: reorder two `<iframe>` and their namespaces swap silently,
  taking every id inside them with it. Deriving from the owning element's own evidence makes a
  frame exactly as identifiable as that element is — and the frame key is part of the fingerprint
  bucket key, so it has to be stable across runs, which a `wa:` id would not be.

  **Limit:** `window.frameElement` is null for a cross-origin frame, so an out-of-process iframe
  gets no key from this mechanism. It is a separate CDP target and needs its own handling.

### 2. A `wa:` id is a handle, not a key

It names an element **within one run** and means nothing across two. This is the point most likely
to be misread, and misreading it produces a ตัวจับคู่ that compares id strings and reports total
failure on an archive that is fine.

Recognition across runs comes from a **fingerprint** — tag, a small stable **attribute** subset,
sibling ordinal, text hash, **โหนดแม่** (`src/identity/fingerprint.ts:9`).

**The fingerprint is split in two, and the split is the point** (#20). Only what survives an
unrelated edit elsewhere in the page forms the bucket key — frame key, tag, and the stable
attribute subset (`src/identity/fingerprint.ts:45`). Sibling ordinal and text hash **rank**
candidates that already share a key (`src/identity/fingerprint.ts:65`); they do not gate the
lookup.

The first version put both in the key, and it did not merely make matching harder: one unrelated
node inserted above a target shifted its ordinal, so an element carrying a unique stable attribute
was reported `missing` with zero candidates **while the node it should have matched appeared in
`replayOnly`** — a result contradicting itself. Evidence generates candidates; it does not qualify
them.

**Ranking scores exact agreement only — there is deliberately no "closest ordinal wins."** When a
whole run of identical siblings shifts, proximity scoring pairs every one of them off confidently
and gets the entire run wrong. Exact-only scoring makes such a run come back `identity-unresolved`,
which is the outcome this ADR exists to produce.

**`parentId` is deliberately excluded from the fingerprint key** (`src/identity/fingerprint.ts:40`).
It is itself a `wa:` id, so it differs between runs by construction; including it would make every
child of a re-numbered parent unmatchable — the exact failure it appears to prevent.

Parentage still disambiguates, but **transitive**: `reconcile` processes elements parent-first
(`src/identity/reconcile.ts:93`) so a matched parent narrows its children's candidates
(`src/identity/reconcile.ts:107`). That is what resolves three identical `<li>`, and what resolves
two same-shaped elements under different parents without depending on emission order.

### 3. An unidentifiable element is reported, never guessed

`identity-unresolved` is a first-class result with two reasons — `missing`
(`src/identity/reconcile.ts:114`) and `ambiguous` (`src/identity/reconcile.ts:130`) — and it
carries its candidate list so a later pass can adjudicate instead of hitting a dead end.

An **unresolved parent does not narrow its child's candidates** (`src/identity/reconcile.ts:107`),
so one uncertainty cannot become a chain of confident wrong answers.

Two refusals in the same spirit: reconciling across schema versions throws rather than comparing
incompatible fingerprints (`src/identity/reconcile.ts:78`), and **replay-only** elements are
reported rather than discarded, because replay producing something capture never saw is a fidelity
signal in its own right.

### 4. `identity.json` is versioned on its own

`IDENTITY_SCHEMA_VERSION` is separate from any future behavior-graph version, so improving one
does not invalidate archives for the other.

## Alternatives considered

- **Sequential ids assigned only at capture, matched by string.** Rejected — replay rebuilds the
  DOM and the counter lands elsewhere. This is the approach that looks correct until the first real
  archive.
- **Pure structural paths (`body > div:nth-child(3) > li:nth-child(2)`).** Rejected — breaks on
  duplicate siblings the moment anything is inserted before them, and cannot express a
  delete-and-reinsert at all.
- **A ตัวจับคู่ that always returns a best guess.** Rejected, and this is the one worth stating
  loudly: it is *more convenient at every call site*, which is why it is tempting. It answers
  delete-and-reinsert wrongly, and that wrong answer becomes mis-attributed animation data in the
  behavior graph several stages later, with nothing left to signal it. **`identity-unresolved` is
  the feature.**
- **Including `parentId` in the fingerprint key.** Rejected for the reason in Decision 2 — it looks
  like more precision and is actually a guarantee of failure.

## Consequences

- **Positive:** ids are stable enough to key everything downstream, and the one case that cannot be
  resolved is visible rather than silently wrong. The pure half needs no browser, so most of the
  risk is covered by 16 fast tests (`test/identity/reconcile.test.ts`).
- **Negative / limits:**
  - **Closed shadow roots are out of reach.** `attachShadow` can be patched for open roots only.
  - **Out-of-process iframes are a separate CDP target** and will need their own injection and
    their own session — spike Q1 confirmed piercing works for a *same-origin* iframe, which does
    not predict an OOPIF.
  - Downstream consumers must handle `identity-unresolved` rather than assuming a total mapping.
  - The fingerprint's attribute subset must exclude anything a framework rewrites on hydration
    (generated ids, scoped-style hashes, `style`). Getting that subset wrong turns a recognisable
    element into an unrecognisable one, and it is not yet pinned by a test.
- **Follow-ups:** the exit criterion is met against the fixture — 63 elements, 63 matched, 0
  unresolved, 0 replay-only, all five hard cases matched. **Read that number for what it is:** it
  compares two runs of the same page under the same conditions, which is the easiest form of the
  problem. Real capture→replay differs in timing and serves its resources from a HAR, so this is
  a floor, not a ceiling. The number to watch is how it moves once the replay stage exists.
  Until that lands, this ADR's Decision 1 is a design, not an observation.
