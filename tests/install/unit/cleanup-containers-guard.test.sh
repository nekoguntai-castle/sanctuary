#!/bin/bash
# Regression tests for the cleanup_containers production-volume guard.
#
# Background: cleanup_containers() previously defaulted COMPOSE_PROJECT_NAME
# to "sanctuary" when unset, which (combined with run_project_compose not
# passing -p) made install-test cleanup wipe the developer's prod
# sanctuary_postgres_data / sanctuary_redis_data volumes on the runner host.
# These tests assert the guard refuses unset and "sanctuary" project names
# without ever invoking docker.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HELPERS="$PROJECT_ROOT/tests/install/utils/helpers.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="${3:-Values should match}"

  if [ "$expected" = "$actual" ]; then
    return 0
  fi

  echo -e "${RED}ASSERTION FAILED:${NC} $message"
  echo "  Expected: $expected"
  echo "  Actual:   $actual"
  return 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="${3:-String should contain substring}"

  if [[ "$haystack" == *"$needle"* ]]; then
    return 0
  fi

  echo -e "${RED}ASSERTION FAILED:${NC} $message"
  echo "  Missing: $needle"
  echo "  Output: $haystack"
  return 1
}

run_test() {
  local test_name="$1"
  local test_func="$2"

  TESTS_RUN=$((TESTS_RUN + 1))
  echo -n "  Running: $test_name... "

  set +e
  "$test_func"
  local exit_code=$?
  set -e

  if [ "$exit_code" -eq 0 ]; then
    echo -e "${GREEN}PASSED${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}FAILED${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_TESTS+=("$test_name")
  fi
}

# Run cleanup_containers in a subshell with the given env, capture combined
# output and exit status. Uses a fake docker on PATH so any accidental
# docker invocation makes the test fail loudly instead of silently
# touching real volumes.
run_cleanup_containers_isolated() {
  local env_setup="$1"
  local fake_bin
  fake_bin="$(mktemp -d)"

  cat > "$fake_bin/docker" <<'EOF'
#!/bin/bash
echo "FATAL: docker invoked despite guard refusal: $*" >&2
exit 99
EOF
  chmod +x "$fake_bin/docker"

  local output
  set +e
  output=$(
    PATH="$fake_bin:$PATH" \
    bash -c "
      $env_setup
      source '$HELPERS'
      cleanup_containers '$PROJECT_ROOT'
    " 2>&1
  )
  local exit_code=$?
  set -e

  rm -rf "$fake_bin"
  printf '%s\n%s' "$exit_code" "$output"
}

test_refuses_unset_project_name() {
  local result exit_code output
  result="$(run_cleanup_containers_isolated "unset COMPOSE_PROJECT_NAME")"
  exit_code="$(printf '%s\n' "$result" | head -n 1)"
  output="$(printf '%s\n' "$result" | tail -n +2)"

  assert_equals "1" "$exit_code" \
    "cleanup_containers must exit 1 when COMPOSE_PROJECT_NAME is unset" || return 1
  assert_contains "$output" "use the receipt-bound cleanup coordinator" \
    "error message should name the required cleanup authority" || return 1
}

test_refuses_protected_sanctuary_project_name() {
  local result exit_code output
  result="$(run_cleanup_containers_isolated "export COMPOSE_PROJECT_NAME=sanctuary")"
  exit_code="$(printf '%s\n' "$result" | head -n 1)"
  output="$(printf '%s\n' "$result" | tail -n +2)"

  assert_equals "1" "$exit_code" \
    "cleanup_containers must exit 1 when COMPOSE_PROJECT_NAME equals 'sanctuary'" || return 1
  assert_contains "$output" "use the receipt-bound cleanup coordinator" \
    "even an explicit project name must not authorize legacy cleanup" || return 1
}

test_refuses_empty_project_name() {
  local result exit_code output
  result="$(run_cleanup_containers_isolated "export COMPOSE_PROJECT_NAME=")"
  exit_code="$(printf '%s\n' "$result" | head -n 1)"

  assert_equals "1" "$exit_code" \
    "cleanup_containers must exit 1 when COMPOSE_PROJECT_NAME is an empty string" || return 1
}

test_run_project_compose_passes_explicit_project_flag() {
  local fixture output
  fixture="$(mktemp -d)"
  set +e
  output=$(
    SANCTUARY_RUNTIME_DIR="$fixture/runtime" \
    SANCTUARY_DEPLOYMENT_ID=deploy-fallback-fixture \
    bash -c "
      export COMPOSE_PROJECT_NAME=sanctuary-test-fixture-id
      source '$HELPERS'
      docker() { echo \"args: \$*\"; }
      export -f docker
      run_project_compose '$PROJECT_ROOT' down -v --remove-orphans 2>&1
    "
  )
  set -e
  rm -rf "$fixture"

  assert_contains "$output" "-p sanctuary-test-fixture-id" \
    "run_project_compose must pass -p with COMPOSE_PROJECT_NAME" || return 1
  assert_contains "$output" "down -v --remove-orphans" \
    "run_project_compose must forward arguments unchanged" || return 1
}

test_run_project_compose_uses_manifest_operator_path() {
  local fixture output
  fixture="$(mktemp -d)"
  mkdir -p "$fixture/project/scripts/ownership" \
    "$fixture/runtime/ownership/deployments/deploy-fixture"
  touch "$fixture/runtime/ownership/deployments/deploy-fixture/active-revision.json"
  cat > "$fixture/project/scripts/ownership/run-operator-compose.sh" <<'EOF'
#!/usr/bin/env bash
printf 'operator:%s\n' "$*"
EOF
  chmod +x "$fixture/project/scripts/ownership/run-operator-compose.sh"

  output="$(SANCTUARY_RUNTIME_DIR="$fixture/runtime" \
    SANCTUARY_DEPLOYMENT_ID=deploy-fixture \
    bash -c "source '$HELPERS'; run_project_compose '$fixture/project' up -d --no-deps backend")"

  assert_contains "$output" "operator:up -d --no-deps backend" \
    "manifest-backed Compose must use the canonical operator path" || return 1
}

test_compose_file_has_explicit_name() {
  local content
  content="$(grep -E '^name:' "$PROJECT_ROOT/docker-compose.yml" || true)"

  assert_contains "$content" "name: sanctuary" \
    "docker-compose.yml must declare 'name: sanctuary' explicitly so the project name does not depend on cwd basename" || return 1
}

# ---------------------------------------------------------------------------
# The Grafana quiescence coordinator creates its migration and control-helper
# containers directly with `podman create` (run-grafana-password-migration.sh:241,
# grafana-quiescence-records.sh:47), labelled sanctuary.grafana.*, NOT as compose
# services. `compose down -v --remove-orphans` therefore cannot see them.
#
# v0.8.64-rc4 failed on exactly this: the baseline install lost the podman
# terminal-state race, the harness retried, and the orphaned migration container
# survived into the upgrade phase. The upgrade rebuilds the migration image, and
# validate_migration_identity() compares `image = $migration_image_id`, so a
# container left from the previous image can never be reconciled -- the upgrade
# died with "the reserved migration container has an unexpected identity" and the
# whole optional-profiles fixture failed.
#
# Sweep by label rather than by name: it catches the migration container and the
# control helpers alike, and survives any future rename.
test_cleanup_refuses_out_of_band_grafana_sweep() {
  local tmp; tmp="$(mktemp -d)"
  local calls="$tmp/docker.calls"
  cat > "$tmp/docker" <<'STUB'
#!/bin/bash
printf '%s
' "$*" >> "$DOCKER_CALLS"
# report one container for the grafana label filter, nothing otherwise
if [[ "$*" == *"label=sanctuary.grafana.project="* && "$*" == *"-aq"* ]]; then
  echo "grafana-orphan-cid"
fi
exit 0
STUB
  chmod +x "$tmp/docker"
  : > "$calls"

  (
    export PATH="$tmp:$PATH" DOCKER_CALLS="$calls"
    export COMPOSE_PROJECT_NAME="sanctuary-test-cleanup-$$"
    # shellcheck disable=SC1090
    source "$HELPERS"
    cleanup_containers "$tmp" >/dev/null 2>&1 || true
  )

  [ ! -s "$calls" ] || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  return 0
}

main() {
  echo ""
  echo "cleanup_containers Guard Regression Tests"
  echo "========================================="

  run_test "refuses unset COMPOSE_PROJECT_NAME" test_refuses_unset_project_name
  run_test "refuses COMPOSE_PROJECT_NAME=sanctuary (protected)" test_refuses_protected_sanctuary_project_name
  run_test "refuses empty COMPOSE_PROJECT_NAME" test_refuses_empty_project_name
  run_test "run_project_compose passes -p when env is set" test_run_project_compose_passes_explicit_project_flag
  run_test "run_project_compose uses active manifest operator path" test_run_project_compose_uses_manifest_operator_path
  run_test "docker-compose.yml declares name: sanctuary explicitly" test_compose_file_has_explicit_name
  run_test "cleanup refuses out-of-band grafana sweeps" test_cleanup_refuses_out_of_band_grafana_sweep

  echo ""
  echo "Total:  $TESTS_RUN"
  echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
  echo -e "${RED}Failed: $TESTS_FAILED${NC}"

  if [ "$TESTS_FAILED" -gt 0 ]; then
    printf 'Failed tests:\n'
    printf '  - %s\n' "${FAILED_TESTS[@]}"
    exit 1
  fi
}

main "$@"
