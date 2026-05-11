#!/usr/bin/env bash
# Tests for scripts/ci/write-empty-diagnostic-breadcrumb.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BREADCRUMB_SCRIPT="$REPO_ROOT/scripts/ci/write-empty-diagnostic-breadcrumb.sh"

PASS=0
FAIL=0
FAILURES=()

start_test() {
  echo "----- $1"
  CURRENT_TEST="$1"
  CURRENT_DIR="$(mktemp -d)"
}

end_test_pass() {
  PASS=$((PASS + 1))
  echo "PASS: $CURRENT_TEST"
  rm -rf "$CURRENT_DIR"
}

end_test_fail() {
  FAIL=$((FAIL + 1))
  FAILURES+=("$CURRENT_TEST: $*")
  echo "FAIL: $CURRENT_TEST: $*" >&2
  echo "  evidence kept at $CURRENT_DIR" >&2
}

assert_file_exists() {
  local file="$1"
  local label="$2"
  if [ ! -f "$file" ]; then
    end_test_fail "$label: expected file $file"
    return 1
  fi
  return 0
}

assert_file_not_exists() {
  local file="$1"
  local label="$2"
  if [ -e "$file" ]; then
    end_test_fail "$label: unexpected file $file"
    return 1
  fi
  return 0
}

assert_contains() {
  local file="$1"
  local needle="$2"
  local label="$3"
  if ! grep -qF -- "$needle" "$file" 2>/dev/null; then
    end_test_fail "$label: file $file does not contain '$needle'"
    return 1
  fi
  return 0
}

run_breadcrumb() {
  "$BREADCRUMB_SCRIPT" "$@"
}

# ----- 1. no sidecars ------------------------------------------------------
prev_fail=$FAIL
start_test "no sidecars: writes breadcrumb log and failed sidecar"
diag="$CURRENT_DIR/diagnostics"
run_breadcrumb "$diag" "job-failure.log" "Backend Unit Coverage shard 1" >/dev/null
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_file_exists "$diag/job-failure.log" "breadcrumb log" || true
  assert_file_exists "$diag/job-failure.log.status.json" "breadcrumb sidecar" || true
  assert_contains "$diag/job-failure.log" "failed without a failed run-with-log.sh sidecar" "breadcrumb reason" || true
  assert_contains "$diag/job-failure.log.status.json" '"wrapped_exit": 1' "failed wrapped exit" || true
  assert_contains "$diag/job-failure.log.status.json" '"sink_status": "ok"' "sidecar sink status" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 2. failed sidecar exists -------------------------------------------
prev_fail=$FAIL
start_test "failed sidecar exists: does not add duplicate breadcrumb"
diag="$CURRENT_DIR/diagnostics"
mkdir -p "$diag"
cat >"$diag/unit-coverage.log.status.json" <<'JSON'
{
  "schema_version": 1,
  "wrapped_exit": 139,
  "redactor_exit": 0,
  "cap_exit": 0,
  "sink_status": "ok",
  "started_at": "2026-05-11T00:00:00Z",
  "ended_at": "2026-05-11T00:00:01Z",
  "truncated": false
}
JSON
run_breadcrumb "$diag" "job-failure.log" "Backend Unit Coverage shard 1" >/dev/null
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_file_not_exists "$diag/job-failure.log" "duplicate breadcrumb log" || true
  assert_file_not_exists "$diag/job-failure.log.status.json" "duplicate breadcrumb sidecar" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 3. only successful sidecars ----------------------------------------
prev_fail=$FAIL
start_test "only successful sidecars: writes breadcrumb for later job failure"
diag="$CURRENT_DIR/diagnostics"
mkdir -p "$diag"
cat >"$diag/unit-coverage.log.status.json" <<'JSON'
{
  "schema_version": 1,
  "wrapped_exit": 0,
  "redactor_exit": 0,
  "cap_exit": 0,
  "sink_status": "ok",
  "started_at": "2026-05-11T00:00:00Z",
  "ended_at": "2026-05-11T00:00:01Z",
  "truncated": false
}
JSON
run_breadcrumb "$diag" "post-action-failure.log" "Backend Unit Coverage shard 1" >/dev/null
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_file_exists "$diag/post-action-failure.log" "post-action breadcrumb log" || true
  assert_contains "$diag/post-action-failure.log.status.json" '"wrapped_exit": 1' "post-action breadcrumb sidecar" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 4. unsafe basename --------------------------------------------------
prev_fail=$FAIL
start_test "unsafe basename: rejects path traversal"
diag="$CURRENT_DIR/diagnostics"
run_breadcrumb "$diag" "../bad.log" "Backend Unit Coverage shard 1" >"$CURRENT_DIR/stdout" 2>"$CURRENT_DIR/stderr"
status=$?
if [ "$status" -eq 0 ]; then
  end_test_fail "expected non-zero exit"
else
  assert_contains "$CURRENT_DIR/stderr" "log basename must use only" "unsafe basename error" || true
  assert_file_not_exists "$CURRENT_DIR/bad.log" "unsafe path output" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do
    echo "  - $f" >&2
  done
  exit 1
fi
