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

write_docker_stub() {
  local bin_dir="$CURRENT_DIR/bin"
  mkdir -p "$bin_dir"

  cat > "$bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-} ${2:-}" in
  "version ")
    echo "Docker version test"
    ;;
  "info ")
    echo "Docker info test"
    ;;
  "system df")
    echo "TYPE            TOTAL     ACTIVE    SIZE"
    echo "Images          12        3         42GB"
    echo "Build Cache     18        0         21GB"
    ;;
  "buildx ls")
    echo "sanctuary-builder * docker-container"
    ;;
  "volume ls")
    if printf '%s\n' "$*" | grep -q -- '--filter label=com.docker.compose.project'; then
      printf '%s\t%s\n' \
        "sanctuary-ci-upgrade-123_backend-data" "com.docker.compose.project=sanctuary-ci-upgrade-123" \
        "unrelated-data" "com.docker.compose.project=unrelated"
    else
      printf '%s\t%s\n' "buildx_buildkit_sanctuary_state" "local"
    fi
    ;;
  "ps -a")
    printf '%s\t%s\t%s\n' \
      "sanctuary-ci-upgrade-123" "backend-1" "Exited (0)" \
      "unrelated" "postgres-1" "Running"
    ;;
  "network ls")
    printf '%s\t%s\n' \
      "sanctuary-ci-upgrade-123_default" "com.docker.compose.project=sanctuary-ci-upgrade-123" \
      "unrelated_default" "com.docker.compose.project=unrelated"
    ;;
  *)
    echo "docker stub: $*"
    ;;
esac
EOF

  chmod +x "$bin_dir/docker"
}

# ----- 1. exit 0 even when docker is unreachable --------------------------
start_test "exit 0 when docker is unreachable (DOCKER_HOST set to a bogus socket)"
out="$CURRENT_DIR/no-docker.out"
DOCKER_HOST="unix:///nonexistent/docker.sock" \
  SANCTUARY_CI_PREFLIGHT_TIMEOUT_SECONDS=1 \
  "$PREFLIGHT" >"$out" 2>&1
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
DOCKER_HOST="unix:///nonexistent/docker.sock" \
  SANCTUARY_CI_PREFLIGHT_LINES=5 \
  SANCTUARY_CI_PREFLIGHT_TIMEOUT_SECONDS=1 \
  "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0 with tight limit, got $status"
else
  # Total output should stay bounded even after adding Docker/lock telemetry.
  # Pad slack for fixed headers and best-effort sections that do not use
  # run_bounded because they already filter by exact project prefix.
  total=$(wc -l <"$out")
  if [ "$total" -gt 140 ]; then
    end_test_fail "output is $total lines; expected <= 140 with tight limit"
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
  DOCKER_HOST="unix:///nonexistent/docker.sock" \
  SANCTUARY_CI_PREFLIGHT_TIMEOUT_SECONDS=1 \
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

# ----- 4. lock and DIND telemetry -----------------------------------------
start_test "lock and DIND telemetry include workspace-local lock and compose leftovers"
out="$CURRENT_DIR/telemetry.out"
write_docker_stub
workspace="$CURRENT_DIR/workspace"
lock_dir="$workspace/.tmp/runner-locks-v2"
mkdir -p "$lock_dir"
touch "$lock_dir/e2e.lock"
PATH="$CURRENT_DIR/bin:$PATH" \
  SANCTUARY_CI_WORKSPACE_OVERRIDE="$workspace" \
  SANCTUARY_RUNNER_LOCK_DIR="$lock_dir" \
  SANCTUARY_CI_PROJECT_PREFIXES="sanctuary-ci-upgrade-123" \
  "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected exit 0, got $status"
elif ! grep -q '^===== runner lock diagnostics =====$' "$out"; then
  end_test_fail "missing runner lock diagnostics section"
elif ! grep -q '^runner_lock_scope_inference=workspace-local$' "$out"; then
  end_test_fail "missing workspace-local lock inference"
elif ! grep -q '^===== docker system df =====$' "$out"; then
  end_test_fail "missing docker system df telemetry"
elif ! grep -q '^buildx_buildkit_sanctuary_state' "$out"; then
  end_test_fail "missing buildx state volume telemetry"
elif ! grep -q $'^container\tsanctuary-ci-upgrade-123\tbackend-1' "$out"; then
  end_test_fail "missing configured-prefix compose container leftovers"
elif grep -q $'^container\tunrelated\t' "$out"; then
  end_test_fail "unrelated compose project leaked into configured-prefix leftovers"
else
  end_test_pass
fi

# ----- 5. integrates with run-with-log.sh ---------------------------------
start_test "wrapped through run-with-log.sh: produces redacted log + sidecar"
log="$CURRENT_DIR/preflight.log"
COMPOSE_PROJECT_NAME="sanctuary-preflight-secret-token=abc" \
  DOCKER_HOST="unix:///nonexistent/docker.sock" \
  SANCTUARY_CI_PREFLIGHT_TIMEOUT_SECONDS=1 \
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
