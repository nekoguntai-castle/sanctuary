#!/bin/bash
# Contract tests for offline-only Compose image reference overrides.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CORE_BASE="$PROJECT_ROOT/docker-compose.yml"
MONITORING_BASE="$PROJECT_ROOT/docker/compose/monitoring.yml"
TOR_BASE="$PROJECT_ROOT/docker/compose/tor.yml"
CORE_OFFLINE="$PROJECT_ROOT/docker/compose/offline-core.yml"
MONITORING_OFFLINE="$PROJECT_ROOT/docker/compose/offline-monitoring.yml"
TOR_OFFLINE="$PROJECT_ROOT/docker/compose/offline-tor.yml"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()

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

assert_image_line() {
  local file="$1"
  local image="$2"
  awk -v expected="$image" \
    '$1 == "image:" && $2 == expected && NF == 2 { found=1 } END { exit !found }' \
    "$file"
}

assert_service_set() {
  local file="$1"
  shift
  local actual expected
  actual="$(awk '
    /^services:[[:space:]]*$/ { in_services=1; next }
    in_services && /^[^[:space:]#]/ { exit }
    in_services && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
      name=$1
      sub(/:$/, "", name)
      print name
    }
  ' "$file" | LC_ALL=C sort)"
  expected="$(printf '%s\n' "$@" | LC_ALL=C sort)"
  if [ "$actual" != "$expected" ]; then
    echo "unexpected services in $file" >&2
    echo "expected: $expected" >&2
    echo "actual: $actual" >&2
    return 1
  fi
}

test_online_compose_remains_digest_pinned() {
  assert_image_line "$CORE_BASE" \
    'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777' \
    && assert_image_line "$CORE_BASE" \
      'redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2' \
    && assert_image_line "$CORE_BASE" \
      'tecnativa/docker-socket-proxy:latest@sha256:1f5038b54f06c3e18422902cf00ba21803d1c97805aae032e5e6673d532d3459' \
    && assert_image_line "$MONITORING_BASE" \
      'grafana/grafana:10.4.19-security-01@sha256:5584505cb75be8cb14c19d7473a87e2675c68b34b546bc1923ef74300c337111' \
    && assert_image_line "$TOR_BASE" \
      'dperson/torproxy:latest@sha256:d8b5f1cf24f1b7a0aa334929a264b2606a107223dd0d51eb1cda8aae6fbeec53'
}

test_core_offline_override_is_tag_only_and_core_only() {
  assert_service_set "$CORE_OFFLINE" \
    redis postgres backend worker mcp migrate frontend gateway llm-egress-proxy docker-proxy \
    && assert_image_line "$CORE_OFFLINE" 'redis:7-alpine' \
    && assert_image_line "$CORE_OFFLINE" 'postgres:16-alpine' \
    && assert_image_line "$CORE_OFFLINE" 'tecnativa/docker-socket-proxy:latest' \
    && ! grep -Fq '@sha256:' "$CORE_OFFLINE"
}

test_monitoring_offline_override_cannot_materialize_other_profiles() {
  assert_service_set "$MONITORING_OFFLINE" \
    jaeger loki promtail prometheus alertmanager grafana-password-migration grafana \
    && assert_image_line "$MONITORING_OFFLINE" 'jaegertracing/all-in-one:1.53' \
    && assert_image_line "$MONITORING_OFFLINE" 'grafana/loki:2.9.0' \
    && assert_image_line "$MONITORING_OFFLINE" 'grafana/promtail:3.5.0' \
    && assert_image_line "$MONITORING_OFFLINE" 'prom/prometheus:v2.47.0' \
    && assert_image_line "$MONITORING_OFFLINE" 'prom/alertmanager:v0.26.0' \
    && assert_image_line "$MONITORING_OFFLINE" 'grafana/grafana:10.4.19-security-01' \
    && ! grep -Fq '@sha256:' "$MONITORING_OFFLINE"
}

test_tor_offline_override_cannot_materialize_other_profiles() {
  assert_service_set "$TOR_OFFLINE" tor-ingress tor \
    && assert_image_line "$TOR_OFFLINE" 'dperson/torproxy:latest' \
    && ! grep -Fq '@sha256:' "$TOR_OFFLINE"
}

main() {
  echo "Offline Compose Image Contract Tests"
  echo "===================================="

  run_test "online Compose remains digest pinned" test_online_compose_remains_digest_pinned
  run_test "core offline override is tag-only and core-only" test_core_offline_override_is_tag_only_and_core_only
  run_test "monitoring override cannot materialize other profiles" test_monitoring_offline_override_cannot_materialize_other_profiles
  run_test "Tor override cannot materialize other profiles" test_tor_offline_override_cannot_materialize_other_profiles

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

  echo -e "${GREEN}All offline Compose image contract tests passed!${NC}"
}

main "$@"
