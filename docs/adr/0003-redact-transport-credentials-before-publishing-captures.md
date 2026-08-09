# ADR 0003 — Redact transport credentials before publishing captures

- **Status:** Accepted (2026-08-01) — implemented by `captureHar`
- **Area:** Capture / archive security
- **Related:** #36 (implementation), #29 (P2), plan §6.1, `src/capture/redact.ts`

## Context

Capture uses Playwright HAR recording with `mode: "full", content: "attach"`
(`src/capture/record.ts:40-44`). A localhost probe against the pinned Playwright 1.62.0 measured
three storage locations that matter to the trust boundary:

- authorization and cookie headers, cookie arrays, query strings and `Set-Cookie` are plaintext
  fields in `network.har`;
- attached request bodies are separate files named by `request.postData._file`;
- response resource bodies are separate files named by `response.content._file`.

The archive is intended to reproduce a page offline, so response resource bodies are evidence rather
than incidental logging. Removing every response body would make the archive safe by making it
useless. Conversely, retaining request credentials makes an archive unsafe to hand to another tool
or person. The boundary therefore needs an explicit threat model rather than a claim that arbitrary
captured page content is secret-free.

Playwright provides `omit`, `embed`, and `attach` content policies but no field-level redaction.
Playwright must flush before redaction, but writing raw files directly into the published directory
creates a second leak: an ordinary navigation failure or retry can leave an old sidecar there.

## Decision

Each capture records into a new private sibling staging directory. An ordinary failure removes that
directory. A successful run closes Playwright, redacts and validates the staged archive, then
publishes the whole directory with a same-filesystem rename. The final output directory must be
absent or empty; capture refuses to mix artifacts with pre-existing files. This is the minimum
publication boundary for §6.1, not §6.8's future hashes, versions, validation manifest, and commit
marker.

Every published capture has its **transport credentials** redacted:

- Header names are matched case-insensitively. `Authorization`, `Proxy-Authorization`, `Cookie`,
  and `Set-Cookie` are always sensitive. Custom header names containing `api-key`, or ending in
  `token`, `secret`, or `credential` after separator normalization, are sensitive too. Their values
  become `[REDACTED]`.
- Every value in HAR request and response cookie arrays becomes `[REDACTED]`; cookie names and
  structure remain available for diagnosis.
- Query keys are matched case-insensitively after removing `-`, `_`, and `.` separators against
  this fixed policy: `access_token`, `accesskey`, `api_key`, `apikey`, `auth`, `authorization`,
  `client_secret`, `code`, `credential`, `id_token`, `key`, `password`, `passwd`, `refresh_token`,
  `secret`, `session`, `sig`, `signature`, and `token`. Their values become `[REDACTED]` in both
  `request.url` and `request.queryString`.
- URL userinfo is redacted. Credential-like query values are also redacted inside `Referer`,
  `Location`, `Content-Location`, and HAR `redirectURL` values.
- Every attached request body becomes the UTF-8 payload `[REDACTED]\n`. Its `_file` reference is
  retained, `bodySize` and `Content-Length` are updated, and inline text/params are emptied. This is
  deliberately content-type independent: trying to infer which arbitrary body fields are secrets
  would turn a guarantee into a heuristic.
- Playwright's attached WebSocket frame stream contains both client-sent and server-received
  messages, so a WebSocket entry's entire sidecar also becomes `[REDACTED]\n`. Ordinary HTTP
  response bodies remain intact.

Every `_file` reference — including retained response content — is treated as untrusted archive
data. Absolute paths, lexical traversal, non-regular files, symlinks, multi-link files, and real
paths outside the archive root are refused before any attachment is read or written
(`src/capture/redact.ts:154-179`).
The archive root and referenced attachment directories are chmod `0o700`; the HAR plus referenced
attachments are chmod `0o600` before return (`src/capture/redact.ts:199-261`). POSIX mode bits are
enforceable on POSIX systems. On Windows, Node's `chmod` does not establish a private ACL, so this
is hardening rather than an ACL guarantee.

This contract makes no claim that response bodies or source assets contain no application data,
PII, or embedded token. A capture remains sensitive evidence and must be handled accordingly.

## Alternatives considered

- **Use `content: "omit"`.** Rejected: replay loses the response bodies it exists to serve.
- **Redact only `network.har`.** Rejected by measurement: request bytes remain in
  `postData._file` sidecars.
- **Inspect JSON/form keys and preserve non-secret request-body fields.** Rejected: encrypted,
  binary, custom, malformed, and mislabelled bodies turn the policy into a bypassable heuristic.
- **Remove all response bodies too.** Rejected: response content is the archive's primary evidence.
- **Encrypt the archive.** Deferred: key distribution and decryption move rather than remove the
  credential boundary, and no archive container/key contract exists yet.

## Consequences

- **Positive:** a successfully returned archive no longer exposes the browser's reusable transport
  credentials through the known HAR fields or attached request bodies.
- **Positive:** attachment paths cannot redirect redaction or permission changes outside the archive
  root.
- **Negative:** strict HAR replay cannot match an original POST body or an original signed/query URL
  after redaction. Revised PRD #84 gives query normalization an explicit, default-empty policy and
  keeps redacted POST bodies fail-closed and unsupported in v1; #85 must prove that consumer contract
  against pinned Playwright before ADR 0007 accepts it.
- **Negative:** WebSocket frames are intentionally unavailable for replay. Contract §6.4 must mark
  the archive WebSocket-dependent instead of allowing an empty replay to look successful.
- **Negative / limit:** response evidence may itself be sensitive. Users must not interpret
  “credentials redacted” as “archive safe for public release.”
- **Negative / limit:** a process or machine crash can leave the private staging directory behind.
  POSIX parent permissions keep it private; Windows `chmod` is not an ACL guarantee. Recovery,
  hashes, producer/schema versions, and a commit marker belong to transactional-integrity contract
  §6.8.
