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
  UPGRADE_SEED_NOTIFICATION_STATE="false"
  UPGRADE_EXPECT_OPTIONAL_PROFILES="false"
  COMPOSE_PROJECT_NAME="upgrade-fixture-unit"
  GRAFANA_PORT=""
  PROMETHEUS_PORT=""
  ALERTMANAGER_PORT=""
  JAEGER_UI_PORT=""
  LOKI_PORT=""
  JAEGER_OTLP_GRPC_PORT=""
  JAEGER_OTLP_HTTP_PORT=""
  GRAFANA_CONTAINER_NAME=""
  PROMETHEUS_CONTAINER_NAME=""
  TOR_CONTAINER_NAME=""

  validate_upgrade_fixture "browser-origin-ip,legacy-runtime-env,notification-delivery,optional-profiles"
  apply_upgrade_fixture_defaults "browser-origin-ip,legacy-runtime-env,notification-delivery,optional-profiles"
  apply_upgrade_test_network_defaults

  assert_equals "127.0.0.1" "$UPGRADE_BROWSER_HOST" "browser fixture should use IP origin"
  assert_equals "9443" "$HTTPS_PORT" "upgrade test defaults should use isolated HTTPS port"
  assert_equals "9080" "$HTTP_PORT" "upgrade test defaults should use isolated HTTP port"
  assert_equals "4400" "$GATEWAY_PORT" "upgrade test defaults should use isolated gateway port"
  assert_equals "true" "$UPGRADE_USE_LEGACY_RUNTIME_ENV" "legacy fixture should enable repo-root env path"
  assert_equals "true" "$UPGRADE_SEED_NOTIFICATION_STATE" "notification fixture should seed notification state"
  assert_equals "yes" "$UPGRADE_ENABLE_MONITORING" "optional fixture should enable monitoring"
  assert_equals "yes" "$UPGRADE_ENABLE_TOR" "optional fixture should enable Tor"
  assert_equals "19400" "$GRAFANA_PORT" "optional fixture should isolate Grafana host port"
  assert_equals "19401" "$PROMETHEUS_PORT" "optional fixture should isolate Prometheus host port"
  assert_equals "19402" "$ALERTMANAGER_PORT" "optional fixture should isolate Alertmanager host port"
  assert_equals "19403" "$JAEGER_UI_PORT" "optional fixture should isolate Jaeger UI host port"
  assert_equals "19404" "$LOKI_PORT" "optional fixture should isolate Loki host port"
  assert_equals "19405" "$JAEGER_OTLP_GRPC_PORT" "optional fixture should isolate Jaeger gRPC host port"
  assert_equals "19406" "$JAEGER_OTLP_HTTP_PORT" "optional fixture should isolate Jaeger HTTP host port"
  assert_equals "upgrade-fixture-unit-grafana" "$GRAFANA_CONTAINER_NAME" "optional fixture should isolate Grafana container name"
  assert_equals "upgrade-fixture-unit-prometheus" "$PROMETHEUS_CONTAINER_NAME" "optional fixture should isolate Prometheus container name"
  assert_equals "upgrade-fixture-unit-tor" "$TOR_CONTAINER_NAME" "optional fixture should isolate Tor container name"
}

test_optional_profiles_is_in_release_matrices() {
  local install_count
  local rc_count

  install_count=$(grep -c 'fixture: optional-profiles' "$PROJECT_ROOT/.github/workflows/install-test.yml")
  rc_count=$(grep -c 'fixture: optional-profiles' "$PROJECT_ROOT/.github/workflows/release-candidate.yml")

  assert_equals "1" "$install_count" "install release matrix should include optional profiles once"
  assert_equals "1" "$rc_count" "release candidate matrix should include optional profiles once"
}

test_legacy_optional_profile_compose_is_isolated() {
  local checkout="$TEST_TMP_DIR/source"
  local tor_compose="$checkout/docker-compose.tor.yml"

  mkdir -p "$checkout"
  cat > "$tor_compose" <<'EOF'
services:
  tor:
    container_name: sanctuary-tor
EOF

  UPGRADE_EXPECT_OPTIONAL_PROFILES="true"

  isolate_legacy_optional_profile_compose "$checkout"
  UPGRADE_EXPECT_OPTIONAL_PROFILES="false"

  local contents
  contents="$(cat "$tor_compose")"

  assert_contains "$contents" 'container_name: ${TOR_CONTAINER_NAME:-sanctuary-tor}' \
    "legacy Tor compose should use the isolated test container name"
  assert_not_contains "$contents" 'container_name: sanctuary-tor' \
    "legacy Tor compose should not keep the fixed container name"
}

test_legacy_optional_profile_compose_can_use_target_tor_overlay() {
  local source_checkout="$TEST_TMP_DIR/source"
  local target_checkout="$TEST_TMP_DIR/target"
  local source_tor_compose="$source_checkout/docker-compose.tor.yml"
  local target_tor_compose="$target_checkout/docker-compose.tor.yml"

  mkdir -p "$source_checkout" "$target_checkout"
  cat > "$source_tor_compose" <<'EOF'
services:
  tor:
    container_name: sanctuary-tor
    command: -l "sanctuary_payjoin:80:backend:3001"
EOF
  cat > "$target_tor_compose" <<'EOF'
services:
  tor:
    container_name: ${TOR_CONTAINER_NAME:-sanctuary-tor}
    command:
      - sh
      - -c
      - /usr/bin/torproxy.sh -s "80;$${backend_ip}:3001"
EOF

  UPGRADE_EXPECT_OPTIONAL_PROFILES="true"

  isolate_legacy_optional_profile_compose "$source_checkout" "$target_checkout"
  UPGRADE_EXPECT_OPTIONAL_PROFILES="false"

  local contents
  contents="$(cat "$source_tor_compose")"

  assert_contains "$contents" '/usr/bin/torproxy.sh -s "80;$${backend_ip}:3001"' \
    "legacy Tor compose should be replaced with the target fixed overlay"
  assert_not_contains "$contents" 'command: -l ' \
    "legacy Tor compose should not keep the invalid hidden service command"
}

test_tor_compose_uses_supported_hidden_service_config() {
  local contents
  contents="$(cat "$PROJECT_ROOT/docker-compose.tor.yml")"

  assert_contains "$contents" "sed -i '/^StrictNodes /d; /^ExitNodes /d'" \
    "Tor compose should clear stale exit-node options before configuring hidden service"
  assert_contains "$contents" "mkdir -p /var/lib/tor/hidden_service" \
    "Tor compose should create the hidden-service directory before startup"
  assert_contains "$contents" "chmod 700 /var/lib/tor/hidden_service" \
    "Tor compose should apply Tor-compatible hidden-service directory permissions"
  assert_contains "$contents" 'getent hosts backend' \
    "Tor compose should resolve the backend service before configuring the hidden service"
  assert_contains "$contents" '/usr/bin/torproxy.sh -s "80;$${backend_ip}:3001"' \
    "Tor compose should use torproxy hidden-service option with a resolved backend IP"
  assert_contains "$contents" 'nc -z 127.0.0.1 9050' \
    "Tor healthcheck should validate the local IPv4 SOCKS port"
  assert_not_contains "$contents" 'command: -l ' \
    "Tor compose should not use the exit-node country option for hidden services"
  assert_not_contains "$contents" 'check.torproject.org' \
    "Tor healthcheck should not depend on public Tor reachability"
}

test_upgrade_harness_sources_extracted_helpers() {
  local contents
  contents="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"

  assert_contains "$contents" 'source "$SCRIPT_DIR/../utils/upgrade-two-factor-auth-helpers.sh"' \
    "upgrade harness should source extracted 2FA auth helpers"
  assert_contains "$contents" 'source "$SCRIPT_DIR/../utils/upgrade-two-factor-verification-helpers.sh"' \
    "upgrade harness should source extracted 2FA verification helpers"
  assert_contains "$contents" 'source "$SCRIPT_DIR/../utils/upgrade-notification-helpers.sh"' \
    "upgrade harness should source extracted notification helpers"
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
Worker queue cleanup oldKey=repeat:sync:mainnet:*/5 newJobId=repeat:sync:mainnet:*/5
{"apiKey":"json-api-key","safe":"visible"}
EOF

  redact_file "$log_file" "$redacted_file"

  local redacted
  local failures=0
  redacted="$(cat "$redacted_file")"

  assert_contains "$redacted" "ENCRYPTION_KEY=<redacted>" "key material should be redacted in logs" || failures=1
  assert_contains "$redacted" "POSTGRES_PASSWORD=<redacted>" "password should be redacted in logs" || failures=1
  assert_contains "$redacted" '"JWT_SECRET": "<redacted>"' "JSON secret should be redacted in logs" || failures=1
  assert_contains "$redacted" "oldKey=<redacted>" "camelCase key fields should be redacted in logs" || failures=1
  assert_contains "$redacted" "newJobId=<redacted>" "job ID fields should be redacted in logs" || failures=1
  assert_contains "$redacted" '"apiKey": "<redacted>"' "camelCase JSON key fields should be redacted in logs" || failures=1
  assert_contains "$redacted" '"HTTPS_PORT":"8443"' "non-secret JSON fields should remain visible" || failures=1
  assert_contains "$redacted" '"safe":"visible"' "non-secret JSON fields should remain visible" || failures=1
  assert_not_contains "$redacted" "key-material" "raw key material must not leak" || failures=1
  assert_not_contains "$redacted" "db-password" "raw password must not leak" || failures=1
  assert_not_contains "$redacted" "json-secret" "raw JSON secret must not leak" || failures=1
  assert_not_contains "$redacted" "json-api-key" "raw camelCase JSON key material must not leak" || failures=1
  assert_not_contains "$redacted" "repeat:sync:mainnet" "raw queue key material must not leak" || failures=1
  assert_not_contains "$redacted" "csrf-token" "CSRF token must not leak" || failures=1

  return "$failures"
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
  run_test "optional profiles is in release matrices" test_optional_profiles_is_in_release_matrices
  run_test "legacy optional profile compose is isolated" test_legacy_optional_profile_compose_is_isolated
  run_test "legacy optional profile compose can use target tor overlay" test_legacy_optional_profile_compose_can_use_target_tor_overlay
  run_test "tor compose uses supported hidden service config" test_tor_compose_uses_supported_hidden_service_config
  run_test "upgrade harness sources extracted helpers" test_upgrade_harness_sources_extracted_helpers
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
