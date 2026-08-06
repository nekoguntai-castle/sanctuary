#!/usr/bin/env bash
# Tests for scripts/ci/write-diagnostic-summary.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SUMMARY_SCRIPT="$REPO_ROOT/scripts/ci/write-diagnostic-summary.sh"
RUN_WITH_LOG="$REPO_ROOT/scripts/ci/run-with-log.sh"

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

assert_not_contains() {
  local file="$1"
  local needle="$2"
  local label="$3"
  if grep -qF -- "$needle" "$file" 2>/dev/null; then
    end_test_fail "$label: file $file unexpectedly contains '$needle'"
    return 1
  fi
  return 0
}

run_summary() {
  local diag_dir="$1"
  local title="$2"
  local summary_file="$3"
  SANCTUARY_CI_STEP_SUMMARY_FILE="$summary_file" "$SUMMARY_SCRIPT" "$diag_dir" "$title"
}

# ----- 1. empty directory -------------------------------------------------
prev_fail=$FAIL
start_test "empty directory: summary and index are still written"
diag="$CURRENT_DIR/diagnostics"
summary="$CURRENT_DIR/summary.md"
run_summary "$diag" "Empty Job" "$summary"
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_contains "$summary" "## Empty Job Diagnostics" "summary title" || true
  assert_contains "$summary" "No diagnostic logs were found." "empty summary" || true
  assert_contains "$diag/diagnostic-index.md" "No diagnostic logs were found." "empty artifact index" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 2. run-with-log success -------------------------------------------
prev_fail=$FAIL
start_test "run-with-log success: table captures sidecar fields"
diag="$CURRENT_DIR/diagnostics"
summary="$CURRENT_DIR/summary.md"
mkdir -p "$diag"
"$RUN_WITH_LOG" "$diag/install.log" bash -c 'echo "API_TOKEN=secret-value"; echo "install ok"'
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "run-with-log success fixture failed with $status"
else
  run_summary "$diag" "Frontend Coverage" "$summary"
  assert_contains "$summary" '| `install.log` | `0` | `ok` | `False` |' "success row" || true
  assert_contains "$summary" "Records needing attention: \`0\`" "success attention count" || true
  assert_contains "$diag/diagnostic-index.md" '| `install.log` | `install.log.status.json` | `0` | `ok` | `False` |' "index row" || true
  assert_not_contains "$summary" "secret-value" "summary must not include log body" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 3. wrapped failure and truncation ----------------------------------
prev_fail=$FAIL
start_test "failed/truncated sidecar: attention count and fields are visible"
diag="$CURRENT_DIR/diagnostics"
summary="$CURRENT_DIR/summary.md"
mkdir -p "$diag"
cat > "$diag/coverage.log" <<'LOG'
coverage failed
LOG
cat > "$diag/coverage.log.status.json" <<'JSON'
{
  "schema_version": 1,
  "wrapped_exit": 17,
  "redactor_exit": 0,
  "cap_exit": 0,
  "sink_status": "ok",
  "started_at": "2026-05-10T00:00:00Z",
  "ended_at": "2026-05-10T00:00:01Z",
  "truncated": true
}
JSON
run_summary "$diag" "Coverage" "$summary"
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_contains "$summary" "Records needing attention: \`1\`" "attention count" || true
  assert_contains "$summary" '| `coverage.log` | `17` | `ok` | `True` |' "failed row" || true
  assert_contains "$diag/diagnostic-index.md" '`2026-05-10T00:00:00Z`' "index started_at" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 4. missing and malformed sidecars ----------------------------------
prev_fail=$FAIL
start_test "missing/malformed sidecars: summary remains best-effort"
diag="$CURRENT_DIR/diagnostics"
summary="$CURRENT_DIR/summary.md"
mkdir -p "$diag"
echo "log without sidecar" > "$diag/missing.log"
echo "log with malformed sidecar" > "$diag/malformed.log"
printf '{not json' > "$diag/malformed.log.status.json"
run_summary "$diag" "Malformed" "$summary"
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_contains "$summary" '| `missing.log` | `n/a` | `n/a` | `n/a` |' "missing sidecar row" || true
  assert_contains "$summary" "missing sidecar" "missing sidecar label" || true
  assert_contains "$summary" '| `malformed.log` | `n/a` | `n/a` | `n/a` |' "malformed sidecar row" || true
  assert_contains "$summary" "malformed: JSONDecodeError" "malformed label" || true
  assert_contains "$summary" "Records needing attention: \`2\`" "attention count" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 5. sidecar without log ---------------------------------------------
prev_fail=$FAIL
start_test "sidecar without log: missing log is indexed"
diag="$CURRENT_DIR/diagnostics"
summary="$CURRENT_DIR/summary.md"
mkdir -p "$diag"
cat > "$diag/orphan.log.status.json" <<'JSON'
{
  "schema_version": 1,
  "wrapped_exit": 0,
  "redactor_exit": 0,
  "cap_exit": 0,
  "sink_status": "ok",
  "started_at": "2026-05-10T00:00:00Z",
  "ended_at": "2026-05-10T00:00:01Z",
  "truncated": false
}
JSON
run_summary "$diag" "Orphan" "$summary"
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_contains "$summary" '| `orphan.log` | `0` | `ok` | `False` | `missing` | ok |' "orphan row" || true
  assert_contains "$summary" "Records needing attention: \`1\`" "orphan attention count" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 6. retired LAN publisher -------------------------------------------
prev_fail=$FAIL
start_test "retired LAN publisher is absent from the diagnostic path"
if [ -e "$REPO_ROOT/scripts/ci/publish-failed-logs.sh" ]; then
  end_test_fail "retired publisher script still exists"
else
  assert_not_contains "$SUMMARY_SCRIPT" "publish-failed-logs.sh" "summary no longer invokes retired publisher" || true
  assert_not_contains "$SUMMARY_SCRIPT" "SANCTUARY_CI_LOG_SINK" "summary no longer depends on retired sink environment" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- killed mid-step: log present, sidecar never written ----------------
# run-with-log.sh writes the sidecar only after the wrapped command returns, so
# a step killed by its own timeout leaves a log with no sidecar. That case used
# to be filtered out of the echo alongside a clean exit 0 ("n/a" covered both),
# which is why sanctuary#699's verify-vectors timeouts produced no readable
# evidence at all. The tail must be echoed for it.
prev_fail=$FAIL
start_test "missing sidecar: the log tail is still echoed"
diag="$CURRENT_DIR/diagnostics"
summary="$CURRENT_DIR/summary.md"
stderr_file="$CURRENT_DIR/stderr.txt"
mkdir -p "$diag"
cat > "$diag/address-verifier.log" <<'LOG'
waiting for bitcoind, attempt 59
KILLED_MID_STEP_MARKER
LOG
run_summary "$diag" "Verify Bitcoin Vectors" "$summary" 2>"$stderr_file"
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_contains "$stderr_file" "KILLED_MID_STEP_MARKER" "killed-step log body echoed" || true
  assert_contains "$stderr_file" "::group::Failed log tail (address-verifier.log" "killed-step group header" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- clean run: nothing is echoed ---------------------------------------
# Guards the other side of the change above: widening the echo selector must
# not start dumping logs on green runs.
prev_fail=$FAIL
start_test "clean sidecar: no log tail is echoed"
diag="$CURRENT_DIR/diagnostics"
summary="$CURRENT_DIR/summary.md"
stderr_file="$CURRENT_DIR/stderr.txt"
mkdir -p "$diag"
cat > "$diag/happy.log" <<'LOG'
SHOULD_NOT_BE_ECHOED
LOG
cat > "$diag/happy.log.status.json" <<'JSON'
{
  "schema_version": 1,
  "wrapped_exit": 0,
  "redactor_exit": 0,
  "cap_exit": 0,
  "sink_status": "ok",
  "started_at": "2026-05-10T00:00:00Z",
  "ended_at": "2026-05-10T00:00:01Z",
  "truncated": false
}
JSON
run_summary "$diag" "Verify Bitcoin Vectors" "$summary" 2>"$stderr_file"
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_not_contains "$stderr_file" "SHOULD_NOT_BE_ECHOED" "clean log body not echoed" || true
  assert_not_contains "$stderr_file" "Failed log tail" "no failed-tail header on a clean run" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- summary ------------------------------------------------------------
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
