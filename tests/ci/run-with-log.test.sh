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
#   - time-command.sh measurement output is captured in the diagnostic log
#     and its redacted CI timing annotation alone is forwarded to the live log
#
# Tests are independent and use isolated temp directories.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER="$REPO_ROOT/scripts/ci/run-with-log.sh"
REDACTOR="$REPO_ROOT/scripts/ci/redactor.sh"
TIME_COMMAND="$REPO_ROOT/scripts/ci/time-command.sh"
TIMING_REPORTER="$REPO_ROOT/scripts/ci/report-timing-notices.sh"

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

# ----- 9b. SIGKILL: output written before the kill survives ---------------
# A step killed by its own timeout is SIGKILLed, so no trap can run. Everything
# already emitted must therefore be on disk by then. It was not: awk in
# redact_stream, sed after it, and awk in cap_filter all block-buffer into the
# next pipe, so up to a few KiB sat unwritten and died with the process. That is
# why sanctuary#703's recovered address-verifier.log was 0 bytes -- the step was
# identified, but nothing it printed survived to say why.
prev_fail=$FAIL
start_test "SIGKILL: output emitted before the kill is already on disk"
log="$CURRENT_DIR/kill.log"
"$WRAPPER" "$log" bash -c 'echo "MARKER_BEFORE_KILL"; echo "second line"; sleep 30' &
wpid=$!
# Long enough that the lines are unambiguously through the wrapped command.
sleep 2
pkill -KILL -P "$wpid" 2>/dev/null || true
kill -KILL "$wpid" 2>/dev/null || true
wait "$wpid" 2>/dev/null
sleep 0.3
if [ ! -s "$log" ]; then
  end_test_fail "log is empty after SIGKILL; buffered output was lost ($(wc -c <"$log" 2>/dev/null) bytes)"
else
  assert_contains "$log" "MARKER_BEFORE_KILL" "pre-kill output survived" || true
  assert_contains "$log" "second line" "all pre-kill lines survived" || true
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
live_stdout="$CURRENT_DIR/live.stdout"
live_stderr="$CURRENT_DIR/live.stderr"
"$WRAPPER" "$log" "$TIME_COMMAND" "smoke-timed API_TOKEN=secret-timing" \
  bash -c 'echo body-line; echo "::set-output name=unsafe::value"; echo "::notice title=unrelated::not timing"; echo "::notice title=CI timing::malformed"' \
  >"$live_stdout" 2>"$live_stderr"
status=$?
assert_eq "$status" "0" "wrapper exit" || true
assert_contains "$log" "body-line" "wrapped body captured" || true
assert_contains "$log" "::group::smoke-timed API_TOKEN=<redacted>" "time-command group line captured and redacted" || true
assert_contains "$log" "::notice title=CI timing::smoke-timed API_TOKEN=<redacted> completed in" "time-command timing line captured and redacted" || true
assert_contains "$live_stderr" "::notice title=CI timing::smoke-timed API_TOKEN=<redacted> completed in" "redacted timing annotation forwarded live" || true
assert_not_contains "$live_stderr" "body-line" "ordinary output remains suppressed live" || true
assert_not_contains "$live_stderr" "::group::" "group markers remain suppressed live" || true
assert_not_contains "$live_stderr" "::set-output" "arbitrary workflow commands remain suppressed live" || true
assert_not_contains "$live_stderr" "title=unrelated" "unrelated annotations remain suppressed live" || true
assert_not_contains "$live_stderr" "CI timing::malformed" "malformed timing annotations remain suppressed live" || true
assert_not_contains "$live_stderr" "secret-timing" "live timing annotation does not leak secrets" || true
assert_eq "$(grep -cF '::notice title=CI timing::smoke-timed API_TOKEN=<redacted> completed in' "$log")" "1" "timing annotation captured exactly once" || true
assert_eq "$(grep -cF '::notice title=CI timing::smoke-timed API_TOKEN=<redacted> completed in' "$live_stderr")" "1" "timing annotation forwarded exactly once" || true
assert_eq "$(wc -c < "$live_stdout")" "0" "wrapper stdout remains suppressed" || true
report="$CURRENT_DIR/timing-report.txt"
"$TIMING_REPORTER" --log-file "$live_stderr" >"$report"
assert_contains "$report" "smoke-timed API_TOKEN=<redacted>" "live wrapper output is reportable end to end" || true
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 12. upgrade phase timing passthrough --------------------------------
prev_fail=$FAIL
start_test "upgrade phase timing is forwarded live exactly once"
log="$CURRENT_DIR/upgrade-phase.log"
live_stderr="$CURRENT_DIR/live.stderr"
phase_timing='::notice title=CI timing::upgrade phase wallet sync mode=core fixture=latest completed in 1m 2s (62s)'
"$WRAPPER" "$log" bash -c 'printf "%s\n" "$1"; echo ordinary-phase-output' _ "$phase_timing" \
  >/dev/null 2>"$live_stderr"
status=$?
assert_eq "$status" "0" "wrapper exit" || true
assert_eq "$(grep -cF "$phase_timing" "$log")" "1" "phase timing captured exactly once" || true
assert_eq "$(grep -cF "$phase_timing" "$live_stderr")" "1" "phase timing forwarded exactly once" || true
assert_not_contains "$live_stderr" "ordinary-phase-output" "ordinary phase output remains suppressed live" || true
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 13. failed time-command annotation passthrough ---------------------
prev_fail=$FAIL
start_test "failed time-command annotation forwarded without masking exit"
log="$CURRENT_DIR/timed-failure.log"
live_stderr="$CURRENT_DIR/live.stderr"
"$WRAPPER" "$log" "$TIME_COMMAND" "failed-timed" bash -c 'exit 23' \
  >/dev/null 2>"$live_stderr"
status=$?
assert_eq "$status" "23" "wrapped failure remains authoritative" || true
assert_eq "$(sidecar_field "$log.status.json" wrapped_exit)" "23" "failed timing sidecar preserves wrapped exit" || true
assert_eq "$(grep -cF '::error title=CI timing::failed-timed completed in' "$log")" "1" "error annotation captured exactly once" || true
assert_eq "$(grep -cF '::error title=CI timing::failed-timed completed in' "$live_stderr")" "1" "error annotation forwarded exactly once" || true
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 14. performance-budget annotation passthrough ---------------------
prev_fail=$FAIL
start_test "performance budget annotation forwarded exactly once"
log="$CURRENT_DIR/budget.log"
live_stderr="$CURRENT_DIR/live.stderr"
budget_file="$CURRENT_DIR/budgets.json"
printf '%s\n' '{"schemaVersion":1,"budgets":{"budget-timed":{"warnSeconds":0,"hardSeconds":10}}}' >"$budget_file"
SANCTUARY_CI_PERFORMANCE_BUDGET_FILE="$budget_file" \
  "$WRAPPER" "$log" "$TIME_COMMAND" "budget-timed" sleep 1 \
  >/dev/null 2>"$live_stderr"
status=$?
assert_eq "$status" "0" "warning-only budget preserves success" || true
assert_eq "$(grep -cF '::warning title=CI performance budget::budget-timed took' "$log")" "1" "budget warning captured exactly once" || true
assert_eq "$(grep -cF '::warning title=CI performance budget::budget-timed took' "$live_stderr")" "1" "budget warning forwarded exactly once" || true
[ "$FAIL" -eq "$prev_fail" ] && end_test_pass

# ----- 15. unavailable live annotation sink is nonblocking ---------------
prev_fail=$FAIL
start_test "closed live stderr does not fail a successful timed command"
log="$CURRENT_DIR/closed-stderr.log"
"$WRAPPER" "$log" "$TIME_COMMAND" "closed-stderr-timed" true 2>&-
status=$?
assert_eq "$status" "0" "live annotation delivery remains best-effort" || true
assert_eq "$(sidecar_field "$log.status.json" wrapped_exit)" "0" "sidecar preserves successful wrapped exit" || true
assert_eq "$(sidecar_field "$log.status.json" sink_status)" "ok" "diagnostic sink remains authoritative" || true
assert_eq "$(grep -cF '::notice title=CI timing::closed-stderr-timed completed in' "$log")" "1" "timing annotation remains in diagnostic log" || true
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
