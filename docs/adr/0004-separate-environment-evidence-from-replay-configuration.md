# ADR 0004 — Separate environment evidence from replay configuration

- **Status:** Pending (2026-08-01) — contract accepted; implementation tracked separately
- **Area:** Capture / replay / archive security
- **Related:** #39 (decision), #29 (P2), plan §6.2, ADR 0003

## Context

The capture stage currently creates a Playwright context with HAR recording, navigates the live
page, performs the adaptive sweep, redacts the staged HAR, and publishes the archive
(`src/capture/record.ts:35-134`). It does not record the browser environment. Replay therefore
cannot distinguish the values it should apply from observations that it can only compare.

The plan requires `environment.json` to cover viewport, device-pixel ratio, locale, timezone,
motion and colour preferences, user agent and browser build, fonts, and origin-scoped storage
(plan §6.2). These fields are not equally replayable. Playwright context options can apply the
viewport and most preferences before navigation. Font availability cannot be reproduced without
shipping host fonts. Storage can contain credentials, personal data, and opaque application state.

A probe against the pinned Playwright 1.62 API established the storage boundary used by this ADR:

- `browserContext.storageState({ indexedDB: true })` can snapshot local storage and IndexedDB;
- context `storageState` can seed local storage before navigation, but it does not contain session
  storage;
- a context init script can seed session storage after the target document receives its origin and
  before the first page script executes.

The fact that IndexedDB is technically serializable does not make it safe archive evidence. Its
records are arbitrary structured values, so a generic credential redactor cannot give the same
content-independent guarantee that ADR 0003 gives request bodies.

## Decision

### Version and compatibility

`environment.json` uses an integer `schemaVersion`. Version 1 readers reject any value other than
`1`, reject missing required fields, and ignore unknown fields. An incompatible field meaning or
shape increments the integer. There is no minor or patch version because replay has no distinct
compatibility decision to make from them.

The v1 logical schema is:

```ts
type EnvironmentV1 = {
  schemaVersion: 1;
  primaryOrigin: string;
  capture: {
    requested: Partial<ReplayContext>;
    observed: {
      viewport: { width: number; height: number };
      devicePixelRatio: number;
      locale: string;
      locales: string[];
      timezoneId: string;
      reducedMotion: "reduce" | "no-preference";
      colorScheme: "light" | "dark" | "no-preference";
      userAgent: string;
      userAgentData?: {
        brands: Array<{ brand: string; version: string }>;
        mobile: boolean;
        platform: string;
      };
      browser: {
        name: "chromium";
        version: string;
        playwrightVersion: string;
        channel?: string;
      };
      fontFaces: {
        entries: Array<{
          family: string;
          style: string;
          weight: string;
          stretch: string;
          status: string;
        }>;
        truncated: boolean;
      };
    };
  };
  replay: {
    context: ReplayContext;
    requiredBrowser: {
      name: "chromium";
      version: string;
      playwrightVersion: string;
      channel?: string;
    };
    storage: {
      origin: string;
      allowlist: {
        localStorage: string[];
        sessionStorage: string[];
      };
      localStorage: Array<{ name: string; value: string }>;
      sessionStorage: Array<{ name: string; value: string }>;
    };
  };
  omissions: {
    storage: {
      policy: "explicit-allowlist";
      omittedLocalStorageEntries: number;
      omittedSessionStorageEntries: number;
      indexedDB: "not-collected";
      cacheStorage: "not-collected";
      cookies: "not-restored";
      crossOriginStorage: "not-collected";
    };
    fonts: "declared-faces-only; host-font availability and text metrics not captured";
  };
};

type ReplayContext = {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  locale: string;
  timezoneId: string;
  reducedMotion: "reduce" | "no-preference";
  colorScheme: "light" | "dark" | "no-preference";
  userAgent: string;
};
```

`capture.requested` records context values supplied by the caller. `capture.observed` records what
the page and browser reported. `replay.context` is the normalized, replayable profile: an explicit
requested value wins; otherwise capture derives it from the corresponding observation. The fallback
mapping is exact: observed viewport becomes `viewport`, `devicePixelRatio` becomes
`deviceScaleFactor`, primary locale becomes `locale`, and the observed timezone, media preferences,
and user agent map to their same-named context fields. Replay applies only `replay`, never
`capture.observed` directly. Keeping both surfaces exposes drift without turning diagnostic evidence
into configuration by accident.

The browser product, `browser.version()`, Playwright package version, optional configured channel,
observed user agent, and low-entropy UA Client Hints are recorded. The required-browser tuple is an
exact equality check over name, version, Playwright version, and channel; an omitted channel matches
only another omitted channel. Replay fails with an unsupported-browser result when that exact tuple
is unavailable rather than fabricating a build identifier or collecting canvas, WebGL, audio,
hardware, host, filesystem, or network fingerprints.

### Fonts

V1 records at most 256 sorted, deduplicated entries exposed by `document.fonts`: family, style,
weight, stretch, and status. These are declared `FontFace` entries, not proof that a face rendered
any glyph. Source URLs are already network evidence in the HAR and are not duplicated here. V1 does
not inventory installed host fonts, embed system-font binaries, patch `document.fonts`, or promise
identical text metrics. Web fonts can load naturally from the HAR; missing system fonts remain an
explicit fidelity limit.

### Origin-scoped storage

V1 publishes values only for exact local-storage and session-storage keys supplied in an explicit
capture allowlist. The default allowlist is empty. Entries not selected by the allowlist are omitted
entirely, including their names; only omission counts are recorded. The allowlist is authorization
to retain those values as sensitive archive evidence, not a claim that a heuristic proved them
secret-free. Values are copied verbatim or omitted — replacing a value with `[REDACTED]` would alter
application branching while looking replayable.

The normalized allowlist is recorded in `replay.storage.allowlist` even when an allowed key did not
exist at the final checkpoint. This makes the caller's authorization auditable. Every published
storage entry must appear in the corresponding normalized allowlist; duplicates are invalid.

`replay.storage.origin` must equal `primaryOrigin`; readers reject the archive otherwise. Storage
scope is the primary origin only. V1 does not use automation privileges to read a
cross-origin frame's storage. Cookies remain covered by ADR 0003 and are not duplicated.
IndexedDB and Cache Storage contents, names, URLs, headers, and bodies are not published. Their
omission is explicit even though Playwright can technically serialize IndexedDB, because arbitrary
records cannot be safely and generically redacted. A future contract can add an independently
reviewed per-store policy without changing what v1 claims.

Capture reads the allowed values at the final capture checkpoint. The checkpoint identifier and
coherence rules belong to §6.3; v1 must not invent a second timing model here.

### Replay order

Replay applies v1 in this order:

1. Validate `schemaVersion`, exact equality of the required browser tuple, and that
   `replay.storage.origin` equals `primaryOrigin`.
2. Create the browser context with `replay.context` and a Playwright `storageState` containing only
   the allowlisted primary-origin local-storage entries. Its concrete shape is
   `{ cookies: [], origins: [{ origin: primaryOrigin, localStorage }] }`; redacted HAR cookies are
   never applied as browser state.
3. Register one context init script that, only when `location.origin` equals `primaryOrigin`, writes
   the allowlisted session-storage entries. It runs after the document gets its origin and before any
   page script.
4. Register `routeFromHAR(..., { notFound: "abort", update: false })`.
5. Create the page and navigate to the original URL. No storage write occurs after navigation.

This preserves the existing architectural rule that the original document and JavaScript execute;
the hydrated DOM is never used as replay bootstrap.

## Alternatives considered

- **One flat environment object.** Rejected: it cannot distinguish evidence from values replay is
  allowed to apply.
- **SemVer for the archive object.** Rejected: only an incompatible-major decision changes reader
  behaviour; minor and patch labels would imply compatibility machinery that does not exist.
- **Automatically retain storage except credential-shaped keys.** Rejected: arbitrary key names and
  values make false negatives inevitable, while placeholder values change boot semantics.
- **Restore all IndexedDB and Cache Storage data.** Rejected for v1: the values are secret-rich,
  structurally arbitrary, and require a separate redaction and provenance contract.
- **Read storage from every frame origin.** Rejected: it expands the trust boundary and conflicts
  with the future multi-target inventory contract.
- **Mock font APIs or ship a host-font census.** Rejected: a mock is false fidelity and a census is
  fingerprint data replay cannot consume.
- **Use `networkidle` to choose the storage snapshot.** Rejected: P2 explicitly forbids it; the
  final checkpoint and §6.10 capture budget determine termination.

## Consequences

- **Positive:** every replay-applied value has a concrete Playwright or init-script mechanism.
- **Positive:** diagnostics can compare requested, observed, and replay values without conflating
  them.
- **Positive:** storage is default-deny and cross-origin isolation is not bypassed.
- **Negative:** a default capture will not reproduce DOM branches driven by storage; callers must
  deliberately allowlist safe keys and the archive records the omission.
- **Negative:** pages whose first render depends on IndexedDB, Cache Storage, or unavailable system
  fonts cannot be faithfully replayed by v1. The archive says so instead of claiming success.
- **Negative:** cookies are intentionally not restored. HAR cookie placeholders are diagnostic
  evidence, not replay state, so cookie-dependent first renders remain unsupported in v1.
- **Negative:** exact browser-build requirements make old archives operationally expensive after a
  Playwright upgrade. That cost is preferred to silently replaying under a different engine.
- **Follow-up:** implementation must add fixture cases for configured/observed drift, media and
  timezone, declared fonts, allowlisted and omitted storage, cross-origin omission, init-script
  ordering, schema rejection, and browser mismatch. It must pass `/security-review` before merge.
