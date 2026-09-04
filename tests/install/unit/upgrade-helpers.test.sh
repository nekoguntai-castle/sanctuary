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
source "$PROJECT_ROOT/tests/install/utils/upgrade-wallet-sync-retirement-helpers.sh"
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

test_cleanup_restore_preserves_tracked_executable_mode() {
  local checkout="$TEST_TMP_DIR/cleanup-restore-checkout"
  local status

  git init -q "$checkout" || return 1
  git -C "$checkout" config user.name "Upgrade Cleanup Test" || return 1
  git -C "$checkout" config user.email "upgrade-cleanup@example.invalid" || return 1
  printf 'services:\n  backend: {}\n' > "$checkout/docker-compose.yml"
  chmod 755 "$checkout/docker-compose.yml"
  git -C "$checkout" add docker-compose.yml || return 1
  git -C "$checkout" commit -qm "fixture" || return 1

  printf 'services:\n  frontend: {}\n' > "$checkout/docker-compose.yml"
  chmod 644 "$checkout/docker-compose.yml"
  restore_tracked_worktree_file_for_cleanup "$checkout" docker-compose.yml || return 1

  status="$(git -C "$checkout" status --porcelain=v2 --untracked-files=all)" || return 1
  assert_equals "" "$status" \
    "cleanup restore should preserve tracked contents and executable mode"
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
  UPGRADE_ENABLE_MCP="no"
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
  MCP_PORT=""
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
  assert_equals "yes" "$UPGRADE_ENABLE_MCP" "optional fixture should enable MCP"
  assert_equals "19400" "$GRAFANA_PORT" "optional fixture should isolate Grafana host port"
  assert_equals "19401" "$PROMETHEUS_PORT" "optional fixture should isolate Prometheus host port"
  assert_equals "19402" "$ALERTMANAGER_PORT" "optional fixture should isolate Alertmanager host port"
  assert_equals "19403" "$JAEGER_UI_PORT" "optional fixture should isolate Jaeger UI host port"
  assert_equals "19404" "$LOKI_PORT" "optional fixture should isolate Loki host port"
  assert_equals "19405" "$JAEGER_OTLP_GRPC_PORT" "optional fixture should isolate Jaeger gRPC host port"
  assert_equals "19406" "$JAEGER_OTLP_HTTP_PORT" "optional fixture should isolate Jaeger HTTP host port"
  assert_equals "19407" "$MCP_PORT" "optional fixture should isolate MCP host port"
  assert_equals "upgrade-fixture-unit-grafana" "$GRAFANA_CONTAINER_NAME" "optional fixture should isolate Grafana container name"
  assert_equals "upgrade-fixture-unit-prometheus" "$PROMETHEUS_CONTAINER_NAME" "optional fixture should isolate Prometheus container name"
  assert_equals "upgrade-fixture-unit-tor" "$TOR_CONTAINER_NAME" "optional fixture should isolate Tor container name"

  validate_upgrade_fixture "wallet-sync-retirement"
  apply_upgrade_fixture_defaults "wallet-sync-retirement"
  assert_equals "false" "$UPGRADE_SEED_APP_STATE" "retirement fixture should isolate exact empty-network readiness"
  assert_equals "false" "$UPGRADE_RUN_BROWSER_SMOKE" "retirement fixture should skip unrelated browser smoke"
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
  MCP_PORT=""

  apply_upgrade_fixture_defaults "optional-profiles"

  local result=0
  assert_equals "23130" "$GRAFANA_PORT" "optional fixture should derive Grafana port from HTTPS scope" || result=1
  assert_equals "23131" "$PROMETHEUS_PORT" "optional fixture should derive Prometheus port from HTTPS scope" || result=1
  assert_equals "23132" "$ALERTMANAGER_PORT" "optional fixture should derive Alertmanager port from HTTPS scope" || result=1
  assert_equals "23133" "$JAEGER_UI_PORT" "optional fixture should derive Jaeger UI port from HTTPS scope" || result=1
  assert_equals "23134" "$LOKI_PORT" "optional fixture should derive Loki port from HTTPS scope" || result=1
  assert_equals "23135" "$JAEGER_OTLP_GRPC_PORT" "optional fixture should derive Jaeger gRPC port from HTTPS scope" || result=1
  assert_equals "23136" "$JAEGER_OTLP_HTTP_PORT" "optional fixture should derive Jaeger HTTP port from HTTPS scope" || result=1
  assert_equals "23137" "$MCP_PORT" "optional fixture should derive MCP port from HTTPS scope" || result=1

  HTTPS_PORT=""
  UPGRADE_OPTIONAL_PROFILE_PORT_BASE=""
  return "$result"
}

test_optional_profiles_is_in_release_coverage() {
  local install_contents
  local upgrade_contents
  local extended_fixtures
  local failures=0

  install_contents="$(cat "$PROJECT_ROOT/.github/workflows/install-test.yml")"
  upgrade_contents="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"
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
  assert_contains "$upgrade_contents" 'export COMPOSE_PROFILES=mcp' \
    "optional upgrade should activate MCP on the legacy source checkout" || failures=1
  assert_contains "$upgrade_contents" 'checkout_supports_mcp_preference "$project_dir"' \
    "optional upgrade should detect whether the source installer supports MCP preferences" || failures=1
  assert_contains "$upgrade_contents" 'export ENABLE_MCP=yes' \
    "MCP-aware source installers should receive the explicit MCP preference" || failures=1
  assert_contains "$upgrade_contents" 'unset COMPOSE_PROFILES' \
    "optional upgrade should not force MCP on the target checkout" || failures=1
  assert_contains "$upgrade_contents" 'persist_source_mcp_preference || return 1' \
    "optional upgrade should record the source MCP preference in the runtime env" || failures=1
  assert_contains "$upgrade_contents" 'unset ENABLE_MCP' \
    "optional upgrade should prove target preference recovery without inherited MCP state" || failures=1
  assert_contains "$upgrade_contents" 'verify_mcp_profile_container "$PROJECT_ROOT" || return 1' \
    "optional upgrade should verify MCP health on both sides of the upgrade" || failures=1
  assert_contains "$upgrade_contents" $'export COMPOSE_PROFILES=mcp\n            run_project_compose "$PROJECT_ROOT" stop' \
    "optional upgrade should stop the complete source profile stack" || failures=1
  assert_contains "$extended_fixtures" 'wallet-sync-retirement 33' \
    "install extended upgrades should include wallet-sync retirement once" || failures=1

  return "$failures"
}

test_active_extended_fixture_selection_contract() {
  local expected_records
  local expected_csv
  local runner_records
  local runner_contents
  local failures=0

  expected_records=$'browser-origin-ip 21\nlegacy-runtime-env 24\nnotification-delivery 27\noptional-profiles 30\nwallet-sync-retirement 33'
  expected_csv='browser-origin-ip,legacy-runtime-env,notification-delivery,optional-profiles,wallet-sync-retirement'
  runner_records="$("$PROJECT_ROOT/scripts/ci/run-extended-upgrade-fixtures.sh" --list)"
  runner_contents="$(cat "$PROJECT_ROOT/scripts/ci/run-extended-upgrade-fixtures.sh")"

  assert_equals "$expected_records" "$(upgrade_active_extended_fixture_records)" \
    "active extended fixture registry should be stable" || failures=1
  assert_equals "$expected_csv" "$(upgrade_active_extended_fixtures_csv)" \
    "active extended fixture CSV should be stable" || failures=1
  assert_equals "$expected_records" "$runner_records" \
    "extended fixture runner should use the shared registry" || failures=1
  assert_contains "$runner_contents" 'ownership_initialize_build_identity' \
    "extended fixture parent should initialize strict Compose identity for failure diagnostics" || failures=1
  assert_equals "24" "$(upgrade_extended_fixture_port_offset legacy-runtime-env)" \
    "fixture port offsets should be table lookups, not selected-list positions" || failures=1
  assert_equals "33" "$(upgrade_extended_fixture_port_offset wallet-sync-retirement)" \
    "retirement fixture should retain its dedicated port offset" || failures=1
  assert_equals "v0.8.66" "$(upgrade_extended_fixture_source_ref wallet-sync-retirement latest-stable)" \
    "retirement fixture should remain pinned to the exact legacy source" || failures=1
  assert_equals "release/v0.8.39" "$(upgrade_extended_fixture_source_ref optional-profiles release/v0.8.39)" \
    "other fixtures should retain the selected shared source" || failures=1

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

  if validate_upgrade_fixture "wallet-sync-retirement,notification-delivery" >/dev/null 2>&1; then
    echo -e "${RED}ASSERTION FAILED:${NC} retirement fixture composition should be rejected"
    failures=1
  fi

  return "$failures"
}

test_release_force_rebuild_selection_is_exact() {
  upgrade_should_verify_force_rebuild true latest-stable false \
    || return 1

  if upgrade_should_verify_force_rebuild false latest-stable false; then
    echo -e "${RED}ASSERTION FAILED:${NC} pull request/main/manual paths must not schedule a force rebuild"
    return 1
  fi
  if upgrade_should_verify_force_rebuild true n-2 false; then
    echo -e "${RED}ASSERTION FAILED:${NC} n-2 must not schedule a force rebuild"
    return 1
  fi
  if upgrade_should_verify_force_rebuild true latest-stable true; then
    echo -e "${RED}ASSERTION FAILED:${NC} only the first latest-stable selector may rebuild"
    return 1
  fi
}

test_upgrade_harness_force_rebuild_contract() {
  local contents
  contents="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"

  assert_contains "$contents" '--verify-force-rebuild)' \
    "upgrade harness should parse the release rebuild flag" || return 1
  assert_contains "$contents" '[ "$UPGRADE_TEST_MODE" != "core" ]' \
    "release rebuild flag should be core-mode only" || return 1
  assert_contains "$contents" 'run_test "Release-Critical Force Rebuild Gate" test_release_force_rebuild_gate' \
    "core release verification should execute the real rebuild" || return 1
  assert_contains "$contents" 'if ! test_volume_data_persistence; then' \
    "core release verification should prove post-rebuild persistence" || return 1
  assert_contains "$contents" 'test_verify_mcp_disabled_after_rebuild' \
    "release rebuild should positively prove MCP remains disabled" || return 1
  assert_contains "$contents" 'write_force_rebuild_result "failed" "migration_incomplete"' \
    "release rebuild migration failure should be blocking and recorded" || return 1
  assert_contains "$contents" 'healthy_migrated_authenticated_mcp_disabled_data_persisted' \
    "release rebuild success artifact should cover the complete gate" || return 1
  assert_contains "$contents" '[ $TESTS_FAILED -gt 0 ] || [ "$VERIFY_FORCE_REBUILD" = "true" ]' \
    "successful release rebuilds should retain artifacts" || return 1
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
  assert_contains "$contents" "- optional-profiles: port offset 30; source ref v0.8.39" \
    "manifest should include active fixture registry metadata" || failures=1
  assert_contains "$contents" "- wallet-sync-retirement: port offset 33; source ref v0.8.66" \
    "manifest should record the pinned retirement source" || failures=1

  git -C "$repo" tag v0.8.66
  upgrade_write_selection_manifest \
    "$repo" \
    "$artifact_dir/wallet-only" \
    "" \
    "wallet-sync-retirement" \
    "latest-stable" \
    "12346"
  contents="$(cat "$artifact_dir/wallet-only/selection-manifest.md")"
  assert_contains "$contents" "- Default extended source ref: latest-stable" \
    "manifest should label the shared source as a default, not the effective source" || failures=1
  assert_contains "$contents" '### wallet-sync-retirement' \
    "manifest should identify the selected pinned fixture" || failures=1
  assert_contains "$contents" '- effective source ref: `v0.8.66`' \
    "manifest should record the wallet fixture effective source" || failures=1
  assert_contains "$contents" 'selector: `v0.8.66`' \
    "manifest should resolve the wallet fixture pin" || failures=1
  assert_not_contains "$contents" '## Extended Source Ref' \
    "manifest should not present the shared default as the selected source" || failures=1

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

test_legacy_mcp_healthcheck_is_normalized_without_tor_overlay() {
  local checkout="$TEST_TMP_DIR/source-mcp-health"
  local compose_file="$checkout/docker-compose.yml"

  mkdir -p "$checkout"
  cat > "$compose_file" <<'EOF'
services:
  mcp:
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:3003/health"]
EOF

  UPGRADE_EXPECT_OPTIONAL_PROFILES="true"
  isolate_legacy_optional_profile_compose "$checkout"
  UPGRADE_EXPECT_OPTIONAL_PROFILES="false"

  local contents
  contents="$(cat "$compose_file")"
  assert_contains "$contents" 'http://127.0.0.1:3003/health' \
    "legacy MCP fixture should use an IPv4 healthcheck"
  assert_not_contains "$contents" 'http://localhost:3003/health' \
    "legacy MCP fixture should not retain the broken localhost probe"
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

test_mcp_healthcheck_uses_ipv4_loopback() {
  local contents
  contents="$(cat "$PROJECT_ROOT/docker-compose.yml")"

  assert_contains "$contents" 'http://127.0.0.1:3003/health' \
    "MCP healthcheck should use IPv4 because the server binds an IPv4 socket"
  assert_not_contains "$contents" 'http://localhost:3003/health' \
    "MCP healthcheck should not depend on localhost IPv6 resolution"
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

test_upgrade_coordinated_mode_defers_legacy_cleanup() {
  local lane="$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh"
  local contents
  contents="$(cat "$lane")"

  assert_contains "$contents" 'SANCTUARY_CLEANUP_COORDINATED:-0' \
    "upgrade lane must recognize receipt-bound coordinated mode" || return 1
  assert_contains "$contents" 'Deferring Docker resource cleanup to the receipt-bound CI coordinator' \
    "coordinated teardown must leave Docker mutation to the coordinator" || return 1
  assert_contains "$contents" 'Builder recovery cannot invoke legacy cleanup during a coordinated run' \
    "coordinated cache retry must not bypass receipt-bound cleanup" || return 1
  assert_contains "$contents" 'baseline Grafana race cannot invoke legacy cleanup during a coordinated run' \
    "coordinated Grafana retry must not bypass receipt-bound cleanup" || return 1
  assert_contains "$contents" '"${SANCTUARY_CLEANUP_COORDINATED:-0}" != "1" ] && [ -d "$TEST_RUNTIME_DIR"' \
    "coordinated teardown must retain the coordinator runtime and recovery state"
}

test_install_host_artifacts_use_exact_registered_cleanup() {
  local upgrade helpers fresh
  upgrade="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"
  helpers="$(cat "$PROJECT_ROOT/tests/install/utils/helpers.sh")"
  fresh="$(cat "$PROJECT_ROOT/tests/install/e2e/fresh-install.test.sh")"

  assert_contains "$upgrade" 'describe-host-authority.mjs" \' \
    "upgrade worktree must derive v1.1 execution authority" || return 1
  assert_contains "$upgrade" 'register_owned_resource git_worktree obsolete exact_delete' \
    "upgrade worktree must register exact retirement authority" || return 1
  assert_not_contains "$upgrade" 'worktree remove --force' \
    "upgrade subject must not bypass the canonical worktree executor" || return 1
  assert_contains "$upgrade" 'status --porcelain=v2 --untracked-files=all' \
    "upgrade worktree must fail closed on unexpected dirt" || return 1
  assert_contains "$helpers" 'register_owned_resource temporary_artifact obsolete exact_delete' \
    "install scratch directories must register exact retirement authority" || return 1
  assert_contains "$helpers" 'temporary "$artifact" "$SANCTUARY_OPERATION_RUN_ID"' \
    "install scratch registration must bind the creator run" || return 1
  assert_not_contains "$fresh" 'rm -rf "$TEST_INSTALL_DIR"' \
    "fresh install teardown must defer registered path cleanup"
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

# With no translation available the helper would need a persistent container.
# It must refuse that mutation unless the signed coordinator owns the lifetime.
test_monitoring_sync_requires_coordinator_when_path_is_untranslated() {
  local src="$TEST_TMP_DIR/proj-refuses"
  local call_log="$TEST_TMP_DIR/monitoring-sync-docker.log"
  local fake_bin="$TEST_TMP_DIR/monitoring-sync-bin"
  local out status
  mkdir -p "$src/docker/monitoring"
  mkdir -p "$fake_bin"
  : > "$src/docker/monitoring/prometheus.yml"
  cat > "$fake_bin/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_CALL_LOG"
exit 99
EOF
  chmod +x "$fake_bin/docker"

  set +e
  out="$(PATH="$fake_bin:$PATH" DOCKER_CALL_LOG="$call_log" \
    SANCTUARY_MONITORING_CONFIG_DIR="$src/docker/monitoring" \
    bash -c 'source "$1"; sync_monitoring_configs_to_daemon "$2"; result=$?; echo "STATUS=$SYNC_MONITORING_STATUS"; exit "$result"' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" "$src" 2>&1)"
  status=$?
  set -e

  assert_equals "1" "$status" "uncoordinated monitoring sync must fail closed" || return 1
  assert_contains "$out" "STATUS=refused: signed cleanup coordinator is required" \
    "monitoring sync should explain the missing authority" || return 1
  [ ! -s "$call_log" ] || {
    echo -e "${RED}ASSERTION FAILED:${NC} uncoordinated monitoring sync invoked Docker"
    cat "$call_log"
    return 1
  }
}

test_monitoring_sync_uses_labeled_immutable_id_when_coordinated() {
  local src="$TEST_TMP_DIR/proj-coordinated"
  local call_log="$TEST_TMP_DIR/monitoring-sync-coordinated.log"
  local exact_id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  mkdir -p "$src/docker/monitoring"
  : > "$src/docker/monitoring/prometheus.yml"

  (
    export SANCTUARY_CLEANUP_COORDINATED=1
    export SANCTUARY_MONITORING_CONFIG_DIR="$src/docker/monitoring"
    export SANCTUARY_OPERATION_RUN_ID=test-run
    ownership_label_args() { OWNERSHIP_LABEL_ARGS=(--label io.sanctuary.test=owned); }
    recover_exact_created_container() { printf '%s\n' "$exact_id"; }
    register_owned_resource() { return 0; }
    docker() {
      printf '%s\n' "$*" >> "$call_log"
      case "$*" in
        create*) printf '%s\n' "$exact_id" ;;
        'container inspect '*) return 1 ;;
        'container ls -a '*) return 0 ;;
      esac
    }
    sync_monitoring_configs_to_daemon "$src"
  ) || return 1

  assert_contains "$(cat "$call_log")" "create --rm --name sanctuary-monitoring-sync-test-run-" \
    "coordinated monitoring helper should use a recoverable exact name" || return 1
  assert_contains "$(cat "$call_log")" "--label io.sanctuary.test=owned" \
    "coordinated monitoring helper should stamp ownership" || return 1
  assert_contains "$(cat "$call_log")" "stop $exact_id" \
    "coordinated monitoring helper should stop the immutable returned ID"
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

test_install_scopes_tor_ingress_config_per_checkout() {
  local lane="$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh"
  local body
  body="$(awk '/^run_install_script\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$lane")"

  if ! printf '%s\n' "$body" | grep -q 'SANCTUARY_TOR_INGRESS_CONFIG'; then
    echo -e "${RED}ASSERTION FAILED:${NC} run_install_script must scope SANCTUARY_TOR_INGRESS_CONFIG to the checkout it installs"
    return 1
  fi
  if ! printf '%s\n' "$body" | grep -q 'tor_ingress_config_for_compose "$project_dir"'; then
    echo -e "${RED}ASSERTION FAILED:${NC} the scoped Tor value must be derived from the checkout being installed"
    return 1
  fi
  return 0
}

test_tor_ingress_config_maps_workspace_volume() {
  local fake_bin="$TEST_TMP_DIR/tor-bin"
  local checkout="$TEST_TMP_DIR/source/repo"
  local daemon_checkout="/var/lib/docker/volumes/workspace/_data/source/repo"
  mkdir -p "$fake_bin" "$TEST_TMP_DIR/source/repo/docker/tor"
  : > "$TEST_TMP_DIR/source/repo/docker/tor/payjoin-ingress.conf"
  cat > "$fake_bin/docker" <<'EOF'
#!/bin/sh
if [ "$1" = "inspect" ]; then
  printf '%s\t%s\n' "REPLACE_SOURCE" "REPLACE_DESTINATION"
  exit 0
fi
exit 1
EOF
  sed -i "s|REPLACE_SOURCE|$daemon_checkout|; s|REPLACE_DESTINATION|$checkout|" "$fake_bin/docker"
  chmod +x "$fake_bin/docker"

  local mapped
  mapped="$(HOSTNAME="test-container" PATH="$fake_bin:$PATH" \
    bash -c 'source "$1"; tor_ingress_config_for_compose "$2"' _ \
    "$PROJECT_ROOT/tests/install/utils/helpers.sh" "$checkout")"

  assert_equals "$daemon_checkout/docker/tor/payjoin-ingress.conf" "$mapped" \
    "Tor ingress config should map to the daemon-visible source file"
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
  assert_not_contains "$contents" 'docker builder prune' \
    "upgrade cache recovery must preserve the shared builder cache"
  assert_contains "$contents" 'install.sh exited successfully after BuildKit cache corruption; retrying source install' \
    "upgrade harness should retry legacy source installs that hide BuildKit failures behind a zero exit"
  assert_contains "$contents" 'run_install_script_attempt "$project_dir" "$install_log" true' \
    "upgrade harness should retry source install once after builder-cache recovery"
  assert_contains "$contents" 'emit_upgrade_phase_timing "$test_name" "$exit_code"' \
    "upgrade harness should time each run_test phase" || return 1
  assert_contains "$contents" 'message="upgrade phase ${test_name} mode=${UPGRADE_TEST_MODE} fixture=${UPGRADE_FIXTURE} completed in ${minutes}m ${seconds}s (${duration}s)"' \
    "upgrade phase timing should end in the live-forwarding grammar" || return 1
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
  local subject_contents
  local checkout_count
  local clean_false_count
  contents="$(cat "$PROJECT_ROOT/.github/workflows/install-test.yml")"
  subject_contents="$(cat "$PROJECT_ROOT/scripts/ci/run-compose-e2e-subject.sh")"

  assert_contains "$contents" 'SANCTUARY_RUNNER_LOCK_DIR: ${{ github.workspace }}/.tmp/runner-locks-v2' \
    "install workflow should keep inner runner locks under the checked-out workspace"
  assert_contains "$contents" 'scripts/ci/run-compose-e2e-subject.sh' \
    "install workflow should delegate reusable stack setup to the supervised subject" || return 1
  assert_contains "$subject_contents" 'SANCTUARY_SSL_DIR="$(default_install_test_root "$PWD")/ssl-${COMPOSE_PROJECT_NAME}"' \
    "supervised subject should generate SSL material under the run-scoped install-test root"
  assert_not_contains "$subject_contents" 'SANCTUARY_SSL_DIR="$PWD/docker/nginx/ssl"' \
    "supervised subject should not write generated SSL material into a fixed repo path"

  checkout_count="$(grep -c 'uses: actions/checkout' <<< "$contents")"
  clean_false_count="$(grep -c 'clean: false' <<< "$contents")"
  assert_equals "$checkout_count" "$clean_false_count" \
    "install workflow checkout steps should not pre-clean shared runner workspaces"
}

test_compose_subject_binds_project_root_before_ownership_init() {
  # v0.8.70-rc2 (run 14662): Install Stack Smoke died in 6 s with
  # "Current checkout ownership producer hook is unavailable" because the
  # supervised Compose subject called initialize_install_test_ownership without
  # PROJECT_ROOT; the initializer resolves the producer hook from it.
  local subject="$PROJECT_ROOT/scripts/ci/run-compose-e2e-subject.sh" bind_line init_line
  bind_line="$(grep -n '^PROJECT_ROOT="$PWD"$' "$subject" | head -n1 | cut -d: -f1)"
  init_line="$(grep -n '^initialize_install_test_ownership$' "$subject" | head -n1 | cut -d: -f1)"
  if [ -z "$bind_line" ] || [ -z "$init_line" ] || [ "$bind_line" -ge "$init_line" ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} compose subject must bind PROJECT_ROOT to the workspace before initializing ownership (bind=${bind_line:-none}, init=${init_line:-none})"
    return 1
  fi
  assert_contains "$(grep -n '^export PROJECT_ROOT$' "$subject" || true)" 'export PROJECT_ROOT' \
    "compose subject must export PROJECT_ROOT for the producer hooks it sources"

  # The initializer must name the root it could not use.
  local output
  if output="$(cd "$TEST_TMP_DIR" && PROJECT_ROOT= TARGET_PROJECT_ROOT= bash -c 'source "$1"; initialize_install_test_ownership' _ \
      "$PROJECT_ROOT/tests/install/utils/helpers.sh" 2>&1)"; then
    echo -e "${RED}ASSERTION FAILED:${NC} ownership initialization must refuse an unset project root"
    return 1
  fi
  assert_contains "$output" "unset" "refusal must say the project root is unset"
}

test_upgrade_ssl_dir_keeps_coordinator_runtime_off_docker_mounts() {
  local harness_contents
  local selected

  harness_contents="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"
  assert_contains "$harness_contents" \
    'TEST_SSL_DIR="$(upgrade_test_ssl_dir "$TEST_RUNTIME_DIR" "$TEST_ROOT" "$COMPOSE_PROJECT_NAME")"' \
    "upgrade harness should select TLS storage independently from coordinator state" || return 1
  assert_not_contains "$harness_contents" \
    'TEST_SSL_DIR="${SANCTUARY_SSL_DIR:-$TEST_RUNTIME_DIR/ssl}"' \
    "upgrade harness should not bind-mount coordinator-private runtime paths" || return 1

  selected="$({
    SANCTUARY_CLEANUP_COORDINATED=1
    unset SANCTUARY_SSL_DIR
    upgrade_test_ssl_dir \
      /tmp/sanctuary-cleanup/14102-1/upgrade-15 \
      /workspace/sanctuary/.tmp/install-tests-14102-1001 \
      ci-14102-1-upgrade-15
  })" || return 1
  assert_equals \
    "/workspace/sanctuary/.tmp/install-tests-14102-1001/ssl-ci-14102-1-upgrade-15" \
    "$selected" \
    "coordinated upgrades should keep generated TLS under the Docker-visible install root" || return 1

  selected="$({
    SANCTUARY_CLEANUP_COORDINATED=1
    SANCTUARY_SSL_DIR=/explicit/ssl
    upgrade_test_ssl_dir /cleanup/runtime /workspace/install ci-project
  })" || return 1
  assert_equals "/explicit/ssl" "$selected" \
    "an explicit upgrade TLS directory should remain authoritative" || return 1

  selected="$({
    unset SANCTUARY_CLEANUP_COORDINATED SANCTUARY_SSL_DIR
    upgrade_test_ssl_dir /ordinary/runtime /workspace/install ci-project
  })" || return 1
  assert_equals "/ordinary/runtime/ssl" "$selected" \
    "uncoordinated upgrades should retain their existing runtime-local TLS directory"
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

# The wallet sync-state migration parses a retry count out of legacy free text
# and backfills a bounded failure taxonomy. Losing this wiring would leave that
# data migration unproven while the suite still reported green.
test_upgrade_harness_covers_wallet_sync_state_migration() {
  local contents
  local failures=0

  contents="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"

  assert_contains "$contents" 'source "$SCRIPT_DIR/../utils/upgrade-wallet-sync-state-helpers.sh"' \
    "upgrade harness should load wallet sync state fixtures" || failures=1
  assert_contains "$contents" 'run_test "Seed Wallet Sync State Fixture" test_seed_wallet_sync_state_fixture' \
    "upgrade suite should seed legacy wallet sync state before the upgrade" || failures=1
  assert_contains "$contents" 'run_test "Verify Wallet Sync State Migration" test_verify_wallet_sync_state_migration' \
    "upgrade suite should verify wallet sync state after the upgrade" || failures=1

  local helper_contents
  helper_contents="$(cat "$PROJECT_ROOT/tests/install/utils/upgrade-wallet-sync-state-helpers.sh")"

  assert_contains "$helper_contents" "electrum_unavailable" \
    "fixture should assert the recovered failure class" || failures=1
  assert_contains "$helper_contents" "legacy failure text was not classified" \
    "fixture should assert the taxonomy backfill on a settled failure" || failures=1
  assert_contains "$helper_contents" "sourceHasStructuredSyncState" \
    "fixture should distinguish an already-migrated source from a legacy source" || failures=1
  assert_contains "$helper_contents" "sourceStructuredSyncState" \
    "fixture should carry the detected source schema mode into verification" || failures=1
  assert_contains "$helper_contents" 'table_schema = ${PUBLIC_SCHEMA}' \
    "fixture should parameterize schema detection inside the shell-quoted Node script" || failures=1
  assert_contains "$helper_contents" 'THEN ${FAILED_CLASS}' \
    "fixture should parameterize structured failure classes inside the shell-quoted Node script" || failures=1
  assert_contains "$helper_contents" 'THEN ${INLINE_OWNER}' \
    "fixture should parameterize structured execution owners inside the shell-quoted Node script" || failures=1
  assert_contains "$helper_contents" "Structured wallet sync state preserved across upgrade" \
    "fixture should report preservation instead of claiming a rerun migration" || failures=1
  # demoteStrandedInlineRetries() clears the migration's recovered retry position
  # on the first boot, so the handoff is what an upgrade can actually observe.
  assert_contains "$helper_contents" "stranded retry was never reconciled" \
    "fixture should assert the migrate-then-reconcile handoff" || failures=1
  assert_contains "$helper_contents" "expected exactly one reconciliation over the migrated default" \
    "fixture should pin the reconciliation to exactly one step over the migrated default" || failures=1
  assert_contains "$helper_contents" "bounds constraint accepted an out-of-taxonomy value" \
    "fixture should assert the migration CHECK constraints are live" || failures=1
  # The pin keeps the post-upgrade stale sweep off the fixture rows. Without it
  # the sweep rewrites the very columns the fixture reads, so a silent removal
  # would turn this coverage back into the race it was written to remove.
  assert_contains "$helper_contents" "QUIESCENT_UNTIL" \
    "fixture should pin its rows past the stale-sweep window" || failures=1
  assert_contains "$helper_contents" "was synced after the upgrade" \
    "fixture should fail loudly if the stale-sweep pin ever stops holding" || failures=1

  return "$failures"
}

test_upgrade_harness_covers_wallet_sync_retirement() {
  local contents helper_contents verify_body
  local prove_line stop_line activate_line readiness_line start_line
  local legacy_root="$TEST_TMP_DIR/legacy"
  local floor_root="$TEST_TMP_DIR/floor"
  local failures=0

  mkdir -p "$legacy_root/server/src/repositories" "$floor_root/server/src/repositories"
  printf '%s\n' 'export const unrelated = true;' \
    > "$legacy_root/server/src/repositories/walletSyncSchedulePolicyRepository.ts"
  printf '%s\n' 'export const WALLET_SYNC_SCHEDULE_COMPATIBILITY_FLOOR = 2 as const;' \
    > "$floor_root/server/src/repositories/walletSyncSchedulePolicyRepository.ts"

  if wallet_sync_source_supports_retirement_floor "$legacy_root"; then
    echo -e "${RED}ASSERTION FAILED:${NC} legacy source must remain below the retirement floor"
    failures=1
  fi
  wallet_sync_source_supports_retirement_floor "$floor_root" || failures=1

  contents="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"
  helper_contents="$(cat "$PROJECT_ROOT/tests/install/utils/upgrade-wallet-sync-retirement-helpers.sh")"
  assert_contains "$contents" 'source "$SCRIPT_DIR/../utils/upgrade-wallet-sync-retirement-helpers.sh"' \
    "upgrade harness should load the scheduler-retirement fixture" || failures=1
  assert_contains "$contents" 'run_test "Verify Wallet Sync Scheduler Retirement" test_verify_wallet_sync_retirement_upgrade' \
    "upgrade suite should execute the retirement proof" || failures=1
  assert_contains "$contents" 'Skipping generic recurring-staleness aging; baseline lanes own that proof' \
    "retirement fixture should not depend on an unrelated webhook completion" || failures=1
  assert_contains "$helper_contents" 'sync:check-stale-wallets' \
    "retirement fixture should seed and inspect the legacy scheduler" || failures=1
  assert_contains "$helper_contents" 'Number(sourceScheduler.every) !== 5 * 60 * 1000' \
    "retirement fixture should retain and verify the exact v0.8.66 cadence" || failures=1
  assert_contains "$helper_contents" 'WALLET_SYNC_RETIREMENT_SOURCE_WORKER_IMAGE=' \
    "retirement fixture should capture the exact below-floor image" || failures=1
  assert_contains "$helper_contents" 'prove_below_floor_rollback_is_unsupported' \
    "retirement fixture should execute the post-marker rollback-floor proof" || failures=1
  assert_contains "$helper_contents" 'Executable rollback-floor proof reproduced the forbidden v0.8.66 scheduler' \
    "retirement fixture should require below-floor incompatibility evidence" || failures=1
  assert_contains "$helper_contents" 'rollback_env="$TEST_RUNTIME_DIR/wallet-sync-retirement-rollback.env"' \
    "rollback proof secrets should stay inside harness-owned runtime cleanup" || failures=1
  assert_contains "$helper_contents" 'ownership_label_args compose_container exact_delete' \
    "coordinated rollback proof container must carry the cleanup ownership tuple" || failures=1
  assert_contains "$helper_contents" 'docker create --rm' \
    "rollback proof should create a recoverable coordinator-owned transient container" || failures=1
  assert_contains "$helper_contents" 'resolve_registered_created_container' \
    "rollback proof should register the exact created tuple before start" || failures=1
  assert_contains "$helper_contents" 'retire_install_container "$rollback_container_id" stop' \
    "rollback proof should reconcile retirement of the immutable returned container ID" || failures=1
  assert_contains "$helper_contents" 'install -m 600 /dev/null "$rollback_env"' \
    "rollback proof should create its secret file securely before populating it" || failures=1
  assert_contains "$helper_contents" 'reason: "manual"' \
    "retirement fixture should preserve manual work" || failures=1
  assert_contains "$helper_contents" 'reason: "address_activity"' \
    "retirement fixture should preserve activity work" || failures=1
  assert_contains "$helper_contents" 'wait_for_wallet_sync_retirement_marker 180' \
    "retirement fixture should wait for production cutover" || failures=1
  assert_contains "$helper_contents" 'sourceHeartbeatMemberId=' \
    "retirement fixture should capture the exact below-floor source member" || failures=1
  assert_contains "$helper_contents" 'sourceHeartbeatSnapshotBase64=' \
    "retirement fixture should preserve the exact legacy heartbeat payload" || failures=1
  assert_contains "$helper_contents" 'readiness.reason !== "worker_below_floor"' \
    "retirement fixture should prove the legacy capability floor blocks readiness" || failures=1
  assert_not_contains "$helper_contents" '["incomplete_fleet", "worker_below_floor"]' \
    "retirement fixture must not accept missing-heartbeat evidence as a floor proof" || failures=1
  assert_contains "$helper_contents" 'zrem(registryKey, sourceMemberId)' \
    "retirement fixture should fast-forward only the captured source member retention" || failures=1
  assert_contains "$helper_contents" 'LOCK TABLE "network_header_checkpoints"' \
    "retirement fixture should isolate its header-readiness fast-forward" || failures=1
  assert_contains "$helper_contents" 'lastProcessedHeight: pending' \
    "retirement fixture should promote the latest exact observed header target" || failures=1
  assert_contains "$helper_contents" 'reconciliation.pendingTargetHeight' \
    "retirement fixture should not discard a newer pending header observation" || failures=1
  assert_contains "$helper_contents" 'scheduler retirement readiness fixture remained' \
    "retirement fixture should require the production readiness projection" || failures=1
  verify_body="$(awk '/^verify_wallet_sync_retirement_upgrade\(\) \{/{found=1} found{print} found&&/^\}/{exit}' \
    "$PROJECT_ROOT/tests/install/utils/upgrade-wallet-sync-retirement-helpers.sh")"
  prove_line="$(printf '%s\n' "$verify_body" | grep -n -m1 'prove_wallet_sync_retirement_floor_fixture || return 1' | cut -d: -f1)"
  stop_line="$(printf '%s\n' "$verify_body" | grep -n -m1 'stop worker' | cut -d: -f1)"
  activate_line="$(printf '%s\n' "$verify_body" | grep -n -m1 'activate_wallet_sync_retirement_fixture || return 1' | cut -d: -f1)"
  readiness_line="$(printf '%s\n' "$verify_body" | grep -n -m1 'establish_wallet_sync_retirement_readiness_fixture || return 1' | cut -d: -f1)"
  start_line="$(printf '%s\n' "$verify_body" | grep -n -m1 'start worker' | cut -d: -f1)"
  if [ -z "$prove_line" ] || [ -z "$stop_line" ] || [ -z "$activate_line" ] \
    || [ -z "$readiness_line" ] || [ -z "$start_line" ] \
    || [ "$prove_line" -ge "$stop_line" ] || [ "$stop_line" -ge "$activate_line" ] \
    || [ "$activate_line" -ge "$readiness_line" ] || [ "$readiness_line" -ge "$start_line" ]; then
    echo -e "${RED}ASSERTION FAILED:${NC} retirement fixture must prove the floor, stop the worker, activate, establish readiness, then restart"
    failures=1
  fi
  assert_contains "$helper_contents" 'restart worker' \
    "retirement fixture should prove repeated startup at the floor" || failures=1

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

test_prepare_install_root_refuses_symlink_before_mutating_target() {
  local parent="$TEST_TMP_DIR/install-root-parent" target="$TEST_TMP_DIR/shared-target" link
  mkdir -m 700 "$parent"
  mkdir -m 755 "$target"
  link="$parent/link"
  ln -s "$target" "$link"

  if bash -c 'source "$1"; prepare_install_test_root "$2"' _ \
      "$PROJECT_ROOT/tests/install/utils/helpers.sh" "$link" >/dev/null 2>&1; then
    echo -e "${RED}ASSERTION FAILED:${NC} symlink install root should be refused"
    return 1
  fi
  assert_equals "755" "$(stat -c '%a' "$target")" \
    "symlink target permissions must remain unchanged"
}

test_prepare_install_root_refuses_broad_existing_root() {
  local broad="$TEST_TMP_DIR/broad-home"
  mkdir -m 700 "$broad"
  if HOME="$broad" bash -c 'source "$1"; prepare_install_test_root "$2"' _ \
      "$PROJECT_ROOT/tests/install/utils/helpers.sh" "$broad" >/dev/null 2>&1; then
    echo -e "${RED}ASSERTION FAILED:${NC} home directory install root should be refused"
    return 1
  fi
}

test_prepare_install_root_names_the_broad_parent_it_refuses() {
  # v0.8.70-rc1 (run 14651): the RC fresh-install job created $GITHUB_WORKSPACE/.tmp
  # with mode 755, prepare_install_test_root returned 1 without a word, and the
  # lane died in 6 s with an empty log. Refusals must say which path failed.
  local workspace="$TEST_TMP_DIR/broad-parent-workspace" output
  mkdir -m 700 "$workspace"
  mkdir -m 755 "$workspace/.tmp"
  if output="$(bash -c 'source "$1"; prepare_install_test_root "$2"' _       "$PROJECT_ROOT/tests/install/utils/helpers.sh" "$workspace/.tmp/install-tests-1-2" 2>&1)"; then
    echo -e "${RED}ASSERTION FAILED:${NC} a 755 parent must be refused"
    return 1
  fi
  assert_contains "$output" "$workspace/.tmp" \
    "refusal must name the parent directory that is not owner-only"
  assert_contains "$output" "700" \
    "refusal must state the required owner-only mode"
}

test_prepare_install_root_uses_coordinated_private_runtime_for_tmp() {
  local runtime="$TEST_TMP_DIR/runtime-authority" root
  mkdir -m 700 "$runtime"
  root="$(SANCTUARY_RUNTIME_DIR="$runtime" GITHUB_RUN_ID=2468 \
    bash -c 'source "$1"; prepare_install_test_root /tmp' _ \
      "$PROJECT_ROOT/tests/install/utils/helpers.sh")"
  assert_equals "$runtime/install-test-roots/install-tests-2468-$(id -u)" "$root" \
    "shared tmp should map beneath the coordinated runtime"
  assert_equals "700" "$(stat -c '%a' "$root")" \
    "mapped install root should be owner-only"
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

test_legacy_prefix_cleanup_refuses_mutation() {
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

  assert_equals "" "$calls" \
    "retired prefix cleanup must not query or mutate Docker without signed exact authority"
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

test_upgrade_harness_covers_backend_address_replacement() {
  local lane assertions
  lane="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"
  assertions="$(cat "$PROJECT_ROOT/tests/install/utils/upgrade-assertions.sh")"

  assert_contains "$lane" 'run_test "Frontend Proxy Survives Backend Recreate"' \
    "upgrade lane should dispatch the backend replacement regression" || return 1
  assert_contains "$lane" 'fixture_list_contains "$UPGRADE_FIXTURE" "baseline"' \
    "PR baseline upgrades should execute the real backend replacement regression" || return 1
  assert_contains "$assertions" 'register_coordinated_container "$backend_container" "$backend_id"' \
    "regression should register the exact backend before replacement" || return 1
  assert_contains "$assertions" 'remove_coordinated_container "$backend_id"' \
    "regression should replace only the immutable backend container ID" || return 1
  assert_contains "$assertions" '--ip "$old_ip"' \
    "regression should prevent reuse of the old backend address" || return 1
  assert_contains "$assertions" 'com.docker.compose.project=$COMPOSE_PROJECT_NAME' \
    "holder should retain its exact Compose project selector" || return 1
  assert_contains "$assertions" 'ownership_label_args compose_container exact_delete' \
    "coordinated holder must carry the full cleanup ownership tuple" || return 1
  assert_contains "$assertions" 'docker create --rm --name "$holder_container"' \
    "holder should use a recoverable named create lifecycle" || return 1
  assert_contains "$assertions" 'resolve_registered_created_container' \
    "coordinated holder must be signed before later mutation" || return 1
  assert_contains "$assertions" 'remove_coordinated_container "$FRONTEND_PROXY_HOLDER_ID"' \
    "coordinated holder teardown should prove exact-ID absence" || return 1
  assert_contains "$assertions" 'resolve_frontend_backend_network' \
    "regression should select the one network shared with the frontend" || return 1
  assert_contains "$assertions" 'assert_authenticated_websocket_handshake' \
    "regression should verify WebSocket recovery" || return 1
  assert_contains "$assertions" 'Frontend was recreated during backend-only replacement' \
    "regression should require the frontend container to stay unchanged" || return 1
  assert_contains "$assertions" 'Could not restore the backend after the replacement regression' \
    "regression cleanup should fail closed if backend restoration fails"
}

test_coordinated_container_removal_reconciles_lost_response() (
  docker() {
    case "$*" in
      'rm -f exact-container') return 17 ;;
      'container inspect exact-container') return 1 ;;
      'container ls -a --no-trunc --filter id=exact-container --format {{.ID}}') return 0 ;;
      *) return 99 ;;
    esac
  }
  remove_coordinated_container exact-container
)

test_coordinated_container_removal_refuses_ambiguous_postcondition() (
  docker() {
    case "$*" in
      'rm -f exact-container') return 17 ;;
      'container inspect exact-container') return 1 ;;
      'container ls -a --no-trunc --filter id=exact-container --format {{.ID}}') return 19 ;;
      *) return 99 ;;
    esac
  }
  ! remove_coordinated_container exact-container
)

test_created_container_response_loss_preserves_status_after_registration() (
  local exact_id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local output status
  export SANCTUARY_OPERATION_RUN_ID=test-run
  recover_exact_created_container() { printf '%s\n' "$exact_id"; }
  register_owned_resource() { return 0; }
  set +e
  output="$(resolve_registered_created_container helper-name '' 23)"
  status=$?
  set -e
  assert_equals "$exact_id" "$output" "response-loss recovery should expose only the proven immutable ID" || return 1
  assert_equals "23" "$status" "response-loss recovery must preserve the original create status"
)

test_created_container_rejects_foreign_success_id() (
  local exact_id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local foreign_id="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  export SANCTUARY_OPERATION_RUN_ID=test-run
  recover_exact_created_container() { printf '%s\n' "$exact_id"; }
  register_owned_resource() { return 0; }
  ! resolve_registered_created_container helper-name "$foreign_id" 0 >/dev/null
)

test_registered_container_start_preserves_failure_status() (
  local call_log="$TEST_TMP_DIR/registered-start.log"
  local status
  docker() {
    printf 'docker:%s\n' "$*" >> "$call_log"
    [ "$*" != 'start exact-container' ] || return 23
  }
  retire_install_container() {
    printf 'retire:%s\n' "$*" >> "$call_log"
    return 0
  }

  set +e
  start_registered_install_container exact-container
  status=$?
  set -e

  assert_equals "23" "$status" \
    "registered start response loss must preserve the engine status" || return 1
  assert_contains "$(cat "$call_log")" "retire:exact-container stop" \
    "registered start failure must reconcile the exact immutable ID"
)

test_install_container_retirement_refuses_ambiguous_postcondition() (
  docker() {
    case "$*" in
      'stop exact-container') return 17 ;;
      'container inspect exact-container') return 1 ;;
      'container ls -a --no-trunc --filter id=exact-container --format {{.ID}}') return 19 ;;
      *) return 99 ;;
    esac
  }
  ! retire_install_container exact-container stop
)

test_upgrade_harness_exports_operator_runtime_state() {
  local lane
  lane="$(cat "$PROJECT_ROOT/tests/install/e2e/upgrade-install.test.sh")"

  assert_contains "$lane" 'export SANCTUARY_RUNTIME_DIR="$TEST_RUNTIME_DIR"' \
    "upgrade lane should retain the manifest runtime root for operator commands" || return 1
  assert_contains "$lane" 'export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"' \
    "upgrade lane should retain the selected runtime environment for operator commands"
}

test_install_ownership_rebinds_workspace_identity_to_compose_lane() {
  local expected_commit
  expected_commit="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"

  (
    export COMPOSE_PROJECT_NAME=upgrade-lane-project
    export SANCTUARY_PROJECT=workspace-project
    export SANCTUARY_DEPLOYMENT_ID=deploy-workspace-project
    export SANCTUARY_COMMIT="$expected_commit"
    export SANCTUARY_SOURCE_COMMIT="$expected_commit"
    export SANCTUARY_IMAGE_LOCK_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    export SANCTUARY_VERSION=0.8.69
    export SANCTUARY_BUILD_ID=workspace-build
    initialize_install_test_ownership
    assert_equals "upgrade-lane-project" "$SANCTUARY_PROJECT" \
      "the explicit Compose lane must replace a persisted workspace project" || return 1
    assert_equals "deploy-upgrade-lane-project" "$SANCTUARY_DEPLOYMENT_ID" \
      "the deployment identity must follow the rebound Compose project"
  )
}

test_backend_replacement_failure_restores_backend() {
  local call_log="$TEST_TMP_DIR/backend-replacement-cleanup.log"
  local exit_code

  set +e
  (
    COMPOSE_PROJECT_NAME="upgrade-cleanup-test"
    TEST_ID="cleanup-test"
    PROJECT_ROOT="$PROJECT_ROOT"
    HEALTH_CHECK_TIMEOUT=5
    SANCTUARY_CLEANUP_COORDINATED=1

    assert_frontend_proxy_recovers_after_backend_recreate_inner() { return 7; }
    docker() { printf 'docker:%s\n' "$*" >> "$call_log"; }
    run_project_compose() { printf 'compose:%s\n' "$*" >> "$call_log"; }
    get_container_name() { printf 'upgrade-cleanup-test-backend-1\n'; }
    wait_for_container_healthy() { printf 'healthy:%s\n' "$*" >> "$call_log"; }

    assert_frontend_proxy_recovers_after_backend_recreate "https://127.0.0.1:9443"
  )
  exit_code=$?
  set -e

  assert_equals "7" "$exit_code" \
    "backend cleanup should preserve the original replacement failure" || return 1
  assert_contains "$(cat "$call_log")" "compose:$PROJECT_ROOT up -d --no-deps backend" \
    "backend cleanup should always recreate the compose backend" || return 1
  assert_contains "$(cat "$call_log")" "healthy:upgrade-cleanup-test-backend-1 5" \
    "backend cleanup should wait for restored health"
}

test_backend_replacement_rejects_uncoordinated_mutation() {
  local call_log="$TEST_TMP_DIR/backend-replacement-uncoordinated.log"
  local exit_code

  set +e
  (
    unset SANCTUARY_CLEANUP_COORDINATED
    COMPOSE_PROJECT_NAME="upgrade-uncoordinated-test"
    TEST_ID="uncoordinated-test"
    docker() { printf 'docker:%s\n' "$*" >> "$call_log"; }
    run_project_compose() { printf 'compose:%s\n' "$*" >> "$call_log"; }
    assert_frontend_proxy_recovers_after_backend_recreate "https://127.0.0.1:9443"
  )
  exit_code=$?
  set -e

  assert_equals "1" "$exit_code" \
    "backend replacement must reject missing coordinator authority" || return 1
  [ ! -s "$call_log" ] || {
    echo -e "${RED}ASSERTION FAILED:${NC} uncoordinated backend replacement invoked Docker or Compose"
    cat "$call_log"
    return 1
  }
}

test_backend_replacement_producer_rejects_uncoordinated_mutation() {
  local call_log="$TEST_TMP_DIR/backend-replacement-producer-uncoordinated.log"
  local exit_code

  set +e
  (
    unset SANCTUARY_CLEANUP_COORDINATED
    docker() { printf 'docker:%s\n' "$*" >> "$call_log"; }
    run_project_compose() { printf 'compose:%s\n' "$*" >> "$call_log"; }
    assert_frontend_proxy_recovers_after_backend_recreate_inner \
      "https://127.0.0.1:9443" backend-ip-holder
  )
  exit_code=$?
  set -e

  assert_equals "1" "$exit_code" \
    "backend replacement producer must reject missing coordinator authority" || return 1
  [ ! -s "$call_log" ] || {
    echo -e "${RED}ASSERTION FAILED:${NC} uncoordinated backend replacement producer mutated Docker"
    cat "$call_log"
    return 1
  }
}

test_rollback_floor_proof_rejects_uncoordinated_mutation() {
  local call_log="$TEST_TMP_DIR/rollback-floor-uncoordinated.log"
  local exit_code

  set +e
  (
    unset SANCTUARY_CLEANUP_COORDINATED
    docker() { printf 'docker:%s\n' "$*" >> "$call_log"; }
    run_project_compose() { printf 'compose:%s\n' "$*" >> "$call_log"; }
    prove_below_floor_rollback_is_unsupported
  )
  exit_code=$?
  set -e

  assert_equals "1" "$exit_code" \
    "rollback-floor proof must reject missing coordinator authority" || return 1
  [ ! -s "$call_log" ] || {
    echo -e "${RED}ASSERTION FAILED:${NC} uncoordinated rollback-floor proof invoked Docker or Compose"
    cat "$call_log"
    return 1
  }
}

test_rollback_worker_start_rejects_uncoordinated_mutation() {
  local call_log="$TEST_TMP_DIR/rollback-worker-start-uncoordinated.log"
  local exit_code

  set +e
  (
    unset SANCTUARY_CLEANUP_COORDINATED
    docker() { printf 'docker:%s\n' "$*" >> "$call_log"; }
    start_below_floor_rollback_worker rollback-worker rollback-network rollback.env
  )
  exit_code=$?
  set -e

  assert_equals "1" "$exit_code" \
    "rollback worker producer must reject missing coordinator authority" || return 1
  [ ! -s "$call_log" ] || {
    echo -e "${RED}ASSERTION FAILED:${NC} uncoordinated rollback worker start invoked Docker"
    cat "$call_log"
    return 1
  }
}

test_backend_replacement_selects_shared_frontend_network() {
  local selected

  selected="$({
    docker() {
      case "${*: -1}" in
        frontend) printf 'sanctuary-network\n' ;;
        backend) printf 'llm-egress-network\nsanctuary-network\n' ;;
        *) return 1 ;;
      esac
    }
    resolve_frontend_backend_network frontend backend
  })" || return 1

  assert_equals "sanctuary-network" "$selected" \
    "backend replacement should use the exact network shared with frontend"
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
  run_test "release force rebuild selection is exact" test_release_force_rebuild_selection_is_exact
  run_test "upgrade harness force rebuild contract" test_upgrade_harness_force_rebuild_contract
  run_test "upgrade selection labels are sanitized" test_upgrade_selection_labels_are_sanitized
  run_test "upgrade selection manifest records resolved refs" test_upgrade_selection_manifest_records_resolved_refs
  run_test "legacy optional profile compose is isolated" test_legacy_optional_profile_compose_is_isolated
  run_test "legacy MCP healthcheck is normalized without Tor overlay" test_legacy_mcp_healthcheck_is_normalized_without_tor_overlay
  run_test "install scopes monitoring config dir per checkout" test_install_scopes_monitoring_config_dir_per_checkout
  run_test "install scopes Tor ingress config per checkout" test_install_scopes_tor_ingress_config_per_checkout
  run_test "Tor ingress config maps workspace volume" test_tor_ingress_config_maps_workspace_volume
  run_test "monitoring sync stands down when reachable" test_monitoring_sync_stands_down_when_configs_are_reachable
  run_test "monitoring sync requires coordinator when untranslated" test_monitoring_sync_requires_coordinator_when_path_is_untranslated
  run_test "coordinated monitoring sync uses immutable ID" test_monitoring_sync_uses_labeled_immutable_id_when_coordinated
  run_test "upgrade teardown captures diagnostics before cleanup" test_upgrade_teardown_captures_diagnostics_before_cleanup
  run_test "coordinated upgrade defers legacy cleanup" test_upgrade_coordinated_mode_defers_legacy_cleanup
  run_test "install host artifacts use exact registered cleanup" test_install_host_artifacts_use_exact_registered_cleanup
  run_test "unhealthy capture dumps the unhealthy container" test_unhealthy_capture_dumps_unhealthy_container
  run_test "unhealthy capture is quiet when all healthy" test_unhealthy_capture_is_quiet_when_all_healthy
  run_test "upgrade teardown captures source checkout diagnostics" test_upgrade_teardown_captures_source_checkout_diagnostics
  run_test "legacy optional profile compose can use target tor overlay" test_legacy_optional_profile_compose_can_use_target_tor_overlay
  run_test "legacy optional profile compose requires target tor ingress" test_legacy_optional_profile_compose_requires_target_tor_ingress
  run_test "tor compose uses supported hidden service config" test_tor_compose_uses_supported_hidden_service_config
  run_test "MCP healthcheck uses IPv4 loopback" test_mcp_healthcheck_uses_ipv4_loopback
  run_test "current compose builds shared backend image once" test_current_compose_builds_shared_backend_image_once
  run_test "upgrade harness sources extracted helpers" test_upgrade_harness_sources_extracted_helpers
  run_test "upgrade harness restart fallback is opt-in" test_upgrade_harness_restart_fallback_is_opt_in
  run_test "install workflow uses run-scoped ssl dirs" test_install_workflow_uses_run_scoped_ssl_dirs
  run_test "coordinated upgrade ssl uses Docker-visible root" test_upgrade_ssl_dir_keeps_coordinator_runtime_off_docker_mounts
  run_test "release tag workflows use distinct concurrency groups" test_release_tag_workflows_use_distinct_concurrency_groups
  run_test "upgrade harness covers historical transaction migrations" test_upgrade_harness_covers_historical_transaction_migrations
  run_test "upgrade harness covers wallet sync state migration" test_upgrade_harness_covers_wallet_sync_state_migration
  run_test "upgrade harness covers wallet sync retirement" test_upgrade_harness_covers_wallet_sync_retirement
  run_test "upgrade harness never logs secret prefixes" test_upgrade_harness_never_logs_secret_prefixes
  run_test "runner lock helper uses cross-UID writable locks" test_runner_lock_helper_uses_cross_uid_writable_locks
  run_test "upgrade network defaults respect overrides" test_upgrade_network_defaults_respect_overrides
  run_test "invalid fixture is rejected" test_invalid_fixture_is_rejected
  run_test "install root defaults to tmp outside actions" test_install_root_defaults_to_tmp_outside_actions
  run_test "install root uses workspace in actions" test_install_root_uses_workspace_in_actions
  run_test "install root uses workspace mount without actions env" test_install_root_uses_workspace_mount_without_actions_env
  run_test "install root honors explicit override" test_install_root_honors_explicit_override
  run_test "prepare install root refuses symlink before mutating target" test_prepare_install_root_refuses_symlink_before_mutating_target
  run_test "prepare install root refuses broad existing root" test_prepare_install_root_refuses_broad_existing_root
  run_test "prepare install root uses coordinated private runtime for tmp" test_prepare_install_root_uses_coordinated_private_runtime_for_tmp
  run_test "prepare install root names the broad parent it refuses" test_prepare_install_root_names_the_broad_parent_it_refuses
  run_test "compose subject binds project root before ownership init" test_compose_subject_binds_project_root_before_ownership_init
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
  run_test "legacy prefix cleanup refuses mutation" test_legacy_prefix_cleanup_refuses_mutation
  run_test "upgrade cleanup disables restart policy" test_disable_compose_project_restart_policy_updates_project_containers
  run_test "historical Compose files disable restart before startup" test_force_test_compose_restart_policy_no_rewrites_historical_files
  run_test "exit cleanup trap runs on normal exit" test_exit_cleanup_trap_runs_on_normal_exit
  run_test "exit cleanup trap preserves failure status" test_exit_cleanup_trap_preserves_failure_status
  run_test "upgrade cleanup preserves failed fixture status" test_upgrade_finish_preserves_failed_fixture_status
  run_test "upgrade cleanup preserves failure when cleanup fails" test_upgrade_finish_preserves_failure_when_cleanup_fails
  run_test "upgrade cleanup fails successful fixture on cleanup failure" test_upgrade_finish_fails_successful_fixture_on_cleanup_failure
  run_test "upgrade harness covers backend address replacement" test_upgrade_harness_covers_backend_address_replacement
  run_test "coordinated container removal reconciles lost response" test_coordinated_container_removal_reconciles_lost_response
  run_test "coordinated container removal refuses ambiguous postcondition" test_coordinated_container_removal_refuses_ambiguous_postcondition
  run_test "created container response loss preserves status" test_created_container_response_loss_preserves_status_after_registration
  run_test "created container rejects foreign success ID" test_created_container_rejects_foreign_success_id
  run_test "registered container start preserves failure status" test_registered_container_start_preserves_failure_status
  run_test "install retirement refuses ambiguous postcondition" test_install_container_retirement_refuses_ambiguous_postcondition
  run_test "upgrade harness exports operator runtime state" test_upgrade_harness_exports_operator_runtime_state
  run_test "install ownership rebinds workspace identity" test_install_ownership_rebinds_workspace_identity_to_compose_lane
  run_test "backend replacement failure restores backend" test_backend_replacement_failure_restores_backend
  run_test "backend replacement rejects uncoordinated mutation" test_backend_replacement_rejects_uncoordinated_mutation
  run_test "backend replacement producer rejects uncoordinated mutation" test_backend_replacement_producer_rejects_uncoordinated_mutation
  run_test "rollback-floor proof rejects uncoordinated mutation" test_rollback_floor_proof_rejects_uncoordinated_mutation
  run_test "rollback worker start rejects uncoordinated mutation" test_rollback_worker_start_rejects_uncoordinated_mutation
  run_test "backend replacement selects shared frontend network" test_backend_replacement_selects_shared_frontend_network
  run_test "browser refresh smoke sends csrf header" test_browser_refresh_smoke_sends_csrf_header
  run_test "support package smoke confirms shareable aggregate" test_support_package_smoke_confirms_shareable_aggregate
  run_test "no undispatched upgrade fixture hooks" test_no_undispatched_fixture_hooks
  run_test "installed image matching checkout passes" test_assert_installed_image_matches_checkout_accepts_match
  run_test "installed image from another ref fails" test_assert_installed_image_matches_checkout_rejects_mismatch
  run_test "unreadable image version is not a failure" test_assert_installed_image_matches_checkout_skips_when_unreadable
  run_test "cleanup restore preserves executable mode" test_cleanup_restore_preserves_tracked_executable_mode

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
