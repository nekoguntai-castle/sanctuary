#!/bin/bash
# PostToolUse hook: run `tsc --noEmit` in the workspace that owns the touched file.
# Fires after Edit/Write on *.ts / *.tsx / *.mts files. Exit 2 with stderr surfaces
# the type error to Claude so it fixes the regression in the same turn instead of
# letting CI catch it. No-op for non-TS files and for tests (typecheck:tests is
# a separate, slower target the user runs explicitly).

set -u

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx|*.mts|*.cts) ;;
  *) exit 0 ;;
esac

# Skip generated / vendored / declaration files.
case "$FILE_PATH" in
  */node_modules/*|*/dist/*|*/.next/*|*.d.ts) exit 0 ;;
esac

# Derived from the edited file, not hardcoded. A fixed absolute path meant that
# editing inside a git worktree typechecked the OTHER checkout — silently, since
# a clean result there looks identical to a clean result here.
REPO_ROOT=$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

# Pick the workspace tsconfig based on the path prefix relative to repo root.
REL="${FILE_PATH#$REPO_ROOT/}"

run_tsc() {
  local dir="$1"
  local cfg="$2"
  cd "$REPO_ROOT/$dir" 2>/dev/null || { echo "typecheck hook: cannot cd to $dir" >&2; exit 0; }
  if [ -n "$cfg" ]; then
    OUTPUT=$(npx --no-install tsc --noEmit -p "$cfg" 2>&1)
  else
    OUTPUT=$(npx --no-install tsc --noEmit 2>&1)
  fi
  STATUS=$?
  if [ $STATUS -ne 0 ]; then
    echo "Type check failed in $dir (touched: $REL):" >&2
    echo "$OUTPUT" | head -40 >&2
    exit 2
  fi
  exit 0
}

case "$REL" in
  server/*)
    run_tsc server ""
    ;;
  gateway/*)
    run_tsc gateway ""
    ;;
  shared/*)
    # shared/ is consumed by all three workspaces; run the cheapest check (root app)
    # and trust the user to run the others if needed.
    run_tsc "" config/tooling/tsconfig.app.json
    ;;
  components/*|hooks/*|services/*|contexts/*|themes/*|utils/*|src/*|App.tsx)
    run_tsc "" config/tooling/tsconfig.app.json
    ;;
  tests/*|e2e/*|scripts/*)
    # Test / script files use separate tsconfigs that are slower and noisier;
    # do not block edits to them on a fast PostToolUse pass.
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
