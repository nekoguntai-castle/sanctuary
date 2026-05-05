#!/usr/bin/env bash
# Smoke-tests for the provider-leak gate: it should pass on the current
# tree (because we just refactored every legitimate callsite), and it should
# detect a synthetic leak when one is added.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="$ROOT_DIR/scripts/ci/check-provider-leaks.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

main() {
  # ---- The current tree must pass the gate -----------------------------
  if ! bash "$CHECKER" >/dev/null 2>&1; then
    fail "current tree fails the leak gate (run scripts/ci/check-provider-leaks.sh to inspect)"
  fi

  # ---- A fake repo with a deliberate leak should be caught -------------
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "'"$tmp"'"' EXIT

  local stage="$tmp/stage"
  mkdir -p "$stage/scripts/ci"
  # Mirror just the bits the checker needs to find: itself, plus a
  # deliberately-leaking helper.
  cp "$ROOT_DIR/scripts/ci/check-provider-leaks.sh" "$stage/scripts/ci/check-provider-leaks.sh"
  cat > "$stage/scripts/should-be-flagged.sh" <<'EOF'
#!/usr/bin/env bash
# A new helper script that reads provider envs directly. Should fail the gate.
echo "$GITHUB_RUN_ID"
printf '%s\n' "x=1" >> "$GITHUB_OUTPUT"
EOF

  (
    cd "$stage"
    git init -q .
    git config user.email t@t
    git config user.name t
    git add -A
    git commit -qm leak >/dev/null
    if bash "scripts/ci/check-provider-leaks.sh" >"$tmp/out" 2>&1; then
      fail "leak gate failed to flag a deliberate leak"
    fi
    grep -q "should-be-flagged.sh" "$tmp/out" || fail "leak report did not mention the offending file: $(cat "$tmp/out")"
  )

  echo "check-provider-leaks regression checks passed"
}

main "$@"
