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
  assert_contains "$output" "COMPOSE_PROJECT_NAME must be set explicitly" \
    "error message should explain the missing env var" || return 1
  assert_contains "$output" "would wipe production volumes" \
    "error message should explain the consequence" || return 1
}

test_refuses_protected_sanctuary_project_name() {
  local result exit_code output
  result="$(run_cleanup_containers_isolated "export COMPOSE_PROJECT_NAME=sanctuary")"
  exit_code="$(printf '%s\n' "$result" | head -n 1)"
  output="$(printf '%s\n' "$result" | tail -n +2)"

  assert_equals "1" "$exit_code" \
    "cleanup_containers must exit 1 when COMPOSE_PROJECT_NAME equals 'sanctuary'" || return 1
  assert_contains "$output" "'sanctuary' is protected" \
    "error message should name the protected project" || return 1
}

test_refuses_empty_project_name() {
  local result exit_code output
  result="$(run_cleanup_containers_isolated "export COMPOSE_PROJECT_NAME=")"
  exit_code="$(printf '%s\n' "$result" | head -n 1)"

  assert_equals "1" "$exit_code" \
    "cleanup_containers must exit 1 when COMPOSE_PROJECT_NAME is an empty string" || return 1
}

test_run_project_compose_passes_explicit_project_flag() {
  local output
  set +e
  output=$(
    bash -c "
      export COMPOSE_PROJECT_NAME=sanctuary-test-fixture-id
      source '$HELPERS'
      docker() { echo \"args: \$*\"; }
      export -f docker
      run_project_compose '$PROJECT_ROOT' down -v --remove-orphans 2>&1
    "
  )
  set -e

  assert_contains "$output" "-p sanctuary-test-fixture-id" \
    "run_project_compose must pass -p with COMPOSE_PROJECT_NAME" || return 1
  assert_contains "$output" "down -v --remove-orphans" \
    "run_project_compose must forward arguments unchanged" || return 1
}

test_compose_file_has_explicit_name() {
  local content
  content="$(grep -E '^name:' "$PROJECT_ROOT/docker-compose.yml" || true)"

  assert_contains "$content" "name: sanctuary" \
    "docker-compose.yml must declare 'name: sanctuary' explicitly so the project name does not depend on cwd basename" || return 1
}

main() {
  echo ""
  echo "cleanup_containers Guard Regression Tests"
  echo "========================================="

  run_test "refuses unset COMPOSE_PROJECT_NAME" test_refuses_unset_project_name
  run_test "refuses COMPOSE_PROJECT_NAME=sanctuary (protected)" test_refuses_protected_sanctuary_project_name
  run_test "refuses empty COMPOSE_PROJECT_NAME" test_refuses_empty_project_name
  run_test "run_project_compose passes -p when env is set" test_run_project_compose_passes_explicit_project_flag
  run_test "docker-compose.yml declares name: sanctuary explicitly" test_compose_file_has_explicit_name

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
