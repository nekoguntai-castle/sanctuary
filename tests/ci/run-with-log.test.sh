#!/usr/bin/env bash
# Tests for scripts/ci/run-with-log.sh
#
# Coverage (per the CI diagnostics plan):
#   - successful wrapped command yields exit 0, redacted log, valid sidecar
#   - wrapped failure preserves wrapped exit; sidecar reflects status
#   - tee/pipefail-style mask regression: a "successful" sink does not
#     mask a wrapped failure (wrapped_exit propagates verbatim)
#   - missing/non-executable redactor surfaces a fail-closed error and a
#     non-zero exit; no half-written log claiming success
#   - unwritable log path is reported with a clear diagnostic
#   - missing arguments produce a clear usage error
#   - cap is honored; truncation marker appears; sidecar.truncated=true;
#     wrapped exit still propagates rather than being masked by the cap
#   - sidecar atomicity: a tight read loop while the wrapped command runs
#     never sees partial JSON
#   - SIGTERM produces an "interrupted" sidecar (best-effort) or none, and
#     never produces a sidecar claiming success
#   - secrets in stdout AND in stderr are redacted (stdout/stderr capture
#     proven directly)
#   - time-command.sh measurement output (currently on stdout) is captured
#     in the diagnostic log (composition-stack proof)
#
# Tests are independent and use isolated temp directories.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER="$REPO_ROOT/scripts/ci/run-with-log.sh"
REDACTOR="$REPO_ROOT/scripts/ci/redactor.sh"
TIME_COMMAND="$REPO_ROOT/scripts/ci/time-command.sh"

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
  # Keep CURRENT_DIR for inspection on failure.
  echo "  evidence kept at $CURRENT_DIR" >&2
}

assert_eq() {
  local got="$1"
  local want="$2"
  local label="$3"
  if [ "$got" != "$want" ]; then
    end_test_fail "$label: expected '$want', got '$got'"
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

sidecar_field() {
  local file="$1"
  local key="$2"
  python3 -c "import json,sys;print(json.load(open('$file'))['$key'])" 2>/dev/null
}

# ----- 1. success path ----------------------------------------------------
start_test "success path: exit 0 + valid sidecar + redacted output"
log="$CURRENT_DIR/ok.log"
"$WRAPPER" "$log" bash -c 'echo "API_TOKEN=secret-abc PUBLIC=hello"; echo "plain line"'
status=$?
assert_eq "$status" "0" "wrapper exit" || true
assert_contains "$log" "API_TOKEN=<redacted>" "log redaction" || true
assert_contains "$log" "PUBLIC=hello" "log preserves non-secret" || true
assert_contains "$log" "plain line" "log captures all stdout lines" || true
assert_not_contains "$log" "secret-abc" "log must not leak unredacted secret" || true
assert_eq "$(sidecar_field "$log.status.json" wrapped_exit)" "0" "sidecar wrapped_exit" || true
assert_eq "$(sidecar_field "$log.status.json" sink_status)" "ok" "sidecar sink_status" || true
assert_eq "$(sidecar_field "$log.status.json" truncated)" "False" "sidecar truncated" || true
assert_eq "$(sidecar_field "$log.status.json" schema_version)" "1" "sidecar schema_version" || true
[ "$FAIL" -eq 0 ] && end_test_pass

# ----- 2. wrapped failure -------------------------------------------------
prev_fail=$FAIL
start_test "wrapped failure: exit code propagates; sidecar reflects status"
log="$CURRENT_DIR/fail.log"
"$WRAPPER" "$log" bash -c 'echo something; exit 17'
status=$?
assert_eq "$status" "17" "wrapper exit propagates" || true
assert_contains "$log" "something" "log captures wrapped output" || true
assert_eq "$(sidecar_field "$log.status.json" wrapped_exit)" "17" "sidecar wrapped_exit" || true
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 3. tee mask regression ---------------------------------------------
prev_fail=$FAIL
start_test "tee mask regression: a successful tee cannot mask wrapped failure"
log="$CURRENT_DIR/mask.log"
"$WRAPPER" "$log" bash -c 'exit 42'
status=$?
assert_eq "$status" "42" "tee success must not mask wrapped exit 42" || true
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 4. missing redactor ------------------------------------------------
prev_fail=$FAIL
start_test "missing redactor: fail closed, no log claiming success"
fake_root="$CURRENT_DIR/fake-scripts"
mkdir -p "$fake_root/scripts/ci"
cp "$WRAPPER" "$fake_root/scripts/ci/run-with-log.sh"
chmod +x "$fake_root/scripts/ci/run-with-log.sh"
# Intentionally do NOT create redactor.sh in fake_root.
log="$CURRENT_DIR/missing-redactor.log"
"$fake_root/scripts/ci/run-with-log.sh" "$log" echo hello >/dev/null 2>"$CURRENT_DIR/diag.err"
status=$?
if [ "$status" -eq 0 ]; then
  end_test_fail "wrapper must exit non-zero when redactor missing (got $status)"
elif [ -f "$log.status.json" ] && [ "$(sidecar_field "$log.status.json" sink_status)" = "ok" ]; then
  end_test_fail "wrapper produced a success sidecar despite missing redactor"
else
  assert_contains "$CURRENT_DIR/diag.err" "redactor not found" "fail-closed diagnostic" || true
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 5. unwritable log path ---------------------------------------------
prev_fail=$FAIL
start_test "unwritable log path: clear diagnostic, no half-written log"
log="$CURRENT_DIR/log-path-is-directory"
mkdir -p "$log"
"$WRAPPER" "$log" echo hello 2>"$CURRENT_DIR/diag.err"
status=$?
if [ "$status" -eq 0 ]; then
  end_test_fail "wrapper must exit non-zero when log path is unwritable (got $status)"
else
  assert_contains "$CURRENT_DIR/diag.err" "log path is not writable" "unwritable diagnostic" || true
  if [ -e "$log.status.json" ]; then
    end_test_fail "wrapper produced a sidecar despite unwritable log path"
  fi
  [ "$FAIL" -eq "$prev_fail" ] && end_test_pass
fi

# ----- 6. missing args ----------------------------------------------------
prev_fail=$FAIL
start_test "missing args: usage + non-zero exit"
"$WRAPPER" 2>"$CURRENT_DIR/diag.err"
status=$?
[ "$status" -ne 0 ] || end_test_fail "wrapper must exit non-zero when called with no args"
assert_contains "$CURRENT_DIR/diag.err" "Usage:" "usage shown" || true
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 7. cap honored, drain, truncation marker, sidecar truncated --------
prev_fail=$FAIL
start_test "cap honored: marker present, sidecar.truncated=true, wrapped exit preserved"
log="$CURRENT_DIR/big.log"
# cap to 256 bytes; emit 2 KB so we definitely exceed it
SANCTUARY_CI_LOG_CAP_BYTES=256 "$WRAPPER" "$log" \
  bash -c 'for i in $(seq 1 200); do echo "line-$i-padding-aaaaaaaaaaaaaa"; done; exit 5'
status=$?
assert_eq "$status" "5" "wrapped exit not masked by cap" || true
assert_contains "$log" "LOG TRUNCATED AT 256 BYTES" "truncation marker present" || true
got_trunc="$(sidecar_field "$log.status.json" truncated)"
assert_eq "$got_trunc" "True" "sidecar.truncated must be true" || true
log_size=$(wc -c < "$log")
# Allow some slack for the marker line written after the cap.
if [ "$log_size" -gt 2048 ]; then
  end_test_fail "log size $log_size exceeds reasonable bound after cap"
fi
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 8. sidecar atomic write --------------------------------------------
prev_fail=$FAIL
start_test "sidecar atomicity: tight-loop reads never see partial JSON"
log="$CURRENT_DIR/atomic.log"
sidecar="$log.status.json"
# Watch for partial JSON in a side process while wrapper runs a slowish cmd.
(
  for _ in $(seq 1 50); do
    if [ -e "$sidecar" ]; then
      if ! python3 -c "import json,sys;json.load(open('$sidecar'))" >/dev/null 2>&1; then
        echo "PARTIAL_JSON_OBSERVED" > "$CURRENT_DIR/atomicity.flag"
        exit 0
      fi
    fi
    sleep 0.02
  done
) &
watcher=$!
"$WRAPPER" "$log" bash -c 'for i in 1 2 3; do echo "tick $i"; sleep 0.05; done'
status=$?
wait "$watcher" 2>/dev/null || true
assert_eq "$status" "0" "wrapper exit" || true
if [ -f "$CURRENT_DIR/atomicity.flag" ]; then
  end_test_fail "watcher observed partial JSON in $sidecar"
fi
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 9. SIGTERM handling ------------------------------------------------
prev_fail=$FAIL
start_test "SIGTERM: interrupted sidecar (or absent), never claims success"
log="$CURRENT_DIR/term.log"
"$WRAPPER" "$log" bash -c 'sleep 5' &
wpid=$!
# Give it a moment to reach the wait state.
sleep 0.3
kill -TERM "$wpid" 2>/dev/null || true
wait "$wpid" 2>/dev/null
status=$?
# Status should be non-zero (signal-killed) or 130/143-ish.
if [ "$status" -eq 0 ]; then
  end_test_fail "SIGTERM'd wrapper exited 0; expected signal-style exit"
fi
if [ -f "$log.status.json" ]; then
  sink="$(sidecar_field "$log.status.json" sink_status)"
  if [ "$sink" = "ok" ]; then
    end_test_fail "interrupted run produced sink_status='ok'"
  fi
fi
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 10. stderr capture proven directly ---------------------------------
prev_fail=$FAIL
start_test "stderr capture: secrets on stderr are redacted and present in log"
log="$CURRENT_DIR/stderr.log"
"$WRAPPER" "$log" bash -c 'echo "stdout-ok PUBLIC=visible"; echo "stderr-line API_TOKEN=should-be-hidden" >&2'
status=$?
assert_eq "$status" "0" "wrapper exit" || true
assert_contains "$log" "stdout-ok" "stdout captured" || true
assert_contains "$log" "stderr-line" "stderr captured" || true
assert_contains "$log" "API_TOKEN=<redacted>" "stderr secret redacted" || true
assert_not_contains "$log" "should-be-hidden" "stderr secret value not leaked" || true
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 11. time-command.sh stack capture ----------------------------------
prev_fail=$FAIL
start_test "time-command.sh measurement output captured in diagnostic log"
log="$CURRENT_DIR/timed.log"
"$WRAPPER" "$log" "$TIME_COMMAND" "smoke-timed" bash -c 'echo body-line'
status=$?
assert_eq "$status" "0" "wrapper exit" || true
assert_contains "$log" "body-line" "wrapped body captured" || true
assert_contains "$log" "::group::smoke-timed" "time-command group line captured" || true
assert_contains "$log" "smoke-timed completed in" "time-command timing line captured" || true
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

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
