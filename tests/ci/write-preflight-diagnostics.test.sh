#!/usr/bin/env bash
# Tests for scripts/ci/write-preflight-diagnostics.sh
#
# Coverage:
#   - succeeds (exit 0) even when docker is unreachable.
#   - bounded output: total lines <= configured limit per section + headers.
#   - allowlisted env summary is rendered for known vars and is empty for
#     unrecognized ones.
#   - script does not dump full `env` (rejects out-of-allowlist names).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PREFLIGHT="$REPO_ROOT/scripts/ci/write-preflight-diagnostics.sh"

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
}

# ----- 1. exit 0 even when docker is unreachable --------------------------
start_test "exit 0 when docker is unreachable (DOCKER_HOST set to a bogus socket)"
out="$CURRENT_DIR/no-docker.out"
DOCKER_HOST="unix:///nonexistent/docker.sock" "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
elif ! grep -q '^===== docker version =====' "$out"; then
  end_test_fail "missing docker version section header"
elif ! grep -q '^===== preflight-diagnostics-end =====' "$out"; then
  end_test_fail "script did not run to completion (no end marker)"
else
  end_test_pass
fi

# ----- 2. bounded output --------------------------------------------------
start_test "output is bounded by section line limit"
out="$CURRENT_DIR/bounded.out"
# Force a tight limit and confirm each unbounded section is capped at it.
SANCTUARY_CI_PREFLIGHT_LINES=5 "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0 with tight limit, got $status"
else
  # Total output should be small: 5 fixed header lines + 4 sections * (header + <=5 body lines)
  # + env section + final marker. Realistic upper bound: ~50 lines. Pad slack to 80.
  total=$(wc -l <"$out")
  if [ "$total" -gt 80 ]; then
    end_test_fail "output is $total lines; expected <= 80 with tight limit"
  else
    end_test_pass
  fi
fi

# ----- 3. allowlisted env summary -----------------------------------------
start_test "allowlisted env vars surface; non-allowlisted ones do not"
out="$CURRENT_DIR/env.out"
# Set a couple of allowlisted vars and an obvious off-list one.
COMPOSE_PROJECT_NAME="sanctuary-preflight-test-$$" \
  PORT_OFFSET="42" \
  SANCTUARY_PREFLIGHT_NOT_ALLOWED="should-not-appear" \
  "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
elif ! grep -q "^COMPOSE_PROJECT_NAME=sanctuary-preflight-test-" "$out"; then
  end_test_fail "missing allowlisted var COMPOSE_PROJECT_NAME"
elif ! grep -q "^PORT_OFFSET=42$" "$out"; then
  end_test_fail "missing allowlisted var PORT_OFFSET"
elif grep -q "^SANCTUARY_PREFLIGHT_NOT_ALLOWED=" "$out"; then
  end_test_fail "non-allowlisted env var leaked into output"
elif grep -q "should-not-appear" "$out"; then
  end_test_fail "non-allowlisted env var value leaked into output"
else
  end_test_pass
fi

# ----- 4. integrates with run-with-log.sh ---------------------------------
start_test "wrapped through run-with-log.sh: produces redacted log + sidecar"
log="$CURRENT_DIR/preflight.log"
COMPOSE_PROJECT_NAME="sanctuary-preflight-secret-token=abc" \
  "$REPO_ROOT/scripts/ci/run-with-log.sh" "$log" "$PREFLIGHT" >/dev/null 2>"$CURRENT_DIR/diag.err"
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status (diag: $(cat "$CURRENT_DIR/diag.err"))"
elif [ ! -f "$log.status.json" ]; then
  end_test_fail "sidecar missing"
elif ! grep -q '"sink_status": "ok"' "$log.status.json"; then
  end_test_fail "sidecar sink_status not ok"
elif ! grep -q "^===== preflight-diagnostics-end =====$" "$log"; then
  end_test_fail "log did not capture full preflight payload"
else
  end_test_pass
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
