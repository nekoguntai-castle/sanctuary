#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
START_SCRIPT="$PROJECT_ROOT/start.sh"
SETUP_SCRIPT="$PROJECT_ROOT/scripts/setup.sh"

TESTS_RUN=0
TESTS_FAILED=0
TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

pass() {
    printf 'PASS: %s\n' "$1"
}

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

run_test() {
    local name="$1"
    shift
    TESTS_RUN=$((TESTS_RUN + 1))
    if "$@"; then
        pass "$name"
    else
        fail "$name"
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    [[ "$haystack" == *"$needle"* ]]
}

assert_not_contains() {
    local haystack="$1"
    local needle="$2"
    [[ "$haystack" != *"$needle"* ]]
}

write_runtime_env() {
    local env_file="$1"
    local monitoring="${2:-no}"
    local tor="${3:-no}"
    local mcp="${4:-no}"

    cat > "$env_file" <<EOF
JWT_SECRET=test-jwt-secret
ENCRYPTION_KEY=test-encryption-key
ENCRYPTION_SALT=test-encryption-salt
GATEWAY_SECRET=test-gateway-secret
WORKER_DIAGNOSTICS_SECRET=test-worker-secret
POSTGRES_PASSWORD=test-postgres-password
GRAFANA_PASSWORD=test-grafana-password
LLM_EGRESS_PROXY_SECRET=test-egress-secret
REDIS_PASSWORD=test-redis-password
ENABLE_MONITORING=$monitoring
ENABLE_TOR=$tor
ENABLE_MCP=$mcp
EOF
}

make_fake_docker() {
    local bin_dir="$1"
    mkdir -p "$bin_dir"
    cat > "$bin_dir/docker" <<'EOF'
#!/bin/bash
set -e
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG:?}"

case "$*" in
    info|"compose version"|"image inspect "*)
        exit 0
        ;;
esac

if [ "${1:-}" = "ps" ]; then
    if [[ "$*" == *"--filter label=com.docker.compose.project=${EXPECTED_PROJECT:-sanctuary}"* ]] \
        && [[ "$*" == *"com.docker.compose.service"* ]]; then
        if [[ "$*" == "ps -a "* ]]; then
            printf '%s\n' "${EXISTING_SERVICES:-${RUNNING_SERVICES:-}}"
        else
            printf '%s\n' "${RUNNING_SERVICES:-}"
        fi
    else
        printf '%s\n' "${FOREIGN_SERVICES:-}"
    fi
    exit 0
fi

if [ "${1:-}" = "compose" ] && [[ "$*" == *" config --services"* ]]; then
    printf '%s\n' backend frontend worker postgres
fi
EOF
    chmod +x "$bin_dir/docker"
}

run_start() {
    local case_dir="$1"
    shift
    mkdir -p "$case_dir"
    : > "$case_dir/docker.log"
    make_fake_docker "$case_dir/bin"
    FAKE_DOCKER_LOG="$case_dir/docker.log" \
        SANCTUARY_ENV_FILE="$case_dir/sanctuary.env" \
        PATH="$case_dir/bin:$PATH" \
        bash "$START_SCRIPT" "$@" >/dev/null 2>&1
}

test_setup_preserves_existing_optional_preferences() {
    local case_dir="$TEST_TMP_DIR/setup-preserve"
    local env_file="$case_dir/sanctuary.env"
    mkdir -p "$case_dir"
    write_runtime_env "$env_file" yes yes yes

    env -u ENABLE_MONITORING -u ENABLE_TOR -u ENABLE_MCP \
        SANCTUARY_ENV_FILE="$env_file" \
        SANCTUARY_SSL_DIR="$case_dir/ssl" \
        bash "$SETUP_SCRIPT" --force --non-interactive --no-start --skip-ssl --skip-prereqs \
        >/dev/null 2>&1

    local contents
    contents="$(cat "$env_file")"
    assert_contains "$contents" "ENABLE_MONITORING=yes" \
        && assert_contains "$contents" "ENABLE_TOR=yes" \
        && assert_contains "$contents" "ENABLE_MCP=yes"
}

test_setup_explicit_mcp_enable_wins() {
    local case_dir="$TEST_TMP_DIR/setup-mcp"
    local env_file="$case_dir/sanctuary.env"
    mkdir -p "$case_dir"
    write_runtime_env "$env_file" no no no

    SANCTUARY_ENV_FILE="$env_file" \
        SANCTUARY_SSL_DIR="$case_dir/ssl" \
        bash "$SETUP_SCRIPT" --force --non-interactive --no-start --skip-ssl --skip-prereqs --enable-mcp \
        >/dev/null 2>&1

    grep -qx 'ENABLE_MCP=yes' "$env_file"
}

test_stop_uses_running_project_services() {
    local case_dir="$TEST_TMP_DIR/stop"
    mkdir -p "$case_dir"
    write_runtime_env "$case_dir/sanctuary.env" no no no

    RUNNING_SERVICES=$'grafana\ntor\nmcp' run_start "$case_dir" --stop

    local calls
    calls="$(cat "$case_dir/docker.log")"
    assert_contains "$calls" "ps -a --filter label=com.docker.compose.project=sanctuary" \
        && assert_contains "$calls" "-f $PROJECT_ROOT/docker/compose/monitoring.yml" \
        && assert_contains "$calls" "-f $PROJECT_ROOT/docker/compose/tor.yml" \
        && assert_contains "$calls" "--profile mcp down"
}

test_stop_includes_exited_optional_services() {
    local case_dir="$TEST_TMP_DIR/stop-exited"
    mkdir -p "$case_dir"
    write_runtime_env "$case_dir/sanctuary.env" no no no

    RUNNING_SERVICES= EXISTING_SERVICES=$'tor\nmcp' run_start "$case_dir" --stop

    local calls
    calls="$(cat "$case_dir/docker.log")"
    assert_contains "$calls" "ps -a --filter label=com.docker.compose.project=sanctuary" \
        && assert_contains "$calls" "-f $PROJECT_ROOT/docker/compose/tor.yml" \
        && assert_contains "$calls" "--profile mcp down"
}

test_detection_ignores_foreign_and_exited_services() {
    local case_dir="$TEST_TMP_DIR/scoped-detection"
    mkdir -p "$case_dir"
    write_runtime_env "$case_dir/sanctuary.env" no no no

    FOREIGN_SERVICES=$'grafana\ntor\nmcp' RUNNING_SERVICES= run_start "$case_dir"

    local calls
    calls="$(cat "$case_dir/docker.log")"
    assert_not_contains "$calls" "docker/compose/monitoring.yml" \
        && assert_not_contains "$calls" "docker/compose/tor.yml" \
        && assert_not_contains "$calls" "--profile mcp"
}

test_with_monitoring_is_additive_and_persistent() {
    local case_dir="$TEST_TMP_DIR/additive"
    mkdir -p "$case_dir"
    write_runtime_env "$case_dir/sanctuary.env" no yes yes

    run_start "$case_dir" --with-monitoring

    local calls
    calls="$(cat "$case_dir/docker.log")"
    grep -qx 'ENABLE_MONITORING=yes' "$case_dir/sanctuary.env" \
        && assert_contains "$calls" "-f $PROJECT_ROOT/docker/compose/monitoring.yml" \
        && assert_contains "$calls" "-f $PROJECT_ROOT/docker/compose/tor.yml" \
        && assert_contains "$calls" "--profile mcp"
}

test_with_tor_is_additive_and_persistent() {
    local case_dir="$TEST_TMP_DIR/additive-tor"
    mkdir -p "$case_dir"
    write_runtime_env "$case_dir/sanctuary.env" yes no yes

    run_start "$case_dir" --with-tor

    local calls
    calls="$(cat "$case_dir/docker.log")"
    grep -qx 'ENABLE_TOR=yes' "$case_dir/sanctuary.env" \
        && assert_contains "$calls" "-f $PROJECT_ROOT/docker/compose/monitoring.yml" \
        && assert_contains "$calls" "-f $PROJECT_ROOT/docker/compose/tor.yml" \
        && assert_contains "$calls" "--profile mcp"
}

test_with_mcp_is_additive_and_persistent() {
    local case_dir="$TEST_TMP_DIR/additive-mcp"
    mkdir -p "$case_dir"
    write_runtime_env "$case_dir/sanctuary.env" yes yes no

    run_start "$case_dir" --with-mcp

    local calls
    calls="$(cat "$case_dir/docker.log")"
    grep -qx 'ENABLE_MCP=yes' "$case_dir/sanctuary.env" \
        && assert_contains "$calls" "-f $PROJECT_ROOT/docker/compose/monitoring.yml" \
        && assert_contains "$calls" "-f $PROJECT_ROOT/docker/compose/tor.yml" \
        && assert_contains "$calls" "--profile mcp"
}

test_logs_honors_custom_project_and_all_profiles() {
    local case_dir="$TEST_TMP_DIR/logs"
    mkdir -p "$case_dir"
    write_runtime_env "$case_dir/sanctuary.env" no no no

    EXPECTED_PROJECT=private-sanctuary COMPOSE_PROJECT_NAME=private-sanctuary \
        RUNNING_SERVICES=$'grafana\ntor\nmcp' run_start "$case_dir" --logs

    local calls
    calls="$(cat "$case_dir/docker.log")"
    assert_contains "$calls" "--filter label=com.docker.compose.project=private-sanctuary" \
        && assert_contains "$calls" "docker/compose/monitoring.yml" \
        && assert_contains "$calls" "docker/compose/tor.yml" \
        && assert_contains "$calls" "--profile mcp logs -f"
}

run_test "setup preserves existing optional preferences" test_setup_preserves_existing_optional_preferences
run_test "setup explicitly enables MCP" test_setup_explicit_mcp_enable_wins
run_test "stop includes every running project stack" test_stop_uses_running_project_services
run_test "stop includes exited optional services" test_stop_includes_exited_optional_services
run_test "detection ignores foreign and exited services" test_detection_ignores_foreign_and_exited_services
run_test "with-monitoring preserves peer stacks and persists" test_with_monitoring_is_additive_and_persistent
run_test "with-tor preserves peer stacks and persists" test_with_tor_is_additive_and_persistent
run_test "with-mcp preserves peer stacks and persists" test_with_mcp_is_additive_and_persistent
run_test "logs honors custom project and all profiles" test_logs_honors_custom_project_and_all_profiles

printf '\n%s tests, %s failures\n' "$TESTS_RUN" "$TESTS_FAILED"
[ "$TESTS_FAILED" -eq 0 ]
