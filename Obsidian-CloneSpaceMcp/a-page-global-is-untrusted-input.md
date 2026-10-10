---
name: a-page-global-is-untrusted-input
description: "Anything an init script leaves on `globalThis` is writable by the page that runs after it; on #215 a new registry was read without a shape check beside one that already was, and one assignment made extract_behaviour throw"
type: feedback
---

**A value an init script puts on the page's global object is input from the page by the time it
is read back.** Page scripts run after the init script, in the same realm, and can overwrite it —
usually by accident, with a global that happens to share the name.

**Why:** on #215 the provenance registry `__wap` was read in `collectInPage` as
`win.__wap?.stacks.get(object)`. One line in the page —

```
window.__wap = { stacks: 1, libraries: 2 }
→ page.evaluate: TypeError: win.__wap?.stacks.get is not a function
```

— turned an extraction that succeeds on `main` into an `extract_behaviour` that **throws**, so the
tool could not describe the page at all. The existing observation layer's `__i` buffer, written by
the same kind of init script, already had the defensive read: `drainedObservations` in
`src/capture/instrument.ts` checks every field's shape and says *"the page is not a trusted
producer."* The new code was written beside it and did not reuse the stance. Found by
`/scrutinize` tracing the in-page → Node seam, not by any of the twelve tests written from the
design.

**How to apply:** when code reads back something an init script installed — a registry, a buffer,
a counter — check its shape before using it (`instanceof WeakMap`, `Array.isArray`, `typeof x ===
"string"`), and make the failure mode *lose the data* rather than *lose the run*. Test it with a page
that clobbers the global; corpus entry `provenance-registry-read-trusts-the-page` holds the case.
Related: [[an-existence-check-is-three-checks]] (the hardened form already existed and was not
reused), [[a-value-has-more-than-one-spelling]].
