#!/bin/bash
# Unit tests for scripts/reset-user-2fa.sh.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RESET_SCRIPT="$PROJECT_ROOT/scripts/reset-user-2fa.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

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

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local message="${3:-String should not contain substring}"

  if [[ "$haystack" != *"$needle"* ]]; then
    return 0
  fi

  echo -e "${RED}ASSERTION FAILED:${NC} $message"
  echo "  Unexpected: $needle"
  echo "  Output: $haystack"
  return 1
}

assert_file_exists() {
  local file="$1"
  local message="${2:-File should exist}"

  if [ -f "$file" ]; then
    return 0
  fi

  echo -e "${RED}ASSERTION FAILED:${NC} $message"
  echo "  Missing file: $file"
  return 1
}

assert_file_mode() {
  local file="$1"
  local expected="$2"
  local message="${3:-File mode should match}"
  local actual

  actual="$(stat -c '%a' "$file")"
  if [ "$actual" = "$expected" ]; then
    return 0
  fi

  echo -e "${RED}ASSERTION FAILED:${NC} $message"
  echo "  Expected: $expected"
  echo "  Actual:   $actual"
  echo "  File:     $file"
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

setup_fake_docker() {
  TEST_TMP_DIR="$(mktemp -d)"
  FAKE_BIN="$TEST_TMP_DIR/bin"
  BACKUP_DIR="$TEST_TMP_DIR/backups"
  DOCKER_LOG="$TEST_TMP_DIR/docker.log"
  mkdir -p "$FAKE_BIN" "$BACKUP_DIR"

  cat > "$FAKE_BIN/docker" <<'EOF'
#!/bin/bash
input="$(cat || true)"
{
  printf '%s\n' "$*"
  printf '%s\n' '---SQL---'
  printf '%s\n' "$input"
} >> "$SANCTUARY_FAKE_DOCKER_LOG"

if [[ "$input" == *'COUNT(*)'* ]]; then
  echo "${SANCTUARY_FAKE_USER_COUNT:-1}"
  exit 0
fi

if [[ "$input" == *'row_to_json'* ]]; then
  if [ "${SANCTUARY_FAKE_EMPTY_BACKUP:-false}" = "true" ]; then
    exit 0
  fi
  echo '{"id":"user-1","username":"admin","twoFactorEnabled":true,"twoFactorSecret":"encrypted","twoFactorBackupCodes":"[]"}'
  exit 0
fi

if [[ "$input" == *'UPDATE users'* ]]; then
  echo 'admin|false|true|true'
  exit 0
fi

echo 'admin|true|true|true'
EOF
  chmod +x "$FAKE_BIN/docker"
}

teardown_fake_docker() {
  if [ -n "${TEST_TMP_DIR:-}" ] && [ -d "$TEST_TMP_DIR" ]; then
    rm -rf "$TEST_TMP_DIR"
  fi
}

run_reset_script() {
  PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_2FA_RESET_BACKUP_DIR="$BACKUP_DIR" \
    "$RESET_SCRIPT" "$@"
}

test_script_has_valid_syntax() {
  bash -n "$RESET_SCRIPT"
}

test_help_mentions_yes_and_backup() {
  local output
  output="$("$RESET_SCRIPT" --help)"
  assert_contains "$output" "--yes" "help should document explicit confirmation"
  assert_contains "$output" "backup" "help should document backup behavior"
}

test_default_run_is_status_only() {
  setup_fake_docker

  local output
  output="$(run_reset_script --username admin)"

  assert_contains "$output" "No changes made" "default run should not reset"
  assert_contains "$(cat "$DOCKER_LOG")" "SELECT concat_ws('|'," "status SQL should preserve pipe delimiters"
  assert_not_contains "$(cat "$DOCKER_LOG")" "UPDATE users" "default run must not issue UPDATE"

  teardown_fake_docker
}

test_yes_backs_up_before_update() {
  setup_fake_docker

  local output
  output="$(run_reset_script --username admin --yes)"

  assert_contains "$output" "Backup written to" "reset should report backup path"
  assert_contains "$output" "2FA reset complete" "reset should report completion"
  assert_contains "$(cat "$DOCKER_LOG")" "row_to_json" "reset should back up current row"
  assert_contains "$(cat "$DOCKER_LOG")" "UPDATE users" "reset should issue UPDATE"
  assert_contains "$(cat "$DOCKER_LOG")" "RETURNING concat_ws('|'," "reset SQL should preserve pipe delimiters"

  local backup_file
  backup_file="$(ls "$BACKUP_DIR"/admin-2fa-before-reset-*.json | head -n 1)"
  assert_file_exists "$backup_file" "backup file should be created"
  assert_contains "$(cat "$backup_file")" '"twoFactorSecret":"encrypted"' "backup should include current 2FA secret"
  assert_file_mode "$BACKUP_DIR" "700" "backup directory should be owner-only"
  assert_file_mode "$backup_file" "600" "backup file should be owner-only"

  teardown_fake_docker
}

test_empty_backup_aborts_before_update() {
  setup_fake_docker

  set +e
  local output
  output="$(PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_FAKE_EMPTY_BACKUP=true \
    SANCTUARY_2FA_RESET_BACKUP_DIR="$BACKUP_DIR" \
    "$RESET_SCRIPT" --username admin --yes 2>&1)"
  local exit_code=$?
  set -e

  if [ "$exit_code" -eq 0 ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} empty backup should fail"
    teardown_fake_docker
    return 1
  fi

  assert_contains "$output" "backup file is empty" "empty backup should produce clear error"
  assert_contains "$(cat "$DOCKER_LOG")" "row_to_json" "reset should attempt backup before update"
  assert_not_contains "$(cat "$DOCKER_LOG")" "UPDATE users" "empty backup must not issue UPDATE"

  teardown_fake_docker
}

test_missing_user_fails_before_update() {
  setup_fake_docker

  set +e
  local output
  output="$(PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_FAKE_USER_COUNT=0 \
    SANCTUARY_2FA_RESET_BACKUP_DIR="$BACKUP_DIR" \
    "$RESET_SCRIPT" --username missing --yes 2>&1)"
  local exit_code=$?
  set -e

  if [ "$exit_code" -eq 0 ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} missing user should fail"
    teardown_fake_docker
    return 1
  fi

  assert_contains "$output" "user not found" "missing user should produce clear error"
  assert_not_contains "$(cat "$DOCKER_LOG")" "UPDATE users" "missing user must not issue UPDATE"

  teardown_fake_docker
}

main() {
  echo ""
  echo "Reset 2FA Script Unit Tests"
  echo "==========================="

  run_test "script has valid syntax" test_script_has_valid_syntax
  run_test "help mentions confirmation and backup" test_help_mentions_yes_and_backup
  run_test "default run is status only" test_default_run_is_status_only
  run_test "--yes backs up before update" test_yes_backs_up_before_update
  run_test "empty backup aborts before update" test_empty_backup_aborts_before_update
  run_test "missing user fails before update" test_missing_user_fails_before_update

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
