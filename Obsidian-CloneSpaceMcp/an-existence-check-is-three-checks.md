---
name: an-existence-check-is-three-checks
description: "`stat` succeeding is not "a file inside this directory" — it accepts directories and follows symlinks; the repo already had the hardened form and it was not reused"
type: feedback
---

When validating an archive-relative path, **"the file exists" is three separate checks**, and the
obvious one-liner only performs the first:

1. it resolves to something — `stat` / `lstat`
2. that something is a **regular file** — `lstat(...).isFile()`, using `lstat` so a symlinked final
   component fails rather than being followed
3. the **resolved** path is still inside the root — `realpath` both, then compare

**Why:** on #52 the existence guard was written as `await stat(join(root, harPath))`. Measured
against the real validator, three inputs it was meant to refuse came back `{ ok: true }` — none of
them needing a symlink:

```
har.path "."            nothing created      -> { ok: true }   the staging root itself
har.path "network.har"  created as directory -> { ok: true }
har.path "net"          created as directory -> { ok: true }
```

Step 3 is the one that is easy to argue away, because step 2 looks like it covers escapes. It does
not: `lstat` on `link/file.har` follows the **intermediate** junction and reports a real file. Only
comparing the realpaths catches it, and a directory junction is creatable on Windows without
elevation, so it is testable rather than theoretical.

**The part worth carrying past this repo:** the hardened version **already existed here**, in
`src/capture/redact.ts` as `staysWithin` / `resolveAttachedFile`, doing all three plus a symlink
rejection. It was not reused, and the weak version was written from scratch beside it. Two
independent review lanes had to find that. **Before writing a filesystem predicate, grep for one.**

Here the duplication was then deliberate — `redact.ts` is the secret-handling module and a standing
park condition for unattended runs, so the equivalent was written locally with a comment saying so.
Unifying them is a decision for the developer, not something to take while the module is parked.

Related: [[evidence-before-claims]], [[equivalent-but-simpler-needs-evidence]],
[[review-lanes-have-different-blind-spots]]
