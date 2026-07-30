#!/bin/sh
# The ship gate, resolved for callers that don't have bun on PATH.
#
# `.claude/t4.json` points "verify" here rather than at `bun run verify` directly:
# the T4 PreToolUse gate runs the command in the agent process's environment, and
# on at least one machine here that environment gets a curated PATH with no bun in
# it. A gate that fails with `bun: command not found` blocks every merge for a
# reason that has nothing to do with the code, so resolution lives in one place.
#
# Order: PATH first (honour whatever the caller set up), then the default install
# location bun uses on every platform.
set -e

if command -v bun >/dev/null 2>&1; then
  BUN=bun
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
elif [ -x "$HOME/.bun/bin/bun.exe" ]; then
  BUN="$HOME/.bun/bin/bun.exe"
else
  echo "verify: bun not found on PATH or in \$HOME/.bun/bin — install it from https://bun.sh" >&2
  exit 127
fi

exec "$BUN" run verify
