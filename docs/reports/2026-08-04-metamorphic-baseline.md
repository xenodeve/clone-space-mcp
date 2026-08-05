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

### Discrimination against #20 (measured 2026-08-05, issue #78)

The corrected transform was, until this measurement, an **unproven mechanism** by this repo's own
rule: the 32/400 against 135/400 that justified building the check belonged to the transform #76
showed was wrong, and could not be carried across. #78 recorded that the direction was genuinely
open, and planned for the corrected check turning out honest but useless.

It did not. Same seed, same 400 cases, with #20's fix reverted by the corpus entry
`fingerprint-key-gates-on-ordinal-and-text`:

| | Count |
|---|---:|
| Fixed code | **2/400** |
| #20 restored (`fingerprintKey` gates on ordinal and text hash) | **179/400** |

**Read those as two counts, not as a ratio.** `179 / 2` is 89.5, and an earlier draft of this
section led with that number. It is not a statistic: on a floor of 2, one case either way moves the
multiplier by tens, so almost all of its precision is denominator noise. The finding is that the
counts differ by two orders of magnitude, and nothing finer than that is supported.

### By what mechanism, stated so it is not oversold

The rise is **mediated entirely by the ordinal shift the harness itself introduces**, and that is
not a flaw in the measurement — it is #20's failure path:

1. `scripts/metamorphic.ts:116-121` increments `siblingOrdinal` for every same-parent, same-tag
   sibling at or after the insertion point. That is what inserting a node into a page does.
2. With the defect restored, `fingerprintKey` has `siblingOrdinal` back as an **equality**
   component, so each shifted sibling's key stops matching its capture counterpart.
3. `reconcile` pools candidates by that key (`src/identity/reconcile.ts:102`), so those elements
   lose their bucket and the match count drops.

So this measures *"an unrelated insertion elsewhere in the page destroys matches"* — the exact
sentence #20 was filed for, and the one `test/identity/reconcile.test.ts:121` pins. **It is not a
second, independent signal**, and the number should not be read as the metric having discovered
something the unit test did not.

What it does establish is the narrower thing #78 asked for: after #76 retracted the old transform,
**the corrected harness still responds to a real defect**, so it is no longer an unproven mechanism.
That claim needed a measurement; the existence of the unit test could not supply it.

**This is still not a gate**, for the reason in the next section.

Re-run it with:

```text
bun run metamorphic -- --against fingerprint-key-gates-on-ordinal-and-text
```

The defect is applied to `src/identity/fingerprint.ts` **in memory**, by a `Bun.plugin` `onLoad`
hook registered through `--preload` in the child that takes the measurement (#82). The tracked file
is never written, so *"the working tree is unchanged after a measurement"* is true by construction
rather than defended by a restore. An anchor that no longer matches throws inside the child and is
reported as `MUTATION NOT APPLIED`, because a mutation that silently fails to apply would report
"no discrimination" from unmutated code.

**Only the corpus entries this harness actually executes are accepted** — today `reconcile.ts` and
`fingerprint.ts`, as an explicit set rather than a `src/identity/` prefix, since `inject.ts` is
inside that prefix and is imported by nothing here. Pointing it at a capture-side entry would
rewrite a file the run never reads and print two equal counts, indistinguishable in the output from
the metric genuinely failing to see a defect.

**There is no restore, and therefore nothing for a kill to skip.** The first version of this
measurement wrote the defect into the tracked file and defended it — a `finally`, signal handlers,
an ownership check, a `git status` guard. That apparatus was retired by #82 once the in-memory hook
was shown to work in both runtimes, and the reason it had to go is worth keeping: the in-process
half of it was measured and found narrower than it looked. On Windows neither
`Bun.Subprocess.kill()` nor `process.kill(pid, "SIGINT")` runs a `SIGINT`/`SIGTERM` handler, so the
**programmatic kill that actually left a defect applied during #78 was never covered at all** —
while the code and this report both said it was.

A guarantee that has to be defended by handlers is a guarantee that fails in exactly the case
nobody rehearsed. Removing the write removes the case.

## Why this is a metric, not an assertion

The metamorphic check is deliberately not part of `bun test`, `bun run verify`, or the mutation
corpus. Correct `reconcile` code can legitimately lose matches after an unrelated node is added:
the extra candidate can expose a genuinely ambiguous element, which should be reported unresolved
rather than guessed. A non-zero count is therefore expected and legitimate.

The comparable figure is **a prior run of this harness at this seed**, not #24's 32/400, which came
from the transform retracted above. Drift against that prior run is information for a human; it is
not a gate. The 2-against-179 contrast does not change this: it shows the metric can see a defect
of #20's kind, not that every drop it counts is a defect.

## Re-run

```text
bun run metamorphic
bun run metamorphic -- --against <mutation-id>
```

The first prints the seed, case count, observed drop count, historical baseline, and delta. The
second re-runs the same cases with a corpus defect restored and prints the separation. The seeded
PRNG makes this corpus reproducible without using `Math.random()`.
