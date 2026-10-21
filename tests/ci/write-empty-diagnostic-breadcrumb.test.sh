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

write_sidecar() {
  local path="$1"
  local exit_line="$2"
  cat >"$path" <<JSON
{
  "schema_version": 1,
$exit_line
  "redactor_exit": 0,
  "cap_exit": 0,
  "sink_status": "ok",
  "started_at": "2026-10-13T00:00:00Z",
  "ended_at": "2026-10-13T00:08:00Z",
  "truncated": false
}
JSON
}

# A completed setup step: its log plus an exit-0 run-with-log.sh sidecar.
write_succeeded_step() {
  local diag="$1"
  echo 'install output' >"$diag/install-server-dependencies.log"
  write_sidecar "$diag/install-server-dependencies.log.status.json" '  "wrapped_exit": 0,'
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
  # sanctuary#1009: verify-vectors run 14568 (job 184154) failed via a podman
  # "context deadline exceeded" copying SUMMARY.md out of the job container
  # after every captured verification step had already succeeded. The generic
  # breadcrumb text left that indistinguishable from an actual proof
  # regression; it must name this as a post-verification runner/infra fault.
  assert_contains "$diag/post-action-failure.log" "captured verification step(s) succeeded" "post-verification infra wording" || true
  assert_contains "$diag/post-action-failure.log" "not a proof regression" "post-verification infra wording" || true
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

# ----- 5. step log hard-killed without a sidecar (run 21164 shape) --------
prev_fail=$FAIL
start_test "sidecar-less step log: names the interrupted step, not an infra fault"
diag="$CURRENT_DIR/diagnostics"
mkdir -p "$diag"
write_succeeded_step "$diag"
echo 'killed mid-profile' >"$diag/psbt-account-binding-mutation.log"
run_breadcrumb "$diag" "verify-vectors-mutation-binding-failure.log" "Verify Vectors PSBT account-binding mutation" >/dev/null
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  log="$diag/verify-vectors-mutation-binding-failure.log"
  assert_contains "$log" "psbt-account-binding-mutation.log" "unfinished step log named" || true
  assert_contains "$log" "never finished" "interrupted wording" || true
  assert_contains "$log" "Verify Vectors PSBT account-binding mutation" "title survives the heredoc" || true
  assert_contains "$log" "timeout-minutes" "timeout wording survives the heredoc" || true
  assert_not_contains "$log" "not a proof regression" "no infra wording" || true
  assert_not_contains "$log" "verify-vectors-mutation-binding-failure.log" "breadcrumb does not list itself" || true
  assert_contains "$log.status.json" '"wrapped_exit": 1' "breadcrumb sidecar" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 6. step log whose sidecar has no wrapped_exit ---------------------
prev_fail=$FAIL
start_test "unreadable sidecar: the step log counts as interrupted"
diag="$CURRENT_DIR/diagnostics"
mkdir -p "$diag"
echo 'partial output' >"$diag/step.log"
write_sidecar "$diag/step.log.status.json" '  "note": "no exit recorded",'
run_breadcrumb "$diag" "job-failure.log" "Backend Unit Coverage shard 1" >/dev/null
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_contains "$diag/job-failure.log" "step.log" "unreadable-sidecar log named" || true
  assert_contains "$diag/job-failure.log" "never finished" "interrupted wording" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 7. nested sidecar-less step log ------------------------------------
prev_fail=$FAIL
start_test "nested sidecar-less step log: listed relative to the diagnostic directory"
diag="$CURRENT_DIR/diagnostics"
mkdir -p "$diag/sub"
write_succeeded_step "$diag"
echo 'killed' >"$diag/sub/step.log"
run_breadcrumb "$diag" "job-failure.log" "Backend Unit Coverage shard 1" >/dev/null
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_contains "$diag/job-failure.log" "sub/step.log" "nested log named" || true
  assert_contains "$diag/job-failure.log" "never finished" "interrupted wording" || true
  assert_not_contains "$diag/job-failure.log" "not a proof regression" "no infra wording" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 8. guard: a sidecar-less non-log file is not a step ----------------
prev_fail=$FAIL
start_test "sidecar-less non-log file: keeps the post-verification infra wording"
diag="$CURRENT_DIR/diagnostics"
mkdir -p "$diag"
write_succeeded_step "$diag"
echo 'redacted npm output' >"$diag/npm-deprecation-install.redacted.txt"
run_breadcrumb "$diag" "job-failure.log" "Dependency audit" >/dev/null
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_contains "$diag/job-failure.log" "not a proof regression" "infra wording" || true
  assert_not_contains "$diag/job-failure.log" "never finished" "no interrupted wording" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 9. guard: run-parallel-suites.sh logs finish through .status -------
prev_fail=$FAIL
start_test "suite log with a sibling .status: counts as finished"
diag="$CURRENT_DIR/diagnostics"
mkdir -p "$diag/sub"
write_succeeded_step "$diag"
echo 'suite output' >"$diag/sub/0.log"
echo 0 >"$diag/sub/0.status"
run_breadcrumb "$diag" "job-failure.log" "CI classifier tests" >/dev/null
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
else
  assert_contains "$diag/job-failure.log" "not a proof regression" "infra wording" || true
  assert_not_contains "$diag/job-failure.log" "never finished" "no interrupted wording" || true
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
