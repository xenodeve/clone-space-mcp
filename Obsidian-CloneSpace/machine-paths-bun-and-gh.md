---
name: machine-paths-bun-and-gh
description: bun and gh are installed on this machine but absent from the agent process PATH — call them by absolute path
type: reference
---

`bun` and `gh` are installed, but **not reachable by bare name** from an agent shell here.

```
%USERPROFILE%\.bun\bin\bun.exe
C:\Program Files\GitHub CLI\gh.exe
```

**Why:** the agent process receives a curated PATH (measured at 12 entries) rather than the
machine's full one (44 entries). This is not a misconfiguration to fix and it does not change on
restart — it was measured, not assumed. A `command not found` for `bun` or `gh` therefore means
"not on this PATH", never "not installed", and reinstalling will not help.

**How to apply:** prepend them for the duration of a shell call
(`$env:PATH = "$env:USERPROFILE\.bun\bin;$env:PATH"`) or invoke the absolute path. Never conclude
the tool is missing from the machine on the strength of a bare-name failure.

Related: [[developer-xenodeve]]
