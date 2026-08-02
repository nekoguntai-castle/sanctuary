#!/usr/bin/env bash
# Regression: the quick backend and gateway lanes must actually select tests.
#
# detect-changes emits repo-root-relative paths (`server/src/...`,
# `gateway/src/...`) while those lanes set `working-directory:` to that same
# workspace. Vitest resolves `related` entries against its root
# (resolve(resolved.root, file)), so the untranslated paths became
# `server/server/src/...` / `gateway/gateway/src/...`, matched nothing, and
# `--passWithNoTests` exited 0 — two REQUIRED PR checks that never ran a test.
# These cases pin the translation that closes that hole.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SUT="$REPO_ROOT/scripts/ci/related-test-args.sh"

PASS=0
FAIL=0
FAILURES=()

pass() {
  PASS=$((PASS + 1))
  echo "PASS: $1"
}

fail() {
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
  echo "FAIL: $1"
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$label"
  else
    fail "$label (expected [$expected], got [$actual])"
  fi
}

# --- the core defect, per workspace ---------------------------------------

actual="$(RELATED_FILES='server/src/utils/jwt.ts' bash "$SUT" server)"
assert_eq 'strips the server/ prefix' 'src/utils/jwt.ts' "$actual"

actual="$(RELATED_FILES='gateway/src/middleware/auth.ts' bash "$SUT" gateway)"
assert_eq 'strips the gateway/ prefix' 'src/middleware/auth.ts' "$actual"

# The translated paths must exist relative to the lane's working directory.
# These are the assertions that would have caught the bug: the untranslated
# forms resolve to server/server/... and gateway/gateway/...
for pair in "server:src/utils/jwt.ts" "gateway:src/middleware/auth.ts"; do
  ws="${pair%%:*}"
  rel="${pair#*:}"
  if [ -f "$REPO_ROOT/$ws/$rel" ]; then
    pass "translated path resolves from the $ws/ working directory"
  else
    fail "translated path does not exist: $ws/$rel"
  fi
  if [ -e "$REPO_ROOT/$ws/$ws" ]; then
    fail "$ws/$ws unexpectedly exists; the regression premise is stale"
  else
    pass "untranslated $ws path would not have resolved (bug premise holds)"
  fi
done

# --- list handling ---------------------------------------------------------

actual="$(RELATED_FILES='server/src/a.ts server/tests/unit/b.test.ts' bash "$SUT" server | tr '\n' '|')"
assert_eq 'translates every entry in the list' 'src/a.ts|tests/unit/b.test.ts|' "$actual"

actual="$(RELATED_FILES='' bash "$SUT" server | wc -l | tr -d ' ')"
assert_eq 'empty input yields no arguments' '0' "$actual"

actual="$(bash "$SUT" server | wc -l | tr -d ' ')"
assert_eq 'unset input yields no arguments' '0' "$actual"

actual="$(RELATED_FILES='server/src/a.ts  server/src/b.ts' bash "$SUT" server | wc -l | tr -d ' ')"
assert_eq 'collapses repeated separators' '2' "$actual"

# --- idempotence and prefix safety ----------------------------------------

actual="$(RELATED_FILES='src/utils/jwt.ts' bash "$SUT" server)"
assert_eq 'already-relative paths pass through unchanged' 'src/utils/jwt.ts' "$actual"

# Only the leading segment is stripped: a nested directory of the same name
# must survive, otherwise real files would be mangled.
actual="$(RELATED_FILES='server/src/server/index.ts' bash "$SUT" server)"
assert_eq 'strips only the leading workspace segment' 'src/server/index.ts' "$actual"

# A workspace prefix must not be stripped from another workspace's paths.
actual="$(RELATED_FILES='gateway/src/a.ts' bash "$SUT" server)"
assert_eq 'leaves a foreign workspace prefix intact' 'gateway/src/a.ts' "$actual"

actual="$(bash "$SUT" server server/src/a.ts)"
assert_eq 'accepts positional arguments' 'src/a.ts' "$actual"

# --- input validation ------------------------------------------------------

if bash "$SUT" >/dev/null 2>&1; then
  fail 'missing workspace argument should be rejected'
else
  pass 'missing workspace argument is rejected'
fi

if RELATED_FILES='server/src/a.ts' bash "$SUT" 'server/nested' >/dev/null 2>&1; then
  fail 'multi-segment workspace should be rejected'
else
  pass 'multi-segment workspace is rejected'
fi

# --- the workflow must actually use the translation ------------------------

WORKFLOW="$REPO_ROOT/.github/workflows/test.yml"
normalized="$(tr '\n' ' ' < "$WORKFLOW" | tr -s ' ')"

for ws in server gateway; do
  if printf '%s' "$normalized" | grep -q "related-test-args.sh\" $ws"; then
    pass "test.yml routes the $ws lane through the translation"
  else
    fail "test.yml does not translate changed files for the $ws lane"
  fi
done

# Integration specs must stay out of the quick backend lane regardless of where
# they live, so its Postgres-free guarantee holds.
if printf '%s' "$normalized" | grep -q -- "--exclude \"tests/integration/\*\*\" --exclude \"\*\*/\*.integration.test.\*\""; then
  pass 'quick backend lane excludes integration specs by directory and by name'
else
  fail 'quick backend lane is missing an integration exclusion'
fi

echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
