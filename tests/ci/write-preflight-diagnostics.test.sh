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

if [ -n "${PREFLIGHT_TEST_CALLS:-}" ]; then
  printf '%s\n' "$*" >> "$PREFLIGHT_TEST_CALLS"
fi
if [ "${PREFLIGHT_TEST_FAIL:-}" = 1 ]; then
  echo 'fixture daemon unavailable' >&2
  exit 42
fi
if [ "${PREFLIGHT_TEST_SLOW:-}" = 1 ] && [ "${1:-}" = info ]; then
  sleep 5
fi
if [ "${PREFLIGHT_TEST_RESIST_TERM:-}" = 1 ] && [ "${1:-}" = info ]; then
  trap '' TERM
  sleep 30
fi

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
start_test "exit 0 when docker is unreachable (fake daemon)"
write_docker_stub
out="$CURRENT_DIR/no-docker.out"
PATH="$CURRENT_DIR/bin:$PATH" PREFLIGHT_TEST_FAIL=1 \
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
write_docker_stub
out="$CURRENT_DIR/bounded.out"
# Force a tight limit and confirm each unbounded section is capped at it.
PATH="$CURRENT_DIR/bin:$PATH" \
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
write_docker_stub
out="$CURRENT_DIR/env.out"
# Set a couple of allowlisted vars and an obvious off-list one.
PATH="$CURRENT_DIR/bin:$PATH" COMPOSE_PROJECT_NAME="sanctuary-preflight-test-$$" \
  PORT_OFFSET="42" \
  SANCTUARY_PREFLIGHT_NOT_ALLOWED="should-not-appear" \
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
write_docker_stub
log="$CURRENT_DIR/preflight.log"
PATH="$CURRENT_DIR/bin:$PATH" COMPOSE_PROJECT_NAME="sanctuary-preflight-secret-token=abc" \
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

# ----- command outcome telemetry -----------------------------------------
start_test "zero timeout is rejected and successful observations are timed"
write_docker_stub
out="$CURRENT_DIR/outcome.out"
PATH="$CURRENT_DIR/bin:$PATH" SANCTUARY_CI_PREFLIGHT_TIMEOUT_SECONDS=0 \
  "$PREFLIGHT" >"$out" 2>&1
if ! grep -q '^command_timeout_seconds=10$' "$out"; then
  end_test_fail "zero must not disable the timeout"
elif ! grep -Eq '^command_result label=docker info status=ok exit_code=0 elapsed_seconds=[0-9]+$' "$out"; then
  end_test_fail "missing successful timed observation"
else
  end_test_pass
fi

start_test "pipeline failure remains an error"
write_docker_stub
out="$CURRENT_DIR/error.out"
PATH="$CURRENT_DIR/bin:$PATH" PREFLIGHT_TEST_FAIL=1 "$PREFLIGHT" >"$out" 2>&1
if ! grep -q '^command_result label=docker compose-labeled volumes status=error exit_code=42 ' "$out"; then
  end_test_fail "pipeline hid Docker failure"
else
  end_test_pass
fi

start_test "slow command times out without failing diagnostics"
write_docker_stub
out="$CURRENT_DIR/timeout.out"
PATH="$CURRENT_DIR/bin:$PATH" PREFLIGHT_TEST_SLOW=1 \
  SANCTUARY_CI_PREFLIGHT_TIMEOUT_SECONDS=1 timeout 15 "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ] || ! grep -q '^command_result label=docker info status=timeout exit_code=124 ' "$out"; then
  end_test_fail "missing bounded timeout outcome (status $status)"
else
  end_test_pass
fi

start_test "TERM-resistant observation is forcibly bounded"
write_docker_stub
out="$CURRENT_DIR/forced-timeout.out"
PATH="$CURRENT_DIR/bin:$PATH" PREFLIGHT_TEST_RESIST_TERM=1 \
  SANCTUARY_CI_PREFLIGHT_TIMEOUT_SECONDS=1 timeout 15 "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "diagnostics exceeded outer deadline or failed (status $status)"
elif ! grep -q '^command_result label=docker info status=timeout_or_killed exit_code=137 ' "$out"; then
  end_test_fail "missing forced-termination timeout outcome"
elif ! grep -q '^===== preflight-diagnostics-end =====$' "$out"; then
  end_test_fail "diagnostics did not continue after forced termination"
else
  end_test_pass
fi

start_test "missing timeout skips observations without invoking Docker"
write_docker_stub
# Supply only the tools needed to render diagnostics. Neither timeout nor
# a real Docker client is reachable through this isolated PATH.
for utility in bash dirname date uname id stat head cat; do
  ln -s "$(command -v "$utility")" "$CURRENT_DIR/bin/$utility"
done
out="$CURRENT_DIR/no-timeout.out"
calls="$CURRENT_DIR/docker-calls"
timeout_command="$(command -v timeout)"
PATH="$CURRENT_DIR/bin" PREFLIGHT_TEST_CALLS="$calls" \
  SANCTUARY_CI_PROJECT_PREFIXES=fixture \
  "$timeout_command" 15 "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected best-effort completion without timeout (status $status)"
elif [ -s "$calls" ]; then
  end_test_fail "Docker ran without timeout tooling"
elif ! grep -q '^command_result label=docker info status=unavailable exit_code=125 ' "$out"; then
  end_test_fail "missing unavailable observation outcome"
elif ! grep -q '^===== preflight-diagnostics-end =====$' "$out"; then
  end_test_fail "diagnostics did not complete without timeout tooling"
else
  end_test_pass
fi

start_test "overlapping prefixes share fixed scans and emit each matching resource once"
write_docker_stub
out="$CURRENT_DIR/prefixes.out"
calls="$CURRENT_DIR/docker-calls"
PATH="$CURRENT_DIR/bin:$PATH" PREFLIGHT_TEST_CALLS="$calls" \
  SANCTUARY_CI_PROJECT_PREFIXES="sanctuary-ci,sanctuary-ci-upgrade-123,absent" \
  "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected successful diagnostics (status $status)"
elif [ "$(grep -c '^ps -a ' "$calls")" -ne 2 ] || \
     [ "$(grep -c '^network ls ' "$calls")" -ne 2 ] || \
     [ "$(grep -c '^volume ls ' "$calls")" -ne 3 ]; then
  end_test_fail "expected one prefix scan per resource plus existing baseline scans"
elif [ "$(grep -c $'^container\tsanctuary-ci-upgrade-123\t' "$out")" -ne 1 ] || \
     [ "$(grep -c $'^network\tsanctuary-ci-upgrade-123_default\t' "$out")" -ne 1 ] || \
     [ "$(grep -c $'^volume\tsanctuary-ci-upgrade-123_backend-data\t' "$out")" -ne 1 ]; then
  end_test_fail "overlapping prefixes lost or duplicated matching resources"
else
  end_test_pass
fi

start_test "prefix matching treats regular expression characters literally"
write_docker_stub
out="$CURRENT_DIR/literal-prefix.out"
PATH="$CURRENT_DIR/bin:$PATH" SANCTUARY_CI_PROJECT_PREFIXES='sanctuary-ci-.*' \
  "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "expected successful diagnostics (status $status)"
elif grep -Eq '^(container|network|volume)[[:space:]]' "$out"; then
  end_test_fail "regex-looking literal prefix matched unrelated resources"
else
  end_test_pass
fi

start_test "prefix inventory failure is reported instead of appearing empty"
write_docker_stub
out="$CURRENT_DIR/prefix-error.out"
PATH="$CURRENT_DIR/bin:$PATH" PREFLIGHT_TEST_FAIL=1 \
  SANCTUARY_CI_PROJECT_PREFIXES=fixture "$PREFLIGHT" >"$out" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  end_test_fail "diagnostic failure must remain nonfatal (status $status)"
elif ! grep -q '^command_result label=prefix volumes status=error exit_code=42 ' "$out"; then
  end_test_fail "prefix pipeline hid the Docker failure"
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
