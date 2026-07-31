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

Playwright provides `omit`, `embed`, and `attach` content policies but no field-level redaction. The
redaction has to happen after `BrowserContext.close()` flushes the HAR and before `captureHar`
returns its path (`src/capture/record.ts:105-110`).

## Decision

Every successfully returned capture has its **transport credentials** redacted in place:

- Header names are matched case-insensitively. Values of `Authorization`,
  `Proxy-Authorization`, `Cookie`, and `Set-Cookie` become `[REDACTED]`.
- Every value in HAR request and response cookie arrays becomes `[REDACTED]`; cookie names and
  structure remain available for diagnosis.
- Query keys are matched case-insensitively against this fixed policy:
  `access_token`, `api_key`, `apikey`, `auth`, `authorization`, `client_secret`, `code`,
  `credential`, `id_token`, `key`, `password`, `passwd`, `refresh_token`, `secret`, `session`,
  `sig`, `signature`, and `token`. Their values become `[REDACTED]` in both `request.url` and
  `request.queryString`.
- Every attached request body becomes the UTF-8 payload `[REDACTED]\n`. Its `_file` reference is
  retained, `bodySize` and `Content-Length` are updated, and inline text/params are emptied. This is
  deliberately content-type independent: trying to infer which arbitrary body fields are secrets
  would turn a guarantee into a heuristic.

Every `_file` reference — including retained response content — is treated as untrusted archive
data. Absolute paths, lexical traversal, final-component symlinks, and real paths outside the
archive root are refused before any attachment is read or written (`src/capture/redact.ts:82-105`).
The archive root is chmod `0o700` and the HAR plus referenced attachments are chmod `0o600` before
return (`src/capture/redact.ts:116-156`). POSIX mode bits are enforceable on POSIX systems. On
Windows, Node's `chmod` does not establish a private ACL, so this is hardening rather than an ACL
guarantee.

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
- **Negative:** strict HAR replay of POST requests cannot match the original body after redaction.
  Contract §6.5 must define request normalization before such requests can replay.
- **Negative / limit:** response evidence may itself be sensitive. Users must not interpret
  “credentials redacted” as “archive safe for public release.”
- **Negative / limit:** a crash between Playwright's flush and redaction can leave raw files. Private
  staging, hashes and a commit marker belong to transactional-integrity contract §6.8.
