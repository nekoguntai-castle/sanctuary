#!/bin/bash
# Unit tests for upgrade helper scripts.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

source "$PROJECT_ROOT/tests/install/utils/upgrade-test-defaults.sh"
source "$PROJECT_ROOT/tests/install/utils/upgrade-source-refs.sh"
source "$PROJECT_ROOT/tests/install/utils/upgrade-fixtures.sh"
source "$PROJECT_ROOT/tests/install/utils/collect-upgrade-artifacts.sh"
source "$PROJECT_ROOT/tests/install/utils/upgrade-assertions.sh"

TEST_TMP_DIR=""
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

setup() {
  TEST_TMP_DIR="$(mktemp -d)"
}

teardown() {
  if [ -n "$TEST_TMP_DIR" ] && [ -d "$TEST_TMP_DIR" ]; then
    rm -rf "$TEST_TMP_DIR"
  fi
}

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

run_test() {
  local test_name="$1"
  local test_func="$2"

  TESTS_RUN=$((TESTS_RUN + 1))
  echo -n "  Running: $test_name... "

  setup
  set +e
  "$test_func"
  local exit_code=$?
  set -e
  teardown

  if [ "$exit_code" -eq 0 ]; then
    echo -e "${GREEN}PASSED${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}FAILED${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_TESTS+=("$test_name")
  fi
}

make_commit() {
  local repo="$1"
  local content="$2"
  printf '%s\n' "$content" > "$repo/file.txt"
  git -C "$repo" add file.txt >/dev/null
  git -C "$repo" commit -m "$content" >/dev/null
}

test_source_ref_aliases_resolve_stable_tags() {
  local repo="$TEST_TMP_DIR/repo"
  mkdir -p "$repo"
  git -C "$repo" init -b main >/dev/null
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name "Upgrade Helper Test"

  make_commit "$repo" "release-0.8.39"
  git -C "$repo" tag v0.8.39
  make_commit "$repo" "release-0.8.40"
  git -C "$repo" tag v0.8.40
  make_commit "$repo" "release-0.8.41"
  git -C "$repo" tag v0.8.41
  make_commit "$repo" "candidate"

  local target_commit
  target_commit=$(git -C "$repo" rev-parse HEAD)

  assert_equals "v0.8.41" "$(resolve_upgrade_source_ref "$repo" latest-stable "$target_commit")" \
    "latest-stable should resolve newest stable tag before target"
  assert_equals "v0.8.41" "$(resolve_upgrade_source_ref "$repo" n-1 "$target_commit")" \
    "n-1 should resolve newest stable tag before target"
  assert_equals "v0.8.40" "$(resolve_upgrade_source_ref "$repo" n-2 "$target_commit")" \
    "n-2 should resolve previous stable tag"
  assert_equals "v0.8.39" "$(resolve_upgrade_source_ref "$repo" v0.8.39 "$target_commit")" \
    "explicit refs should resolve unchanged"
}

test_fixture_defaults_are_composable() {
  HTTPS_PORT=""
  HTTP_PORT=""
  GATEWAY_PORT=""
  UPGRADE_BROWSER_HOST=""
  UPGRADE_ENABLE_MONITORING="no"
  UPGRADE_ENABLE_TOR="no"
  UPGRADE_USE_LEGACY_RUNTIME_ENV="false"
  UPGRADE_EXPECT_OPTIONAL_PROFILES="false"

  validate_upgrade_fixture "browser-origin-ip,legacy-runtime-env,optional-profiles"
  apply_upgrade_fixture_defaults "browser-origin-ip,legacy-runtime-env,optional-profiles"
  apply_upgrade_test_network_defaults

  assert_equals "127.0.0.1" "$UPGRADE_BROWSER_HOST" "browser fixture should use IP origin"
  assert_equals "9443" "$HTTPS_PORT" "upgrade test defaults should use isolated HTTPS port"
  assert_equals "9080" "$HTTP_PORT" "upgrade test defaults should use isolated HTTP port"
  assert_equals "4400" "$GATEWAY_PORT" "upgrade test defaults should use isolated gateway port"
  assert_equals "true" "$UPGRADE_USE_LEGACY_RUNTIME_ENV" "legacy fixture should enable repo-root env path"
  assert_equals "yes" "$UPGRADE_ENABLE_MONITORING" "optional fixture should enable monitoring"
  assert_equals "yes" "$UPGRADE_ENABLE_TOR" "optional fixture should enable Tor"
}

test_upgrade_network_defaults_respect_overrides() {
  HTTPS_PORT="19443"
  HTTP_PORT="19080"
  GATEWAY_PORT="14000"
  UPGRADE_BROWSER_HOST="upgrade.example.invalid"

  apply_upgrade_test_network_defaults

  assert_equals "19443" "$HTTPS_PORT" "HTTPS override should be preserved"
  assert_equals "19080" "$HTTP_PORT" "HTTP override should be preserved"
  assert_equals "14000" "$GATEWAY_PORT" "gateway override should be preserved"
  assert_equals "upgrade.example.invalid" "$UPGRADE_BROWSER_HOST" "browser host override should be preserved"
}

test_invalid_fixture_is_rejected() {
  if validate_upgrade_fixture "baseline,not-a-fixture" >/dev/null 2>&1; then
    echo -e "${RED}ASSERTION FAILED:${NC} invalid fixture should fail validation"
    return 1
  fi
}

test_redacted_env_hides_upgrade_secrets() {
  local env_file="$TEST_TMP_DIR/sanctuary.env"
  local redacted_file="$TEST_TMP_DIR/redacted.env"

  cat > "$env_file" <<'EOF'
JWT_SECRET=super-secret
ENCRYPTION_KEY=key-material
ENCRYPTION_SALT=salt-material
POSTGRES_PASSWORD=db-password
HTTPS_PORT=8443
ENABLE_TOR=no
EOF

  write_redacted_env "$env_file" "$redacted_file"

  local redacted
  redacted="$(cat "$redacted_file")"

  assert_contains "$redacted" "JWT_SECRET=<redacted:length=12>" "JWT secret should be redacted"
  assert_contains "$redacted" "ENCRYPTION_SALT=<redacted:length=13>" "salt should be redacted"
  assert_contains "$redacted" "HTTPS_PORT=8443" "non-secret port should remain visible"
  assert_not_contains "$redacted" "super-secret" "secret values must not leak"
  assert_not_contains "$redacted" "db-password" "password values must not leak"
}

test_diagnostic_redaction_hides_log_secrets() {
  local log_file="$TEST_TMP_DIR/install.log"
  local redacted_file="$TEST_TMP_DIR/install.redacted.log"

  cat > "$log_file" <<'EOF'
Save these values:
ENCRYPTION_KEY=key-material
POSTGRES_PASSWORD=db-password
{"JWT_SECRET":"json-secret","HTTPS_PORT":"8443"}
Request header X-CSRF-Token: csrf-token
EOF

  redact_file "$log_file" "$redacted_file"

  local redacted
  redacted="$(cat "$redacted_file")"

  assert_contains "$redacted" "ENCRYPTION_KEY=<redacted>" "key material should be redacted in logs"
  assert_contains "$redacted" "POSTGRES_PASSWORD=<redacted>" "password should be redacted in logs"
  assert_contains "$redacted" '"JWT_SECRET": "<redacted>"' "JSON secret should be redacted in logs"
  assert_contains "$redacted" '"HTTPS_PORT":"8443"' "non-secret JSON fields should remain visible"
  assert_not_contains "$redacted" "key-material" "raw key material must not leak"
  assert_not_contains "$redacted" "db-password" "raw password must not leak"
  assert_not_contains "$redacted" "json-secret" "raw JSON secret must not leak"
  assert_not_contains "$redacted" "csrf-token" "CSRF token must not leak"
}

test_browser_refresh_smoke_sends_csrf_header() {
  local curl_calls="$TEST_TMP_DIR/curl-calls.txt"

  COOKIE_JAR="$TEST_TMP_DIR/cookies.txt"
  CSRF_TOKEN=""

  log_info() { :; }
  log_error() { echo "$*" >&2; }
  login_as_upgrade_user() {
    CSRF_TOKEN="csrf-before-refresh"
    return 0
  }
  extract_csrf_token() {
    CSRF_TOKEN="csrf-after-refresh"
  }
  curl() {
    printf '%s\n' "$*" >> "$curl_calls"
    local arg has_csrf=false
    for arg in "$@"; do
      if [ "$arg" = "X-CSRF-Token: csrf-before-refresh" ]; then
        has_csrf=true
      fi
    done
    if [[ "$*" == *"/api/v1/auth/me"* ]]; then
      printf '{"username":"admin"}'
    elif [[ "$*" == *"/api/v1/auth/refresh"* ]] && [ "$has_csrf" = "true" ]; then
      printf '{"expiresIn":900}'
    elif [[ "$*" == *"/api/v1/auth/refresh"* ]]; then
        printf '{"error":"missing csrf"}'
    else
      printf '{}'
    fi
  }

  assert_browser_auth_smoke "https://localhost:9443"
  local result=$?
  local calls
  calls="$(cat "$curl_calls")"

  unset -f log_info log_error login_as_upgrade_user extract_csrf_token curl

  if [ "$result" -ne 0 ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} browser auth smoke should pass with mocked CSRF refresh"
    return 1
  fi

  assert_contains "$calls" "X-CSRF-Token: csrf-before-refresh" \
    "refresh request should send the current CSRF token"
}

main() {
  echo ""
  echo "Upgrade Helper Unit Tests"
  echo "========================="

  run_test "source ref aliases resolve stable tags" test_source_ref_aliases_resolve_stable_tags
  run_test "fixture defaults are composable" test_fixture_defaults_are_composable
  run_test "upgrade network defaults respect overrides" test_upgrade_network_defaults_respect_overrides
  run_test "invalid fixture is rejected" test_invalid_fixture_is_rejected
  run_test "redacted env hides upgrade secrets" test_redacted_env_hides_upgrade_secrets
  run_test "diagnostic redaction hides log secrets" test_diagnostic_redaction_hides_log_secrets
  run_test "browser refresh smoke sends csrf header" test_browser_refresh_smoke_sends_csrf_header

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
