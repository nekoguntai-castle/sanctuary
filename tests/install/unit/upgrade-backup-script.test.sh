#!/bin/bash
# Unit tests for scripts/create-upgrade-backup.sh.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BACKUP_SCRIPT="$PROJECT_ROOT/scripts/create-upgrade-backup.sh"

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

setup_fake_project() {
  TEST_TMP_DIR="$(mktemp -d)"
  FAKE_BIN="$TEST_TMP_DIR/bin"
  INSTALL_DIR="$TEST_TMP_DIR/sanctuary"
  RUNTIME_DIR="$TEST_TMP_DIR/runtime"
  SSL_DIR="$RUNTIME_DIR/ssl"
  OUTPUT_DIR="$TEST_TMP_DIR/output"
  DOCKER_LOG="$TEST_TMP_DIR/docker.log"

  mkdir -p "$FAKE_BIN" "$INSTALL_DIR" "$RUNTIME_DIR" "$SSL_DIR" "$OUTPUT_DIR"
  printf 'services:\n  postgres:\n    image: postgres:16-alpine\n' > "$INSTALL_DIR/docker-compose.yml"
  cat > "$RUNTIME_DIR/sanctuary.env" <<'EOF'
POSTGRES_PASSWORD=test-password
POSTGRES_USER=sanctuary
POSTGRES_DB=sanctuary
ENCRYPTION_KEY=enc-key
ENCRYPTION_SALT=enc-salt
ENABLE_MONITORING=yes
ENABLE_TOR=no
EOF
  printf 'cert\n' > "$SSL_DIR/fullchain.pem"
  printf 'key\n' > "$SSL_DIR/privkey.pem"

  cat > "$FAKE_BIN/docker" <<'EOF'
#!/bin/bash
{
  printf '%s\n' "$*"
} >> "$SANCTUARY_FAKE_DOCKER_LOG"

if [ "$1" = "compose" ]; then
  shift
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -f)
        shift 2
        ;;
      ps)
        if [ "${2:-}" = "-q" ]; then
          echo "postgres-container"
        else
          echo "NAME                SERVICE   STATUS"
          echo "postgres-container  postgres  running"
        fi
        exit 0
        ;;
      exec)
        if [[ "$*" == *"pg_isready"* ]]; then
          exit 0
        fi
        if [[ "$*" == *"pg_dump --format=custom"* ]]; then
          printf 'PGDUMP-CUSTOM-CONTENT\n'
          exit 0
        fi
        if [[ "$*" == *"pg_dump --version"* ]]; then
          echo "pg_dump (PostgreSQL) 16.0"
          exit 0
        fi
        exit 0
        ;;
      up)
        exit 0
        ;;
      *)
        shift
        ;;
    esac
  done
fi

case "$1" in
  images)
    echo "postgres:16-alpine image-id 1 day 100MB"
    ;;
  volume)
    echo "DRIVER VOLUME NAME"
    echo "local sanctuary_postgres_data"
    ;;
  version)
    echo "docker 25.0.0"
    ;;
  image)
    exit 0
    ;;
esac
EOF
  chmod +x "$FAKE_BIN/docker"
}

teardown_fake_project() {
  if [ -n "${TEST_TMP_DIR:-}" ] && [ -d "$TEST_TMP_DIR" ]; then
    rm -rf "$TEST_TMP_DIR"
  fi
}

run_backup_script() {
  PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_RUNTIME_DIR="$RUNTIME_DIR" \
    SANCTUARY_ENV_FILE="$RUNTIME_DIR/sanctuary.env" \
    SANCTUARY_SSL_DIR="$SSL_DIR" \
    "$BACKUP_SCRIPT" --install-dir "$INSTALL_DIR" --target-version v9.9.9 --output-dir "$OUTPUT_DIR" "$@"
}

test_script_has_valid_syntax() {
  bash -n "$BACKUP_SCRIPT"
}

test_help_describes_single_archive() {
  local output
  output="$("$BACKUP_SCRIPT" --help)"
  assert_contains "$output" "tar.gz backup archive" "help should describe a single archive" || return 1
  assert_contains "$output" "runtime secrets" "help should warn about secrets" || return 1
}

test_backup_creates_single_valid_archive() {
  setup_fake_project

  local output archive list failures=0
  output="$(run_backup_script)"
  archive="$(find "$OUTPUT_DIR" -name 'sanctuary-upgrade-backup-*.tar.gz' -type f | head -n 1)"
  assert_file_exists "$archive" "backup archive should be created" || failures=1
  if [ "$failures" -eq 0 ]; then
    assert_file_mode "$archive" "600" "backup archive should be owner-only" || failures=1
  fi
  assert_contains "$output" "Upgrade backup written to" "script should report backup path" || failures=1

  if [ "$failures" -eq 0 ]; then
    list="$(tar -tzf "$archive")" || failures=1
    assert_contains "$list" "./database/sanctuary.pgcustom" "archive should include database dump" || failures=1
    assert_contains "$list" "./runtime/sanctuary.env" "archive should include runtime env" || failures=1
    assert_contains "$list" "./tls/fullchain.pem" "archive should include TLS cert" || failures=1
    assert_contains "$list" "./manifest.env" "archive should include shell manifest" || failures=1
    assert_contains "$list" "./checksums.sha256" "archive should include internal checksums" || failures=1
  fi

  if find "$OUTPUT_DIR" -name '*.sha256' -type f | grep -q .; then
    echo -e "${RED}ASSERTION FAILED:${NC} default backup should not write sidecar checksum"
    failures=1
  fi

  assert_contains "$(cat "$DOCKER_LOG")" "pg_dump --format=custom" "backup should use PostgreSQL custom-format dump" || failures=1

  teardown_fake_project
  return "$failures"
}

test_sidecar_checksum_is_explicit() {
  setup_fake_project

  local failures=0
  run_backup_script --write-sidecar-checksum >/dev/null
  local sidecar
  sidecar="$(find "$OUTPUT_DIR" -name '*.tar.gz.sha256' -type f | head -n 1)"
  assert_file_exists "$sidecar" "sidecar checksum should be explicit" || failures=1

  teardown_fake_project
  return "$failures"
}

main() {
  echo "Upgrade Backup Script Unit Tests"
  echo "================================"

  run_test "script has valid syntax" test_script_has_valid_syntax
  run_test "help describes single archive" test_help_describes_single_archive
  run_test "backup creates single valid archive" test_backup_creates_single_valid_archive
  run_test "sidecar checksum is explicit" test_sidecar_checksum_is_explicit

  echo ""
  echo "Tests run:    $TESTS_RUN"
  echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"

  if [ "$TESTS_FAILED" -gt 0 ]; then
    echo ""
    echo "Failed tests:"
    for test_name in "${FAILED_TESTS[@]}"; do
      echo "  - $test_name"
    done
    exit 1
  fi

  echo -e "${GREEN}All upgrade backup script tests passed!${NC}"
}

main "$@"
