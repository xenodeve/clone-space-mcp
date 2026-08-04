# Metamorphic `reconcile` baseline (2026-08-04)

**Status:** SNAPSHOT — point-in-time measurement. Re-run rather than edit: `bun run metamorphic`.

The harness generates identity snapshot pairs with the repository's `IdentitySnapshot` and
`ElementFingerprint` shapes, then compares `reconcile(capture, replay)` with the same replay
snapshot after adding one replay-only node. The measured value is the number of cases in which
the resolved-match count drops.

| | |
|---|---|
| Harness | `scripts/metamorphic.ts` |
| Seed | `0x24080426` |
| Cases | 400 |
| Issue | #24 |

## Measurement

| | Count |
|---|---:|
| Observed drop count | **78/400** |
| #24 recorded baseline | **32/400** |
| Delta | **+46/400** |

The observed figure differs materially from the 32/400 historical baseline. This is a finding
about this generator's corpus, not a reason to tune it toward the recorded number. The generator
uses small tag and stable-attribute pools, which create more repeated fingerprint buckets than
the historical corpus likely did; that is the current explanation for the higher count, not a
measured equivalence between the two corpora.

## Why this is a metric, not an assertion

The metamorphic check is deliberately not part of `bun test`, `bun run verify`, or the mutation
corpus. Correct `reconcile` code can legitimately lose matches after an unrelated node is added:
the extra candidate can expose a genuinely ambiguous element, which should be reported unresolved
rather than guessed. A non-zero count is therefore expected and legitimate. Drift from 32/400 is
information for a human about the generator and reconciler; it is not a gate.

## Re-run

```text
bun run metamorphic
```

The command prints the seed, case count, observed drop count, historical baseline, and delta. The
seeded PRNG makes this corpus reproducible without using `Math.random()`.
