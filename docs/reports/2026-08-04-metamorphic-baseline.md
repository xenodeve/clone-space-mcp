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

### Retraction of the previous measurement

The previously reported **78/400** is **RETRACTED**. That run did not measure the unrelated
replay-only node described by this report: the old transform spread a real replay element and
changed only its `id` and sibling ordinal. Because `fingerprintKey` ignores `id`, it measured an
inserted duplicate sharing the source's fingerprint bucket. The resulting match drops were often
the correct ambiguity handling for that different transform.

The previous explanation that the higher count came from small tag and stable-attribute pools is
also **RETRACTED**. It explained the duplicate transform, not a measured corpus difference.

### Corrected measurement

| | Count |
|---|---:|
| Corrected observed drop count | **2/400** |
| #24 recorded baseline | **32/400** |
| Delta from #24 figure | **-30/400** |

The corrected transform preserves the injected element's real parent and its effect on same-tag
sibling ordinals, while adding the stable `data-metamorphic-unrelated=case-<index>` attribute.
That attribute is absent from the real capture and original replay corpus, so the injected node is
unmatchable by `fingerprintKey`. The harness asserts that its key collides with no element in
`capture` before reconciling; a collision is a harness failure with a non-zero exit.

## Why this is a metric, not an assertion

The metamorphic check is deliberately not part of `bun test`, `bun run verify`, or the mutation
corpus. Correct `reconcile` code can legitimately lose matches after an unrelated node is added:
the extra candidate can expose a genuinely ambiguous element, which should be reported unresolved
rather than guessed. A non-zero count is therefore expected and legitimate. Drift from 32/400 is
information for a human about the corrected generator and reconciler; it is not a gate.

## Re-run

```text
bun run metamorphic
```

The command prints the seed, case count, observed drop count, historical baseline, and delta. The
seeded PRNG makes this corpus reproducible without using `Math.random()`.
