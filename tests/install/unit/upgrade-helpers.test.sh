#!/bin/bash
# Unit tests for upgrade helper scripts.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

source "$PROJECT_ROOT/tests/install/utils/helpers.sh"
source "$PROJECT_ROOT/tests/install/utils/upgrade-test-defaults.sh"
source "$PROJECT_ROOT/tests/install/utils/upgrade-source-refs.sh"
source "$PROJECT_ROOT/tests/install/utils/upgrade-selection.sh"
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

write_cleanup_docker_stub() {
  local bin_dir="$TEST_TMP_DIR/bin"
  mkdir -p "$bin_dir"

  cat > "$bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "${DOCKER_CALL_LOG:?}"

if [ "$1" = "ps" ] && [ "${2:-}" = "-a" ] && [ "${3:-}" = "--format" ]; then
  printf '%s\n' \
    sanctuary-upgrade-test-old \
    sanctuary-upgrade-test-current \
    unrelated-project
  exit 0
fi

if [ "$1" = "network" ] && [ "${2:-}" = "ls" ] && [ "${3:-}" = "--format" ]; then
  printf '%s\n' \
    sanctuary-upgrade-test-old \
    sanctuary-upgrade-test-current
  exit 0
fi

if [ "$1" = "volume" ] && [ "${2:-}" = "ls" ] && [ "${3:-}" = "--format" ]; then
  printf '%s\n' sanctuary-upgrade-test-old
  exit 0
fi

if [ "$1" = "ps" ] && [ "${2:-}" = "-a" ] && [ "${3:-}" = "--filter" ] && [ "${5:-}" = "-q" ]; then
  case "$4" in
    label=com.docker.compose.project=sanctuary-upgrade-test-old)
      printf '%s\n' old-container
      ;;
    label=com.docker.compose.project=restart-project)
      printf '%s\n' restart-container-a restart-container-b
      ;;
  esac
  exit 0
fi

if [ "$1" = "network" ] && [ "${2:-}" = "ls" ] && [ "${3:-}" = "--filter" ] && [ "${5:-}" = "-q" ]; then
  case "$4" in
    label=com.docker.compose.project=sanctuary-upgrade-test-old)
      printf '%s\n' old-network
      ;;
  esac
  exit 0
fi

if [ "$1" = "volume" ] && [ "${2:-}" = "ls" ] && [ "${3:-}" = "--filter" ] && [ "${5:-}" = "-q" ]; then
  case "$4" in
    label=com.docker.compose.project=sanctuary-upgrade-test-old)
      printf '%s\n' old-volume
      ;;
  esac
  exit 0
fi

exit 0
EOF

  chmod +x "$bin_dir/docker"
}

shared_backend_services_with_build() {
  local compose_file="$1"

  awk '
    function flush_service() {
      if (service != "" && has_backend_image && has_build) {
        print service
      }
      has_backend_image = 0
      has_build = 0
    }

    /^  [^[:space:]#][^:]*:$/ {
      flush_service()
      service = $0
      sub(/^  /, "", service)
      sub(/:$/, "", service)
      next
    }

    # Matches the legacy literal `sanctuary-backend:local` still found in older
    # source checkouts as well as the parameterised
    # `sanctuary-backend:${SANCTUARY_IMAGE_TAG:-local}` current compose uses for
    # per-lane image isolation (#719).
    service != "" && /^    image: sanctuary-backend:[^[:space:]]+([[:space:]]|$)/ {
      has_backend_image = 1
    }

    service != "" && /^    build:/ {
      has_build = 1
    }

    END {
      flush_service()
    }
  ' "$compose_file"
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

# Stubs `docker run --rm --entrypoint cat <image> /app/package.json`, the only
# docker call assert_installed_image_matches_checkout makes. An empty version
# stands in for an image whose package.json cannot be read.
# The version must live in a global: bash has no closures, so a `local` set
# here would already be out of scope by the time docker() is invoked, and the
# stub would silently emit nothing.
STUB_DOCKER_IMAGE_VERSION=""
stub_docker_image_version() {
  STUB_DOCKER_IMAGE_VERSION="$1"
  docker() {
    if [ "$1" = "run" ]; then
      [ -n "$STUB_DOCKER_IMAGE_VERSION" ] &&
        printf '{"name":"sanctuary","version":"%s"}\n' "$STUB_DOCKER_IMAGE_VERSION"
      return 0
    fi
    return 0
  }
}

write_checkout_package_json() {
  local dir="$1"
  mkdir -p "$dir"
  printf '{"name":"sanctuary","version":"%s"}\n' "$2" > "$dir/package.json"
}

test_assert_installed_image_matches_checkout_accepts_match() {
  local checkout="$TEST_TMP_DIR/checkout-match"
  write_checkout_package_json "$checkout" "0.8.57"
  stub_docker_image_version "0.8.57"

  assert_installed_image_matches_checkout "$checkout" >/dev/null 2>&1
  local rc=$?
  unset -f docker
  assert_equals "0" "$rc" "matching versions should pass"
}

test_assert_installed_image_matches_checkout_rejects_mismatch() {
  # The real regression: a v0.8.57 checkout booting a v0.8.59 image because the
  # shared :local tag was left behind by another lane.
  local checkout="$TEST_TMP_DIR/checkout-mismatch"
  write_checkout_package_json "$checkout" "0.8.57"
  stub_docker_image_version "0.8.59"

  local output
  output="$(assert_installed_image_matches_checkout "$checkout" 2>&1)"
  local rc=$?
  unset -f docker
  assert_equals "1" "$rc" "mismatched versions should fail"
  assert_contains "$output" "0.8.59" "error should name the image version"
  assert_contains "$output" "0.8.57" "error should name the checkout version"
}

test_assert_installed_image_matches_checkout_skips_when_unreadable() {
  # Fail open: an image we cannot inspect must not manufacture a failure.
  local checkout="$TEST_TMP_DIR/checkout-unreadable"
  write_checkout_package_json "$checkout" "0.8.57"
  stub_docker_image_version ""

  assert_installed_image_matches_checkout "$checkout" >/dev/null 2>&1
  local rc=$?
  unset -f docker
  assert_equals "0" "$rc" "unreadable image version should not fail the install"
}

# The upgrade fixture files used to define upgrade_fixture_* hooks that nothing
# ever called -- the harness has no dispatcher, and the files were not even
# sourced. They also called helpers that no longer exist. Fixture behaviour is
# driven by flags from apply_upgrade_fixture_defaults instead, so the hooks were
# removed rather than wired up.
#
# Guard the invariant, not the absence: a hook may exist only if something in
# the harness calls it. That keeps this honest if a dispatcher is ever added.
test_no_undispatched_fixture_hooks() {
  local fixture_dir="$PROJECT_ROOT/tests/install/fixtures/upgrade"
  local defined hook undispatched=""

  [ -d "$fixture_dir" ] || return 0

  defined="$(grep -rhoE '^upgrade_fixture_[a-z_]+\(\)' "$fixture_dir" 2>/dev/null |
    sed 's/()$//' | sort -u)"
  [ -n "$defined" ] || return 0

  for hook in $defined; do
    # Only a real call counts. Matching any mention would let a comment that
    # merely names the hook satisfy the guard -- which is exactly how the first
    # version of this test passed while asserting nothing.
    if ! grep -rqE "^[^#]*\b$hook\b" \
      "$PROJECT_ROOT/tests/install/e2e" \
      "$PROJECT_ROOT/tests/install/utils" 2>/dev/null; then
      undispatched="$undispatched $hook"
    fi
  done

  if [ -n "$undispatched" ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} fixture hooks defined but never dispatched:$undispatched"
    echo "  Either dispatch them from the harness or delete them."
    return 1
  fi

  return 0
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

  local expected_browser_host="127.0.0.1"
  if is_containerized_runtime; then
    expected_browser_host="$(default_install_test_host)"
  fi
  assert_equals "$expected_browser_host" "$UPGRADE_BROWSER_HOST" "browser fixture should use IP origin"
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

test_baseline_browser_host_uses_upgrade_network_default() {
  local original_default="${UPGRADE_TEST_DEFAULT_BROWSER_HOST:-}"

  UPGRADE_TEST_DEFAULT_BROWSER_HOST="runner-host.example.invalid"
  UPGRADE_BROWSER_HOST=""

  apply_upgrade_fixture_defaults "baseline"

  local result=0
  assert_equals "runner-host.example.invalid" "$UPGRADE_BROWSER_HOST" \
    "baseline fixture should use the Docker-visible browser host default" || result=1

  UPGRADE_TEST_DEFAULT_BROWSER_HOST="$original_default"
  UPGRADE_BROWSER_HOST=""
  return "$result"
}

test_optional_profile_ports_follow_install_port_scope() {
  HTTPS_PORT="23030"
  COMPOSE_PROJECT_NAME="upgrade-fixture-unit"
  UPGRADE_OPTIONAL_PROFILE_PORT_BASE=""
  GRAFANA_PORT=""
  PROMETHEUS_PORT=""
  ALERTMANAGER_PORT=""
  JAEGER_UI_PORT=""
  LOKI_PORT=""
  JAEGER_OTLP_GRPC_PORT=""
  JAEGER_OTLP_HTTP_PORT=""

  apply_upgrade_fixture_defaults "optional-profiles"

  local result=0
  assert_equals "23130" "$GRAFANA_PORT" "optional fixture should derive Grafana port from HTTPS scope" || result=1
  assert_equals "23131" "$PROMETHEUS_PORT" "optional fixture should derive Prometheus port from HTTPS scope" || result=1
  assert_equals "23132" "$ALERTMANAGER_PORT" "optional fixture should derive Alertmanager port from HTTPS scope" || result=1
  assert_equals "23133" "$JAEGER_UI_PORT" "optional fixture should derive Jaeger UI port from HTTPS scope" || result=1
  assert_equals "23134" "$LOKI_PORT" "optional fixture should derive Loki port from HTTPS scope" || result=1
  assert_equals "23135" "$JAEGER_OTLP_GRPC_PORT" "optional fixture should derive Jaeger gRPC port from HTTPS scope" || result=1
  assert_equals "23136" "$JAEGER_OTLP_HTTP_PORT" "optional fixture should derive Jaeger HTTP port from HTTPS scope" || result=1

  HTTPS_PORT=""
  UPGRADE_OPTIONAL_PROFILE_PORT_BASE=""
  return "$result"
}

test_optional_profiles_is_in_release_coverage() {
  local install_contents
  local extended_fixtures
  local failures=0

  install_contents="$(cat "$PROJECT_ROOT/.github/workflows/install-test.yml")"
  extended_fixtures="$("$PROJECT_ROOT/scripts/ci/run-extended-upgrade-fixtures.sh" --list)"
  # install-test.yml is the canonical upgrade gate on tag pushes;
  # release-candidate.yml no longer runs upgrade fixtures (the
  # duplicate matrix it used to carry was unstable on the self-hosted
  # Forgejo runner — see the "Upgrade coverage note" comment in
  # release-candidate.yml).

  assert_contains "$install_contents" 'scripts/ci/run-extended-upgrade-fixtures.sh' \
    "install workflow should run the extended fixture script" || failures=1
  assert_contains "$extended_fixtures" 'optional-profiles 30' \
    "install extended upgrades should include optional profiles once" || failures=1
  assert_equals "1" "$(grep -c '^optional-profiles 30$' <<< "$extended_fixtures")" \
    "install extended upgrades should include optional profiles once" || failures=1

  return "$failures"
}

test_active_extended_fixture_selection_contract() {
  local expected_records
  local expected_csv
  local runner_records
  local failures=0

  expected_records=$'browser-origin-ip 21\nlegacy-runtime-env 24\nnotification-delivery 27\noptional-profiles 30'
  expected_csv='browser-origin-ip,legacy-runtime-env,notification-delivery,optional-profiles'
  runner_records="$("$PROJECT_ROOT/scripts/ci/run-extended-upgrade-fixtures.sh" --list)"

  assert_equals "$expected_records" "$(upgrade_active_extended_fixture_records)" \
    "active extended fixture registry should be stable" || failures=1
  assert_equals "$expected_csv" "$(upgrade_active_extended_fixtures_csv)" \
    "active extended fixture CSV should be stable" || failures=1
  assert_equals "$expected_records" "$runner_records" \
    "extended fixture runner should use the shared registry" || failures=1
  assert_equals "24" "$(upgrade_extended_fixture_port_offset legacy-runtime-env)" \
    "fixture port offsets should be table lookups, not selected-list positions" || failures=1

  return "$failures"
}

test_upgrade_selection_rejects_invalid_values() {
  local failures=0

  upgrade_validate_baseline_ref_selection "latest-stable,n-2" || failures=1
  upgrade_validate_extended_fixture_selection "browser-origin-ip,optional-profiles" || failures=1

  if upgrade_validate_baseline_ref_selection "latest-stable,bad ref" >/dev/null 2>&1; then
    echo -e "${RED}ASSERTION FAILED:${NC} invalid source ref selector should fail"
    failures=1
  fi

  if upgrade_validate_baseline_ref_selection "latest-stable," >/dev/null 2>&1; then
    echo -e "${RED}ASSERTION FAILED:${NC} empty source ref selector should fail"
    failures=1
  fi

  if upgrade_validate_extended_fixture_selection "browser-origin-ip,not-a-fixture" >/dev/null 2>&1; then
    echo -e "${RED}ASSERTION FAILED:${NC} invalid extended fixture should fail"
    failures=1
  fi

  if upgrade_validate_extended_fixture_selection ",browser-origin-ip" >/dev/null 2>&1; then
    echo -e "${RED}ASSERTION FAILED:${NC} empty extended fixture selector should fail"
    failures=1
  fi

  return "$failures"
}

test_upgrade_selection_labels_are_sanitized() {
  local failures=0

  assert_equals "latest-stable" "$(upgrade_sanitize_label latest-stable)" \
    "simple labels should remain readable" || failures=1
  assert_contains "$(upgrade_sanitize_label release/v0.8.39)" "release-v0-8-39-" \
    "punctuation-heavy refs should become Compose-safe labels with a disambiguator" || failures=1
  assert_contains "$(upgrade_sanitize_label feature.a)" "feature-a-" \
    "labels that could collide after punctuation removal should include a disambiguator" || failures=1
  assert_contains "$(upgrade_sanitize_label Feature-A)" "feature-a-" \
    "case-only label collisions should include a disambiguator" || failures=1
  assert_not_contains "$(upgrade_sanitize_label release/v0.8.39)" "/" \
    "sanitized labels should not include slash characters" || failures=1
  assert_not_contains "$(upgrade_sanitize_label release/v0.8.39)" "." \
    "sanitized labels should not include dot characters" || failures=1

  return "$failures"
}

test_upgrade_selection_manifest_records_resolved_refs() {
  local repo="$TEST_TMP_DIR/manifest-repo"
  local artifact_dir="$TEST_TMP_DIR/artifacts"
  local contents
  local failures=0

  mkdir -p "$repo"
  git -C "$repo" init -b main >/dev/null
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name "Upgrade Manifest Test"

  make_commit "$repo" "release-0.8.39"
  git -C "$repo" tag v0.8.39
  make_commit "$repo" "release-0.8.40"
  git -C "$repo" tag v0.8.40
  make_commit "$repo" "release-0.8.41"
  git -C "$repo" tag v0.8.41
  make_commit "$repo" "candidate"

  upgrade_write_selection_manifest \
    "$repo" \
    "$artifact_dir" \
    "latest-stable,n-2" \
    "optional-profiles" \
    "v0.8.39" \
    "12345"

  contents="$(cat "$artifact_dir/selection-manifest.md")"

  assert_contains "$contents" "- Run id: 12345" \
    "manifest should include the workflow run id" || failures=1
  assert_contains "$contents" 'selector: `latest-stable`; label: `latest-stable`; resolved: `v0.8.41`' \
    "manifest should resolve latest-stable" || failures=1
  assert_contains "$contents" 'selector: `n-2`; label: `n-2`; resolved: `v0.8.40`' \
    "manifest should resolve n-2" || failures=1
  assert_contains "$contents" 'selector: `v0.8.39`; label: `v0-8-39-' \
    "manifest should record the selected extended source ref label" || failures=1
  assert_contains "$contents" "- optional-profiles: port offset 30" \
    "manifest should include active fixture registry metadata" || failures=1

  return "$failures"
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
  local target_tor_compose="$target_checkout/docker/compose/tor.yml"
  local source_tor_ingress="$source_checkout/docker/tor/payjoin-ingress.conf"
  local target_tor_ingress="$target_checkout/docker/tor/payjoin-ingress.conf"

  mkdir -p "$source_checkout" "$target_checkout/docker/compose" "$target_checkout/docker/tor"
  cat > "$source_tor_compose" <<'EOF'
services:
  tor:
    container_name: sanctuary-tor
    command: -l "sanctuary_payjoin:80:backend:3001"
EOF
  cat > "$target_tor_ingress" <<'EOF'
server {
  listen 8080;
}
EOF
  cat > "$target_tor_compose" <<'EOF'
services:
  tor-ingress:
    image: sanctuary-frontend:local
  tor:
    container_name: ${TOR_CONTAINER_NAME:-sanctuary-tor}
    command:
      - sh
      - -c
      - /usr/bin/torproxy.sh -s "80;$${ingress_ip}:8080"
EOF

  UPGRADE_EXPECT_OPTIONAL_PROFILES="true"

  isolate_legacy_optional_profile_compose "$source_checkout" "$target_checkout"
  UPGRADE_EXPECT_OPTIONAL_PROFILES="false"

  local contents
  contents="$(cat "$source_tor_compose")"

  assert_contains "$contents" '/usr/bin/torproxy.sh -s "80;$${ingress_ip}:8080"' \
    "legacy Tor compose should be replaced with the target trusted-ingress overlay"
  assert_not_contains "$contents" 'command: -l ' \
    "legacy Tor compose should not keep the invalid hidden service command"
  assert_contains "$(cat "$source_tor_ingress")" 'listen 8080;' \
    "legacy Tor fixture should copy the target ingress configuration with its overlay"
}

test_legacy_optional_profile_compose_requires_target_tor_ingress() {
  local source_checkout="$TEST_TMP_DIR/source-missing-ingress"
  local target_checkout="$TEST_TMP_DIR/target-missing-ingress"

  mkdir -p "$source_checkout" "$target_checkout/docker/compose"
  cat > "$source_checkout/docker-compose.tor.yml" <<'EOF'
services:
  tor:
    command: -l "sanctuary_payjoin:80:backend:3001"
EOF
  cat > "$target_checkout/docker/compose/tor.yml" <<'EOF'
services:
  tor-ingress:
    image: sanctuary-frontend:local
EOF

  UPGRADE_EXPECT_OPTIONAL_PROFILES="true"
  if isolate_legacy_optional_profile_compose "$source_checkout" "$target_checkout" >/dev/null 2>&1; then
    UPGRADE_EXPECT_OPTIONAL_PROFILES="false"
    echo -e "${RED}ASSERTION FAILED:${NC} missing target Tor ingress config must fail closed"
    return 1
  fi
  UPGRADE_EXPECT_OPTIONAL_PROFILES="false"

  if [ -e "$source_checkout/docker/tor/payjoin-ingress.conf" ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} failed isolation must not fabricate an ingress config"
    return 1
  fi
}

test_tor_compose_uses_supported_hidden_service_config() {
  local contents
  contents="$(cat "$PROJECT_ROOT/docker/compose/tor.yml")"

  assert_contains "$contents" "sed -i '/^StrictNodes /d; /^ExitNodes /d'" \
    "Tor compose should clear stale exit-node options before configuring hidden service"
  assert_contains "$contents" "mkdir -p /var/lib/tor/hidden_service" \
    "Tor compose should create the hidden-service directory before startup"
  assert_contains "$contents" "chmod 700 /var/lib/tor/hidden_service" \
    "Tor compose should apply Tor-compatible hidden-service directory permissions"
  assert_contains "$contents" 'getent hosts tor-ingress' \
    "Tor compose should resolve the trusted ingress before configuring the hidden service"
  assert_contains "$contents" '/usr/bin/torproxy.sh -s "80;$${ingress_ip}:8080"' \
    "Tor compose should use torproxy hidden-service option with the trusted ingress"
  assert_not_contains "$contents" 'getent hosts backend' \
    "Tor compose should never expose the backend directly"
  assert_contains "$contents" 'nc -z 127.0.0.1 9050' \
    "Tor healthcheck should validate the local IPv4 SOCKS port"
  assert_not_contains "$contents" 'command: -l ' \
    "Tor compose should not use the exit-node country option for hidden services"
  assert_not_contains "$contents" 'check.torproject.org' \
    "Tor healthcheck should not depend on public Tor reachability"
}

test_upgrade_teardown_captures_diagnostics_before_cleanup() {
  local lane="$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh"

  # Scope to the teardown function: there is also a setup-time
  # cleanup_containers that clears stale state before the run, and comparing
  # against that one would compare the wrong pair of lines.
  local teardown_body capture_line cleanup_line
  teardown_body="$(awk '/^teardown\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$lane")"

  capture_line="$(printf '%s\n' "$teardown_body" | grep -n 'capture_compose_failure_diagnostics' | head -1 | cut -d: -f1)"
  cleanup_line="$(printf '%s\n' "$teardown_body" | grep -n 'cleanup_containers' | head -1 | cut -d: -f1)"

  if [ -z "$capture_line" ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} upgrade lane must capture compose failure diagnostics"
    return 1
  fi
  if [ -z "$cleanup_line" ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} could not locate cleanup_containers in the upgrade lane"
    return 1
  fi
  if [ "$capture_line" -ge "$cleanup_line" ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} diagnostics capture (line $capture_line) must precede cleanup (line $cleanup_line)"
    return 1
  fi
  return 0
}

# The source (legacy) stack is where upgrade failures have actually landed, so
# its diagnostics must be captured too, not only the target stack's.
test_upgrade_teardown_captures_source_checkout_diagnostics() {
  local lane="$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh"

  if ! grep -q 'capture_compose_failure_diagnostics "$UPGRADE_SOURCE_CHECKOUT"' "$lane"; then
    echo -e "${RED}ASSERTION FAILED:${NC} upgrade teardown must capture the source checkout's diagnostics"
    return 1
  fi
  return 0
}

# Run 8813: teardown executed while TESTS_FAILED read zero, so the gated
# capture from #691 never fired and cleanup destroyed the gateway's health log.
# This capture keys off container state instead of a counter, so it cannot be
# defeated by the counter being wrong.
test_unhealthy_capture_dumps_unhealthy_container() {
  local fake_bin="$TEST_TMP_DIR/bin-unhealthy"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/docker" <<'EOF'
#!/bin/sh
case "$1" in
  ps) echo "proj-gateway-1"; exit 0 ;;
  inspect)
    case "$*" in
      *Health.Status*) echo "unhealthy"; exit 0 ;;
      *) echo 'exit=1 output="syntax error: unexpected end of file"'; exit 0 ;;
    esac ;;
  logs) echo "gateway boot line"; exit 0 ;;
esac
exit 0
EOF
  chmod +x "$fake_bin/docker"

  local out
  out="$(PATH="$fake_bin:$PATH" bash -c 'source "$1"; capture_unhealthy_container_diagnostics proj' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" 2>&1)"

  assert_contains "$out" "Unhealthy container: proj-gateway-1" "should name the unhealthy container"
  assert_contains "$out" "syntax error" "should surface the healthcheck output that explains the failure"
}

# A healthy project must stay quiet, so this can run unconditionally without
# drowning successful runs in output.
test_unhealthy_capture_is_quiet_when_all_healthy() {
  local fake_bin="$TEST_TMP_DIR/bin-healthy"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/docker" <<'EOF'
#!/bin/sh
case "$1" in
  ps) echo "proj-gateway-1"; exit 0 ;;
  inspect) echo "healthy"; exit 0 ;;
esac
exit 0
EOF
  chmod +x "$fake_bin/docker"

  local out
  out="$(PATH="$fake_bin:$PATH" bash -c 'source "$1"; capture_unhealthy_container_diagnostics proj' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" 2>&1)"

  assert_contains "$out" "No unhealthy containers" "a healthy project should produce a single line"
  if echo "$out" | grep -q "Unhealthy container:"; then
    echo -e "${RED}ASSERTION FAILED:${NC} healthy project must not dump container diagnostics"
    return 1
  fi
}

test_monitoring_sync_stands_down_when_configs_are_reachable() {
  local src="$TEST_TMP_DIR/proj-standdown"
  mkdir -p "$src/docker/monitoring"
  : > "$src/docker/monitoring/prometheus.yml"

  local out
  out="$(SANCTUARY_MONITORING_CONFIG_DIR="/host/real/path" \
    bash -c 'source "$1"; sync_monitoring_configs_to_daemon "$2"; echo "STATUS=$SYNC_MONITORING_STATUS"' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" "$src" 2>&1)"

  assert_contains "$out" "STATUS=skipped: configs reachable at /host/real/path" \
    "the shim should stand down when the engine can already read the configs"
}

# With no translation available the value equals the job-side path, so the shim
# must still run — a Docker-in-Docker host still needs it.
test_monitoring_sync_still_runs_when_path_is_untranslated() {
  local src="$TEST_TMP_DIR/proj-runs"
  mkdir -p "$src/docker/monitoring"
  : > "$src/docker/monitoring/prometheus.yml"

  local out
  out="$(SANCTUARY_MONITORING_CONFIG_DIR="$src/docker/monitoring" \
    bash -c 'source "$1"; sync_monitoring_configs_to_daemon "$2" >/dev/null 2>&1; echo "STATUS=$SYNC_MONITORING_STATUS"' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" "$src" 2>&1)"

  if echo "$out" | grep -q "skipped: configs reachable"; then
    echo -e "${RED}ASSERTION FAILED:${NC} shim must not stand down when the path was not translated"
    return 1
  fi
  return 0
}

test_install_scopes_monitoring_config_dir_per_checkout() {
  local lane="$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh"
  local body
  body="$(awk '/^run_install_script\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$lane")"

  if ! printf '%s\n' "$body" | grep -q 'SANCTUARY_MONITORING_CONFIG_DIR'; then
    echo -e "${RED}ASSERTION FAILED:${NC} run_install_script must scope SANCTUARY_MONITORING_CONFIG_DIR to the checkout it installs"
    return 1
  fi
  if ! printf '%s\n' "$body" | grep -q 'monitoring_config_dir_for_compose "$project_dir"'; then
    echo -e "${RED}ASSERTION FAILED:${NC} the scoped value must be derived from the checkout being installed"
    return 1
  fi
  return 0
}

test_current_compose_builds_shared_backend_image_once() {
  local services
  services="$(shared_backend_services_with_build "$PROJECT_ROOT/docker-compose.yml" | paste -sd ',' -)"

  assert_equals "backend" "$services" \
    "current compose should not export sanctuary-backend:local from multiple services"
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
  assert_contains "$contents" 'run_install_script_command "$project_dir" 2>&1 | redact_stream | tee "$install_log"' \
    "upgrade harness should redact install output before writing CI logs"
  assert_contains "$contents" 'install_log_has_buildkit_cache_corruption "$install_log"' \
    "upgrade harness should detect legacy source install BuildKit cache corruption"
  assert_contains "$contents" 'recover_upgrade_builder_cache' \
    "upgrade harness should recover Docker builder cache for disposable legacy source installs"
  assert_contains "$contents" 'install.sh exited successfully after BuildKit cache corruption; retrying source install' \
    "upgrade harness should retry legacy source installs that hide BuildKit failures behind a zero exit"
  assert_contains "$contents" 'run_install_script_attempt "$project_dir" "$install_log" true' \
    "upgrade harness should retry source install once after builder-cache recovery"
  assert_contains "$contents" 'emit_upgrade_phase_timing "$test_name" "$exit_code"' \
    "upgrade harness should time each run_test phase" || return 1
  assert_contains "$contents" '::notice title=CI timing::${message}' \
    "upgrade harness should emit CI timing notices for passed phases"
}

test_upgrade_harness_restart_fallback_is_opt_in() {
  local contents
  local failures=0

  contents="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"

  assert_contains "$contents" 'UPGRADE_ALLOW_RESTART_FALLBACK="${SANCTUARY_UPGRADE_ALLOW_RESTART_FALLBACK:-false}"' \
    "upgrade harness should default restart fallback to disabled" || failures=1
  assert_contains "$contents" "did not resolve to an older checkout" \
    "unresolved symbolic refs should fail instead of silently restarting" || failures=1
  assert_contains "$contents" "Source and target resolve to the same commit; refusing restart fallback" \
    "same-commit source and target should fail unless restart fallback is explicit" || failures=1
  assert_contains "$contents" "Set SANCTUARY_UPGRADE_ALLOW_RESTART_FALLBACK=true only for explicit restart-debug runs" \
    "restart fallback should require an explicit debug opt-in" || failures=1
  assert_contains "$contents" 'export SANCTUARY_RESTART_POLICY=no' \
    "restart fallback should use the non-mutating current Compose override" || failures=1
  assert_contains "$contents" 'if [ "$UPGRADE_SOURCE_CREATED" = "true" ]; then' \
    "historical Compose rewriting should be limited to a disposable source checkout" || failures=1

  return "$failures"
}

test_install_workflow_uses_run_scoped_ssl_dirs() {
  local contents
  local checkout_count
  local clean_false_count
  contents="$(cat "$PROJECT_ROOT/.github/workflows/install-test.yml")"

  assert_contains "$contents" 'SANCTUARY_RUNNER_LOCK_DIR: ${{ github.workspace }}/.tmp/runner-locks-v2' \
    "install workflow should keep inner runner locks under the checked-out workspace"
  assert_contains "$contents" 'SANCTUARY_SSL_DIR="$(default_install_test_root "$PWD")/ssl-${COMPOSE_PROJECT_NAME}"' \
    "install workflow should generate SSL material under the run-scoped install-test root"
  assert_not_contains "$contents" 'SANCTUARY_SSL_DIR="$PWD/docker/nginx/ssl"' \
    "install workflow should not write generated SSL material into a fixed repo path"

  checkout_count="$(grep -c 'uses: actions/checkout' <<< "$contents")"
  clean_false_count="$(grep -c 'clean: false' <<< "$contents")"
  assert_equals "$checkout_count" "$clean_false_count" \
    "install workflow checkout steps should not pre-clean shared runner workspaces"
}

test_release_tag_workflows_use_distinct_concurrency_groups() {
  local install_contents
  local rc_contents
  local failures=0

  install_contents="$(cat "$PROJECT_ROOT/.github/workflows/install-test.yml")"
  rc_contents="$(cat "$PROJECT_ROOT/.github/workflows/release-candidate.yml")"

  assert_contains "$install_contents" "startsWith(github.ref, 'refs/tags/v')" \
    "install workflow should isolate release tags from unrelated non-PR runs" || failures=1
  assert_contains "$install_contents" "format('sanctuary-install-release-{0}', github.ref)" \
    "install workflow should give each release tag a stable concurrency group" || failures=1
  assert_contains "$rc_contents" 'group: sanctuary-release-candidate-${{ github.ref }}' \
    "release-candidate workflow should use a tag-scoped group distinct from install-test" || failures=1
  assert_not_contains "$rc_contents" "group: sanctuary-runner-e2e-workflow" \
    "release-candidate workflow should not compete with install-test for one pending slot" || failures=1

  return "$failures"
}

test_upgrade_harness_covers_historical_transaction_migrations() {
  local contents
  local failures=0

  contents="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"

  assert_contains "$contents" 'source "$SCRIPT_DIR/../utils/upgrade-transaction-migration-helpers.sh"' \
    "upgrade harness should load transaction migration fixtures" || failures=1
  assert_contains "$contents" "seed_transaction_migration_fixture" \
    "upgrade harness should seed v0.8.57 transaction rows before migration" || failures=1
  assert_contains "$contents" "test_verify_transaction_migrations" \
    "upgrade harness should verify historical rows after migration" || failures=1
  assert_contains "$contents" 'run_test "Verify Transaction Migrations" test_verify_transaction_migrations' \
    "upgrade suite should execute transaction migration verification" || failures=1

  return "$failures"
}

test_upgrade_harness_never_logs_secret_prefixes() {
  local contents

  contents="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"

  assert_not_contains "$contents" ':0:8}' \
    "upgrade diagnostics must not print partial values from secret variables"
}

test_runner_lock_helper_uses_cross_uid_writable_locks() {
  local contents
  contents="$(cat "$PROJECT_ROOT/scripts/ci/with-runner-lock.sh")"

  assert_contains "$contents" 'chmod 1777 "$lock_dir"' \
    "runner lock directory should be writable across job user IDs"
  assert_contains "$contents" 'umask 000' \
    "runner lock files should be created writable across job user IDs"
  assert_contains "$contents" 'chmod 666 "$lock_file"' \
    "runner lock files should remain writable when reused by another job user"
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

test_install_root_defaults_to_tmp_outside_actions() {
  local root
  root="$(env -u SANCTUARY_INSTALL_TEST_ROOT -u GITHUB_WORKSPACE ACT=false \
    bash -c 'source "$1"; default_install_test_root "$2"' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" "/home/test/repo")"

  assert_equals "/tmp" "$root" "non-Actions install tests should default to /tmp"
}

test_install_root_uses_workspace_in_actions() {
  local root
  local uid
  uid="$(id -u)"

  root="$(SANCTUARY_INSTALL_TEST_ROOT="" GITHUB_WORKSPACE="/workspace/sanctuary" GITHUB_RUN_ID="12345" ACT=true \
    bash -c 'source "$1"; default_install_test_root "$2"' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" "$PROJECT_ROOT")"

  assert_equals "/workspace/sanctuary/.tmp/install-tests-12345-$uid" "$root" \
    "Actions install tests should use a Docker-visible workspace path"
}

test_install_root_uses_workspace_mount_without_actions_env() {
  local root
  local uid
  uid="$(id -u)"

  root="$(env -u SANCTUARY_INSTALL_TEST_ROOT -u GITHUB_WORKSPACE GITHUB_RUN_ID="67890" ACT=false \
    bash -c 'source "$1"; default_install_test_root "$2"' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" "/workspace/owner/repo")"

  assert_equals "/workspace/owner/repo/.tmp/install-tests-67890-$uid" "$root" \
    "workspace-mounted runner tests should use a Docker-visible workspace path"
}

test_install_root_honors_explicit_override() {
  local root
  root="$(SANCTUARY_INSTALL_TEST_ROOT="/custom/install-tests" GITHUB_WORKSPACE="/workspace/sanctuary" ACT=true \
    bash -c 'source "$1"; default_install_test_root "$2"' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" "$PROJECT_ROOT")"

  assert_equals "/custom/install-tests" "$root" "explicit install test root should win"
}

test_docker_visible_path_maps_workspace_volume() {
  local fake_bin="$TEST_TMP_DIR/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/docker" <<'EOF'
#!/bin/sh
if [ "$1" = "inspect" ]; then
  printf '%s\t%s\n' "/var/lib/docker/volumes/workspace/_data" "/workspace/sanctuary"
  printf '%s\t%s\n' "/var/run/docker.sock" "/var/run/docker.sock"
  exit 0
fi
exit 1
EOF
  chmod +x "$fake_bin/docker"

  local mapped
  mapped="$(HOSTNAME="test-container" PATH="$fake_bin:$PATH" \
    bash -c 'source "$1"; docker_visible_path "$2"' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" \
    "/workspace/sanctuary/.tmp/install-tests/certs")"

  assert_equals "/var/lib/docker/volumes/workspace/_data/.tmp/install-tests/certs" "$mapped" \
    "workspace volume path should map to Docker daemon-visible source"
}

test_install_test_host_resolves_default() {
  local host
  host="$(SANCTUARY_INSTALL_TEST_HOST="" bash -c 'source "$1"; default_install_test_host' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh")"

  if [ -z "$host" ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} default install test host should not be empty"
    return 1
  fi
}

test_install_test_host_honors_override() {
  local host
  host="$(SANCTUARY_INSTALL_TEST_HOST="gateway.example.invalid" \
    bash -c 'source "$1"; default_install_test_host' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh")"

  assert_equals "gateway.example.invalid" "$host" "explicit test host should win"
}

# Podman writes /run/.containerenv rather than Docker's /.dockerenv, so a
# marker check that only looks for /.dockerenv concludes "not containerised"
# and returns localhost. On a rootless Podman runner the published port is not
# reachable on loopback, which is what the issue #667 canary observed.
test_install_test_host_detects_podman_container_marker() {
  local fake_bin="$TEST_TMP_DIR/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/getent" <<'EOF'
#!/bin/sh
if [ "$1" = "hosts" ] && [ "$2" = "host.containers.internal" ]; then
  echo "10.88.0.1       host.containers.internal"
  exit 0
fi
exit 2
EOF
  chmod +x "$fake_bin/getent"

  local marker="$TEST_TMP_DIR/containerenv"
  : > "$marker"

  local host
  host="$(SANCTUARY_INSTALL_TEST_HOST="" \
    SANCTUARY_CONTAINER_MARKER_DOCKER="$TEST_TMP_DIR/absent-dockerenv" \
    SANCTUARY_CONTAINER_MARKER_PODMAN="$marker" \
    PATH="$fake_bin:$PATH" \
    bash -c 'source "$1"; default_install_test_host' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh")"

  assert_equals "10.88.0.1" "$host" \
    "Podman container marker should resolve via host.containers.internal, not localhost"
}

# A Docker runner must keep resolving through host.docker.internal exactly as
# before; host.containers.internal does not exist there.
test_install_test_host_still_prefers_docker_internal_on_docker() {
  local fake_bin="$TEST_TMP_DIR/bin-docker"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/getent" <<'EOF'
#!/bin/sh
if [ "$1" = "hosts" ] && [ "$2" = "host.docker.internal" ]; then
  echo "172.17.0.1      host.docker.internal"
  exit 0
fi
exit 2
EOF
  chmod +x "$fake_bin/getent"

  local marker="$TEST_TMP_DIR/dockerenv"
  : > "$marker"

  local host
  host="$(SANCTUARY_INSTALL_TEST_HOST="" \
    SANCTUARY_CONTAINER_MARKER_DOCKER="$marker" \
    SANCTUARY_CONTAINER_MARKER_PODMAN="$TEST_TMP_DIR/absent-containerenv" \
    PATH="$fake_bin:$PATH" \
    bash -c 'source "$1"; default_install_test_host' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh")"

  assert_equals "172.17.0.1" "$host" \
    "Docker container should still resolve via host.docker.internal"
}

# Outside any container both markers are absent and loopback stays correct.
# A container healthcheck is retryable by design: it can report unhealthy while
# the service is still coming up and then recover. wait_for_container_healthy
# treated the first "unhealthy" as terminal, so a slow-starting service failed
# the lane even though it became healthy moments later. This is what failed the
# gateway on install-test run 8650 — the gateway logged "started with HTTPS on
# port 4000" two seconds after the waiter had already given up.
test_wait_for_container_healthy_tolerates_recovery() {
  local fake_bin="$TEST_TMP_DIR/bin-health-recover"
  mkdir -p "$fake_bin"
  local counter="$TEST_TMP_DIR/health-calls"
  : > "$counter"

  cat > "$fake_bin/docker" <<EOF
#!/bin/sh
if [ "\$1" = "inspect" ]; then
  printf 'x' >> "$counter"
  calls=\$(wc -c < "$counter" | tr -d ' ')
  if [ "\$calls" -lt 2 ]; then echo "unhealthy"; else echo "healthy"; fi
  exit 0
fi
exit 0
EOF
  chmod +x "$fake_bin/docker"

  if PATH="$fake_bin:$PATH" HEALTH_CHECK_TIMEOUT=30 \
      bash -c 'source "$1"; wait_for_container_healthy "svc" 30' _ \
      "$PROJECT_ROOT/tests/install/utils/helpers.sh" >/dev/null 2>&1; then
    return 0
  fi

  echo -e "${RED}ASSERTION FAILED:${NC} waiter should tolerate a transient unhealthy state and succeed on recovery"
  return 1
}

# A container that never recovers must still fail, and on the timeout path
# rather than silently passing.
test_wait_for_container_healthy_fails_when_never_healthy() {
  local fake_bin="$TEST_TMP_DIR/bin-health-stuck"
  mkdir -p "$fake_bin"

  cat > "$fake_bin/docker" <<'EOF'
#!/bin/sh
[ "$1" = "inspect" ] && { echo "unhealthy"; exit 0; }
exit 0
EOF
  chmod +x "$fake_bin/docker"

  if PATH="$fake_bin:$PATH" \
      bash -c 'source "$1"; wait_for_container_healthy "svc" 5' _ \
      "$PROJECT_ROOT/tests/install/utils/helpers.sh" >/dev/null 2>&1; then
    echo -e "${RED}ASSERTION FAILED:${NC} a permanently unhealthy container must fail the waiter"
    return 1
  fi
  return 0
}

test_install_test_host_uses_localhost_outside_container() {
  local host
  host="$(SANCTUARY_INSTALL_TEST_HOST="" \
    SANCTUARY_CONTAINER_MARKER_DOCKER="$TEST_TMP_DIR/absent-dockerenv" \
    SANCTUARY_CONTAINER_MARKER_PODMAN="$TEST_TMP_DIR/absent-containerenv" \
    bash -c 'source "$1"; default_install_test_host' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh")"

  assert_equals "localhost" "$host" \
    "no container marker should resolve to localhost"
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
  local private_origin
  local private_service
  local private_docker

  private_origin="$(printf '10.%s.2.3' "1")"
  private_service="$(printf '192.168.%s.20' "1")"
  private_docker="$(printf '172.17.%s.1' "0")"

  cat > "$log_file" <<EOF
Save these values:
ENCRYPTION_KEY=key-material
POSTGRES_PASSWORD=db-password
{"JWT_SECRET":"json-secret","HTTPS_PORT":"8443"}
Request header X-CSRF-Token: csrf-token
Worker queue cleanup oldKey=repeat:sync:mainnet:*/5 newJobId=repeat:sync:mainnet:*/5
{"apiKey":"json-api-key","safe":"visible"}
origin=http://${private_origin}:3000/owner/repo.git
gateway=https://${private_service}:8443/api/v1/health
docker_host=${private_docker}
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
  assert_contains "$redacted" "origin=<private-url>" "private origin URLs should be redacted in logs" || failures=1
  assert_contains "$redacted" "gateway=<private-url>" "private service URLs should be redacted in logs" || failures=1
  assert_contains "$redacted" "docker_host=<private-ip>" "private IP values should be redacted in logs" || failures=1
  assert_contains "$redacted" '"HTTPS_PORT":"8443"' "non-secret JSON fields should remain visible" || failures=1
  assert_contains "$redacted" '"safe":"visible"' "non-secret JSON fields should remain visible" || failures=1
  assert_not_contains "$redacted" "key-material" "raw key material must not leak" || failures=1
  assert_not_contains "$redacted" "db-password" "raw password must not leak" || failures=1
  assert_not_contains "$redacted" "json-secret" "raw JSON secret must not leak" || failures=1
  assert_not_contains "$redacted" "json-api-key" "raw camelCase JSON key material must not leak" || failures=1
  assert_not_contains "$redacted" "repeat:sync:mainnet" "raw queue key material must not leak" || failures=1
  assert_not_contains "$redacted" "csrf-token" "CSRF token must not leak" || failures=1
  assert_not_contains "$redacted" "$private_origin" "private origin IP must not leak" || failures=1
  assert_not_contains "$redacted" "$private_service" "private service IP must not leak" || failures=1
  assert_not_contains "$redacted" "$private_docker" "private Docker host IP must not leak" || failures=1

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

test_support_package_smoke_confirms_shareable_aggregate() {
  local curl_calls="$TEST_TMP_DIR/support-curl-calls.txt"

  COOKIE_JAR="$TEST_TMP_DIR/cookies.txt"
  CSRF_TOKEN="csrf-for-support"

  log_info() { :; }
  log_error() { echo "$*" >&2; }
  curl() {
    printf '%s\n' "$*" >> "$curl_calls"
    printf '{"version":"2.0.0","profile":"shareable_aggregate","generatedAt":"2026-08-02T12:30:00.000Z","serverVersion":"0.8.58","collectors":{},"meta":{"totalDurationMs":1,"succeeded":[],"failed":[]}}'
  }

  assert_support_package_generation "https://localhost:9443"
  local result=$?
  local calls
  calls="$(cat "$curl_calls")"

  unset -f log_info log_error curl

  if [ "$result" -ne 0 ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} support package smoke should accept a valid response"
    return 1
  fi

  assert_contains "$calls" '-d {"confirmShareableAggregate":true}' \
    "support package request should explicitly confirm shareable aggregate disclosure"
}

test_cleanup_compose_projects_by_prefix_skips_current_project() {
  local call_log="$TEST_TMP_DIR/docker-calls.log"
  local original_path="$PATH"
  local calls

  write_cleanup_docker_stub
  : > "$call_log"

  export DOCKER_CALL_LOG="$call_log"
  PATH="$TEST_TMP_DIR/bin:$PATH"
  cleanup_compose_projects_by_prefix "sanctuary-upgrade-test-" "sanctuary-upgrade-test-current"
  PATH="$original_path"
  unset DOCKER_CALL_LOG

  calls="$(cat "$call_log")"

  assert_contains "$calls" "rm -f old-container" \
    "stale project containers should be removed by compose label" || return 1
  assert_contains "$calls" "network rm old-network" \
    "stale project networks should be removed by compose label" || return 1
  assert_contains "$calls" "volume rm -f old-volume" \
    "stale project volumes should be removed by compose label" || return 1
  assert_not_contains "$calls" "label=com.docker.compose.project=sanctuary-upgrade-test-current" \
    "current project must not be removed during stale-project cleanup"
}

test_disable_compose_project_restart_policy_updates_project_containers() {
  local call_log="$TEST_TMP_DIR/docker-calls.log"
  local original_path="$PATH"
  local calls

  write_cleanup_docker_stub
  : > "$call_log"

  export DOCKER_CALL_LOG="$call_log"
  PATH="$TEST_TMP_DIR/bin:$PATH"
  disable_compose_project_restart_policy "restart-project"
  PATH="$original_path"
  unset DOCKER_CALL_LOG

  calls="$(cat "$call_log")"

  assert_contains "$calls" "update --restart=no restart-container-a restart-container-b" \
    "upgrade test containers should not resurrect after daemon restarts"
}

test_force_test_compose_restart_policy_no_rewrites_historical_files() {
  local checkout="$TEST_TMP_DIR/historical-checkout"
  local contents
  mkdir -p "$checkout/docker/compose"

  cat > "$checkout/docker-compose.yml" <<'EOF'
services:
  backend:
    image: historical-backend
    restart: unless-stopped
  migrate:
    image: historical-backend
    restart: "no"
EOF
  cat > "$checkout/docker-compose.monitoring.yml" <<'EOF'
services:
  prometheus:
    image: historical-prometheus
    restart: always # historical policy
EOF
  cat > "$checkout/docker-compose.ghcr.yml" <<'EOF'
services:
  backend:
    image: historical-prebuilt-backend
    restart: unless-stopped
EOF
  cat > "$checkout/docker/compose/tor.yml" <<'EOF'
services:
  tor:
    image: historical-tor
    restart: "${SANCTUARY_RESTART_POLICY:-unless-stopped}"
EOF

  force_test_compose_restart_policy_no "$checkout"

  contents="$(cat \
    "$checkout/docker-compose.yml" \
    "$checkout/docker-compose.ghcr.yml" \
    "$checkout/docker-compose.monitoring.yml" \
    "$checkout/docker/compose/tor.yml")"
  assert_equals "5" "$(grep -c 'restart: "no"' <<<"$contents")" \
    "every historical and current restart declaration should become no" || return 1
  assert_not_contains "$contents" "unless-stopped" \
    "historical test checkout must not retain unless-stopped" || return 1
  assert_not_contains "$contents" "restart: always" \
    "historical test checkout must not retain always" || return 1
  assert_contains "$contents" "image: historical-backend" \
    "non-restart Compose content must be preserved" || return 1
}

test_exit_cleanup_trap_runs_on_normal_exit() {
  local trap_script="$TEST_TMP_DIR/trap-check.sh"
  local trap_log="$TEST_TMP_DIR/trap.log"
  local output

  cat > "$trap_script" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$PROJECT_ROOT/tests/install/utils/helpers.sh"
log_warning() { :; }
probe_cleanup() {
  printf 'cleanup:%s\n' "\$1" >> "$trap_log"
}
setup_exit_cleanup_trap probe_cleanup /tmp/upgrade-project
EOF
  chmod +x "$trap_script"

  "$trap_script"
  output="$(cat "$trap_log")"

  assert_contains "$output" "cleanup:/tmp/upgrade-project" \
    "EXIT cleanup trap should run when the test process exits normally"
}

test_exit_cleanup_trap_preserves_failure_status() {
  local trap_script="$TEST_TMP_DIR/trap-fail-check.sh"
  local trap_log="$TEST_TMP_DIR/trap-fail.log"
  local exit_code

  cat > "$trap_script" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$PROJECT_ROOT/tests/install/utils/helpers.sh"
log_warning() { :; }
probe_cleanup() {
  printf 'cleanup:%s\n' "\$1" >> "$trap_log"
}
setup_exit_cleanup_trap probe_cleanup /tmp/upgrade-project
exit 7
EOF
  chmod +x "$trap_script"

  set +e
  "$trap_script"
  exit_code=$?
  set -e

  assert_equals "7" "$exit_code" \
    "EXIT cleanup trap should preserve the original failing status" || return 1
  assert_contains "$(cat "$trap_log")" "cleanup:/tmp/upgrade-project" \
    "cleanup should still run before the failure exits"
}

cleanup_status_success() {
  return 0
}

cleanup_status_failure() {
  return 9
}

test_upgrade_finish_preserves_failed_fixture_status() {
  local exit_code

  set +e
  upgrade_finish_with_cleanup 7 cleanup_status_success test-project
  exit_code=$?
  set -e

  assert_equals "7" "$exit_code" \
    "successful cleanup must preserve the failed fixture status"
}

test_upgrade_finish_preserves_failure_when_cleanup_fails() {
  local exit_code

  set +e
  upgrade_finish_with_cleanup 7 cleanup_status_failure test-project >/dev/null 2>&1
  exit_code=$?
  set -e

  assert_equals "7" "$exit_code" \
    "cleanup failure must not replace the original fixture failure"
}

test_upgrade_finish_fails_successful_fixture_on_cleanup_failure() {
  local exit_code

  set +e
  upgrade_finish_with_cleanup 0 cleanup_status_failure test-project >/dev/null 2>&1
  exit_code=$?
  set -e

  assert_equals "9" "$exit_code" \
    "cleanup failure must fail an otherwise successful fixture"
}

main() {
  echo ""
  echo "Upgrade Helper Unit Tests"
  echo "========================="

  run_test "source ref aliases resolve stable tags" test_source_ref_aliases_resolve_stable_tags
  run_test "fixture defaults are composable" test_fixture_defaults_are_composable
  run_test "baseline browser host uses upgrade network default" test_baseline_browser_host_uses_upgrade_network_default
  run_test "optional profile ports follow install port scope" test_optional_profile_ports_follow_install_port_scope
  run_test "optional profiles is in release coverage" test_optional_profiles_is_in_release_coverage
  run_test "active extended fixture selection contract" test_active_extended_fixture_selection_contract
  run_test "upgrade selection rejects invalid values" test_upgrade_selection_rejects_invalid_values
  run_test "upgrade selection labels are sanitized" test_upgrade_selection_labels_are_sanitized
  run_test "upgrade selection manifest records resolved refs" test_upgrade_selection_manifest_records_resolved_refs
  run_test "legacy optional profile compose is isolated" test_legacy_optional_profile_compose_is_isolated
  run_test "install scopes monitoring config dir per checkout" test_install_scopes_monitoring_config_dir_per_checkout
  run_test "monitoring sync stands down when reachable" test_monitoring_sync_stands_down_when_configs_are_reachable
  run_test "monitoring sync still runs when untranslated" test_monitoring_sync_still_runs_when_path_is_untranslated
  run_test "upgrade teardown captures diagnostics before cleanup" test_upgrade_teardown_captures_diagnostics_before_cleanup
  run_test "unhealthy capture dumps the unhealthy container" test_unhealthy_capture_dumps_unhealthy_container
  run_test "unhealthy capture is quiet when all healthy" test_unhealthy_capture_is_quiet_when_all_healthy
  run_test "upgrade teardown captures source checkout diagnostics" test_upgrade_teardown_captures_source_checkout_diagnostics
  run_test "legacy optional profile compose can use target tor overlay" test_legacy_optional_profile_compose_can_use_target_tor_overlay
  run_test "legacy optional profile compose requires target tor ingress" test_legacy_optional_profile_compose_requires_target_tor_ingress
  run_test "tor compose uses supported hidden service config" test_tor_compose_uses_supported_hidden_service_config
  run_test "current compose builds shared backend image once" test_current_compose_builds_shared_backend_image_once
  run_test "upgrade harness sources extracted helpers" test_upgrade_harness_sources_extracted_helpers
  run_test "upgrade harness restart fallback is opt-in" test_upgrade_harness_restart_fallback_is_opt_in
  run_test "install workflow uses run-scoped ssl dirs" test_install_workflow_uses_run_scoped_ssl_dirs
  run_test "release tag workflows use distinct concurrency groups" test_release_tag_workflows_use_distinct_concurrency_groups
  run_test "upgrade harness covers historical transaction migrations" test_upgrade_harness_covers_historical_transaction_migrations
  run_test "upgrade harness never logs secret prefixes" test_upgrade_harness_never_logs_secret_prefixes
  run_test "runner lock helper uses cross-UID writable locks" test_runner_lock_helper_uses_cross_uid_writable_locks
  run_test "upgrade network defaults respect overrides" test_upgrade_network_defaults_respect_overrides
  run_test "invalid fixture is rejected" test_invalid_fixture_is_rejected
  run_test "install root defaults to tmp outside actions" test_install_root_defaults_to_tmp_outside_actions
  run_test "install root uses workspace in actions" test_install_root_uses_workspace_in_actions
  run_test "install root uses workspace mount without actions env" test_install_root_uses_workspace_mount_without_actions_env
  run_test "install root honors explicit override" test_install_root_honors_explicit_override
  run_test "docker visible path maps workspace volume" test_docker_visible_path_maps_workspace_volume
  run_test "install test host resolves default" test_install_test_host_resolves_default
  run_test "install test host honors override" test_install_test_host_honors_override
  run_test "install test host detects podman container marker" test_install_test_host_detects_podman_container_marker
  run_test "install test host still prefers docker internal on docker" test_install_test_host_still_prefers_docker_internal_on_docker
  run_test "install test host uses localhost outside container" test_install_test_host_uses_localhost_outside_container
  run_test "health waiter tolerates transient unhealthy" test_wait_for_container_healthy_tolerates_recovery
  run_test "health waiter still fails when never healthy" test_wait_for_container_healthy_fails_when_never_healthy
  run_test "redacted env hides upgrade secrets" test_redacted_env_hides_upgrade_secrets
  run_test "diagnostic redaction hides log secrets" test_diagnostic_redaction_hides_log_secrets
  run_test "stale upgrade projects cleanup skips current project" test_cleanup_compose_projects_by_prefix_skips_current_project
  run_test "upgrade cleanup disables restart policy" test_disable_compose_project_restart_policy_updates_project_containers
  run_test "historical Compose files disable restart before startup" test_force_test_compose_restart_policy_no_rewrites_historical_files
  run_test "exit cleanup trap runs on normal exit" test_exit_cleanup_trap_runs_on_normal_exit
  run_test "exit cleanup trap preserves failure status" test_exit_cleanup_trap_preserves_failure_status
  run_test "upgrade cleanup preserves failed fixture status" test_upgrade_finish_preserves_failed_fixture_status
  run_test "upgrade cleanup preserves failure when cleanup fails" test_upgrade_finish_preserves_failure_when_cleanup_fails
  run_test "upgrade cleanup fails successful fixture on cleanup failure" test_upgrade_finish_fails_successful_fixture_on_cleanup_failure
  run_test "browser refresh smoke sends csrf header" test_browser_refresh_smoke_sends_csrf_header
  run_test "support package smoke confirms shareable aggregate" test_support_package_smoke_confirms_shareable_aggregate
  run_test "no undispatched upgrade fixture hooks" test_no_undispatched_fixture_hooks
  run_test "installed image matching checkout passes" test_assert_installed_image_matches_checkout_accepts_match
  run_test "installed image from another ref fails" test_assert_installed_image_matches_checkout_rejects_mismatch
  run_test "unreadable image version is not a failure" test_assert_installed_image_matches_checkout_skips_when_unreadable

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
