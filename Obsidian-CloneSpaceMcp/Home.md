# clone-space-mcp — Team Memory (Map of Content)

> Read this index first each session; open only the linked notes the current task touches.
> One note = one memory. Unresolved `[[links]]` = memories worth writing.

## feedback — how agents should work here
- [[evidence-before-claims]] — the developer requires a run before a claim; confident conclusions have been overturned by one A/B test
- [[verify-where-the-bug-can-reproduce]] — a fix validated in conditions where the bug cannot occur proves nothing
- [[review-lanes-have-different-blind-spots]] — measured on #47: three reviews on one model family missed what another family found in one pass; two calls to the same model are one voice
- [[equivalent-but-simpler-needs-evidence]] — "same properties, smaller change" is a claim about runtime behaviour; on #47 a four-line probe refuted it, four commits too late
- [[an-existence-check-is-three-checks]] — `stat` succeeding is not "a file inside this directory"; the hardened form already existed in the repo and was rewritten weakly beside it
- [[a-blocked-method-is-not-a-blocked-task]] — #78 was parked as "needs the developer" because reverting a merged fix was assumed to need `git reset`; the state was reproducible in-process and the park was wrong
- [[a-reviewer-can-rewrite-your-working-tree]] — a clink reviewer ran `bun run mutate` because the prompt named it; killing it skipped the `finally` and left a defect applied in `src/`
- [[remove-the-write-dont-guard-it]] — four guards accumulated around one write, and the one added for the actual incident was measured not to fire; applying the defect in memory deleted the whole problem
- [[tightening-is-not-a-policy-decision]] — a security review's three findings were all parked as the developer's call; two only ever narrowed what the tool may do, and over-asking has no corrective signal
- [[python-text-mode-rewrites-every-line-ending]] — a one-line Python edit converted two files to CRLF and broke mutation anchors it never touched; git normalises on commit, so the diff is clean and only the working tree is wrong
- [[a-corpus-anchor-rots-when-review-feedback-edits-its-line]] — acting on a review finding invalidated an anchor written minutes earlier; `mutate` says FAILED, a third state that measures nothing and reads like noise beside forty CAUGHT
- [[an-observation-boundary-is-delivery-not-occurrence]] — a flag that ignores events after a point bounds when the callback ran, not when the thing happened; on #117 a reviewer showed the gap that `verify` and `mutate` both passed over
- [[a-selector-is-a-position-not-an-identity]] — a plan decided at one moment and executed at another must re-validate; on #176 a live page invalidated 28 of 32 selectors while the plan ran
- [[a-fixture-edit-can-delete-a-corpus-entry-silently]] — a mechanism has dependencies it does not declare; a fixture edit removed the only case one corpus entry could fail on, and only `mutate` said so
- [[a-control-that-samples-one-side-is-blind-to-the-other]] — the gate proved stability on the live page and judged live-against-replay; four of five proposed fixes were refuted by building them
- [[a-value-has-more-than-one-spelling]] — a guard matching on text sees only the forms it was built from; measuring one capture found the bracketed IPv6 the HAR actually holds, and only an adversarial reviewer found the two spellings nothing had produced
- [[a-mutation-run-can-leave-the-defect-behind]] — removing a guard makes what it prevented actually happen; a test that names a fixed path published an archive there and failed the next honest run on the wrong rule
- [[a-closing-keyword-fires-on-its-prefix]] — `Closes #171's acceptance criteria 5 and 7` closed #171; the narrowing clause is invisible to the parser, and the session then posted "deliberately staying open" onto an issue its own PR had closed
- [[the-corpus-reach-ends-at-the-process-boundary]] — a defect applied in memory reaches only what the test process loads; a spawned CLI or the Bun fixture server reports `MUTATION NOT APPLIED`, which reads like a hiccup and measures nothing
- [[a-rule-keyed-on-a-tracker-state-inherits-that-state]] — *"do not call the gate complete until #2 closes"* returned the wrong answer for two days after #2 was wrongly closed; key a completeness rule on a command, and resolve a recorded contradiction instead of recording it

## project — ongoing goals / constraints not derivable from the code
- [[replay-reexecutes-original-js]] — the architectural commitment the whole project rests on, and the approach it rejects
- [[replay-is-a-different-timing-environment]] — a page that measures itself without waiting for its webfont races and a replay resolves it differently; the fix that worked took the live case 5/20 → 0/20, and the reading that separates it from the near-miss is that its control *reproduced*
- [[fixture-first-not-real-sites]] — exit criteria are checked against a controlled fixture with known ground truth, never a live site
- [[machine-paths-bun-and-gh]] — `bun` and `gh` are installed but absent from the process PATH on this machine

## reference — pointers to external resources
- [[planning-provenance]] — where the archiver plan came from and what it already settled

## user — who the developer is
- [[developer-xenodeve]] — language, working style, what they expect from a session
