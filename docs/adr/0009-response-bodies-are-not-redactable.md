# ADR 0009 — Response bodies are not redactable, and what that obliges instead

- Status: **Accepted**
- Date: 2026-08-14
- Issues: #127 (finding 3), #124 (the tool surface that raised it)

## Context

A `/security-review` of the first caller-facing tool surface returned three High findings. Two were
narrowings and were fixed in the same branch: `outDir` now refuses any existing path and any UNC
path, and a URL is refused when it resolves to a loopback, link-local or private address unless
`allowPrivateNetwork` is passed.

The third was not a narrowing:

> `src/capture/redact.ts` removes cookies, heuristically-named headers and query keys, attached
> request bodies and WebSocket frame bodies. It does **not** remove ordinary response bodies,
> inline `postData.text`, or HTML/API payloads — so capturing an authenticated internal page
> publishes its contents into a directory the caller chose.

It was reported as a policy question. It is not one.

## Decision

**Response bodies stay in the archive.** They are not redactable, and no option to strip them will
be added.

## Why it is forced rather than chosen

Replay serves the archive with `routeFromHAR(har, { notFound: 'abort' })` and navigates the
original URL so the page's real JavaScript re-executes. **Every response body is the material it
re-executes from** — the document, the scripts, the stylesheets, the JSON an app boots from. Strip
them and `notFound: 'abort'` refuses everything, replay produces a blank page, and extract has no
behaviour to find.

That is not a degraded archive; it is not an archive. The project's stated measure of done is
"disconnect the network → replay → watch the motion actually run", and an archive without bodies
cannot reach any part of it.

So the choice is not *redact or not*. It is *archive or not*.

## What this obliges instead

Because the risk cannot be removed from the artifact, it has to be removed from the situation:

- **The tool says so before it is called.** `capture_page`'s description carries the warning in the
  words an agent reads while deciding: the archive contains the page, so it must not be pointed at
  an authenticated or internal page whose contents should not reach whoever can read the output
  directory.
- **The README says so too**, in the section describing what an archive is, rather than in a
  footnote.
- **The two narrowings that were possible were made**, and are mutation-proven —
  `capture-tool-writes-over-an-existing-path` and `capture-tool-reaches-the-private-network`.
- **Transport credentials are still redacted** (ADR 0003). That is a different claim and it holds:
  cookies and auth headers are not the page's content and stripping them costs replay nothing.

## Residual risk, stated plainly

An operator who captures an authenticated internal page produces a directory containing that page's
contents, readable by anyone who can read the directory. Nothing in this repo prevents that, and
after this ADR nothing is expected to.

## What would reopen this

A replay design that does not serve bodies from the archive — for example one that re-fetches from
a live origin — would change the premise. This project rejects that design for other reasons
(ADR 0001, and the north-star commitment in `CLAUDE.md`), so reopening this means reopening those
first.
