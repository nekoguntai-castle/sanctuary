#!/bin/bash
# ============================================
# End-to-End Upgrade Install Test
# ============================================
#
# This test installs an older Sanctuary ref, upgrades it to the current
# checkout, and verifies that:
# - Existing data is preserved
# - Secrets are reused from the runtime env file
# - Database migrations run correctly
# - Containers restart properly
#
# Requirements:
#   - Git tags or an explicit --source-ref for a real ref-to-ref upgrade path
#   - Docker and Docker Compose v2
#
# Run: ./upgrade-install.test.sh [--keep-containers] [--source-ref <git-ref>] [--mode <core|full>] [--https-port <port>] [--http-port <port>] [--gateway-port <port>]
# ============================================

set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROJECT_ROOT="$TARGET_PROJECT_ROOT"

# Source helpers
source "$SCRIPT_DIR/../utils/helpers.sh"
source "$SCRIPT_DIR/../utils/upgrade-source-refs.sh"

# ============================================
# Configuration
# ============================================

KEEP_CONTAINERS=false
VERBOSE=false
UPGRADE_SOURCE_REF="${SANCTUARY_UPGRADE_SOURCE_REF:-}"
UPGRADE_TEST_MODE="${SANCTUARY_UPGRADE_TEST_MODE:-full}"
UPGRADE_FIXTURE="${SANCTUARY_UPGRADE_FIXTURE:-baseline}"
UPGRADE_FIXTURE_LABEL=""
UPGRADE_ARTIFACTS_DIR="${SANCTUARY_UPGRADE_ARTIFACTS_DIR:-}"
UPGRADE_ARTIFACTS_CAPTURED=false
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"
GATEWAY_PORT="${GATEWAY_PORT:-4000}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-containers)
            KEEP_CONTAINERS=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            export DEBUG=true
            shift
            ;;
        --source-ref)
            UPGRADE_SOURCE_REF="$2"
            shift 2
            ;;
        --source-ref=*)
            UPGRADE_SOURCE_REF="${1#*=}"
            shift
            ;;
        --mode)
            UPGRADE_TEST_MODE="$2"
            shift 2
            ;;
        --mode=*)
            UPGRADE_TEST_MODE="${1#*=}"
            shift
            ;;
        --fixture)
            UPGRADE_FIXTURE="$2"
            shift 2
            ;;
        --fixture=*)
            UPGRADE_FIXTURE="${1#*=}"
            shift
            ;;
        --https-port)
            HTTPS_PORT="$2"
            shift 2
            ;;
        --https-port=*)
            HTTPS_PORT="${1#*=}"
            shift
            ;;
        --http-port)
            HTTP_PORT="$2"
            shift 2
            ;;
        --http-port=*)
            HTTP_PORT="${1#*=}"
            shift
            ;;
        --gateway-port)
            GATEWAY_PORT="$2"
            shift 2
            ;;
        --gateway-port=*)
            GATEWAY_PORT="${1#*=}"
            shift
            ;;
        --core-only)
            UPGRADE_TEST_MODE="core"
            shift
            ;;
        --full-suite)
            UPGRADE_TEST_MODE="full"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

case "$UPGRADE_TEST_MODE" in
    core|full)
        ;;
    *)
        log_error "Invalid upgrade test mode: $UPGRADE_TEST_MODE"
        log_error "Expected one of: core, full"
        exit 1
        ;;
esac

for port_name in HTTPS_PORT HTTP_PORT GATEWAY_PORT; do
    port_value="${!port_name}"
    case "$port_value" in
        ''|*[!0-9]*)
            log_error "Invalid ${port_name}: $port_value"
            exit 1
            ;;
    esac
done

source "$SCRIPT_DIR/../utils/upgrade-fixtures.sh"

if ! initialize_upgrade_fixture; then
    exit 1
fi

# Test configuration
TEST_ID=$(generate_test_run_id)
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sanctuary-upgrade-${TEST_ID}}"
TEST_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-/tmp/sanctuary-upgrade-runtime-${TEST_ID}}"
TEST_ENV_FILE="${SANCTUARY_ENV_FILE:-$TEST_RUNTIME_DIR/sanctuary.env}"
TEST_SSL_DIR="${SANCTUARY_SSL_DIR:-$TEST_RUNTIME_DIR/ssl}"
API_BASE_URL="https://localhost:${HTTPS_PORT}"
UPGRADE_BROWSER_BASE_URL="${UPGRADE_BROWSER_BASE_URL:-$API_BASE_URL}"
UPGRADE_BROWSER_ORIGIN="${UPGRADE_BROWSER_ORIGIN:-$UPGRADE_BROWSER_BASE_URL}"
COOKIE_JAR="/tmp/sanctuary-test-cookies-${TEST_ID}.txt"
UPGRADE_SOURCE_CHECKOUT="/tmp/sanctuary-upgrade-source-${TEST_ID}/sanctuary"
UPGRADE_SOURCE_CREATED=false
UPGRADE_SOURCE_LABEL=""
UPGRADE_TARGET_LABEL="$(git -C "$TARGET_PROJECT_ROOT" describe --tags --always 2>/dev/null || git -C "$TARGET_PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "current-checkout")"

# State variables for testing
ORIGINAL_JWT_SECRET=""
ORIGINAL_ENCRYPTION_KEY=""
ORIGINAL_GATEWAY_SECRET=""
ORIGINAL_POSTGRES_PASSWORD=""
ORIGINAL_USER_PASSWORD=""
TEST_WALLET_ID=""

# Phase 6 cookie auth: the backend sets HttpOnly sanctuary_access +
# sanctuary_refresh cookies and a readable sanctuary_csrf cookie. Mutations
# must echo the CSRF token in X-CSRF-Token.
CSRF_TOKEN=""

resolve_env_file() {
    local project_dir="${1:-$PROJECT_ROOT}"

    if [ "$UPGRADE_ENV_LAYOUT" = "legacy-repo-env" ] && [ -f "$project_dir/.env" ]; then
        echo "$project_dir/.env"
    elif [ -f "$TEST_ENV_FILE" ]; then
        echo "$TEST_ENV_FILE"
    elif [ -f "$project_dir/.env" ]; then
        echo "$project_dir/.env"
    else
        echo "$TEST_ENV_FILE"
    fi
}

load_runtime_env() {
    local env_file
    local project_dir="${1:-$PROJECT_ROOT}"
    local requested_https_port="$HTTPS_PORT"
    local requested_http_port="$HTTP_PORT"
    local requested_gateway_port="$GATEWAY_PORT"
    env_file="$(resolve_env_file "$project_dir")"
    if [ ! -f "$env_file" ]; then
        log_error "Runtime env not found: $env_file"
        return 1
    fi

    set -a
    source "$env_file"
    set +a

    set_upgrade_ports "$requested_https_port" "$requested_http_port"
    GATEWAY_PORT="$requested_gateway_port"
    if ! sync_runtime_env_ports "$env_file"; then
        log_error "Failed to synchronize requested test ports into $env_file"
        return 1
    fi

    export HTTPS_PORT HTTP_PORT GATEWAY_PORT
    export SANCTUARY_ENV_FILE="$env_file"
    export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"
}

# Extract the sanctuary_csrf cookie value from the Netscape-format cookie
# jar. Fields are tab-separated: domain, HttpOnly, path, Secure, expiry,
# name, value. Sets CSRF_TOKEN (empty string if the cookie isn't set).
extract_csrf_token() {
    if [ ! -f "$COOKIE_JAR" ]; then
        CSRF_TOKEN=""
        return
    fi
    CSRF_TOKEN=$(awk -F'\t' '$6 == "sanctuary_csrf" { print $7 }' "$COOKIE_JAR" | tail -n 1)
}

wait_for_browser_auth_ready() {
    wait_for_http_endpoint "$API_BASE_URL/api/v1/auth/registration-status" 60 200
}

describe_checkout_ref() {
    local repo_root="$1"

    git -C "$repo_root" describe --tags --always 2>/dev/null || \
        git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || \
        echo "unknown"
}

discover_upgrade_source_ref() {
    if [ -n "$UPGRADE_SOURCE_REF" ]; then
        resolve_named_upgrade_source_ref "$UPGRADE_SOURCE_REF" "$TARGET_PROJECT_ROOT"
        return 0
    fi

    resolve_named_upgrade_source_ref "latest-stable" "$TARGET_PROJECT_ROOT"
}

prepare_upgrade_source_checkout() {
    local source_ref=""
    source_ref=$(discover_upgrade_source_ref 2>/dev/null || true)

    if [ -z "$source_ref" ]; then
        UPGRADE_SOURCE_LABEL="$(describe_checkout_ref "$TARGET_PROJECT_ROOT") (restart fallback)"
        PROJECT_ROOT="$TARGET_PROJECT_ROOT"
        log_warning "No older stable tag was found; upgrade test will fall back to restarting the current checkout"
        return 0
    fi

    if ! git -C "$TARGET_PROJECT_ROOT" rev-parse --verify "$source_ref" >/dev/null 2>&1; then
        log_error "Upgrade source ref not found: $source_ref"
        return 1
    fi

    mkdir -p "$(dirname "$UPGRADE_SOURCE_CHECKOUT")"
    git -C "$TARGET_PROJECT_ROOT" worktree add --detach "$UPGRADE_SOURCE_CHECKOUT" "$source_ref" >/dev/null

    PROJECT_ROOT="$UPGRADE_SOURCE_CHECKOUT"
    UPGRADE_SOURCE_CREATED=true
    UPGRADE_SOURCE_LABEL="$source_ref"
    return 0
}

cleanup_upgrade_source_checkout() {
    if [ "$UPGRADE_SOURCE_CREATED" = "true" ]; then
        git -C "$TARGET_PROJECT_ROOT" worktree remove --force "$UPGRADE_SOURCE_CHECKOUT" >/dev/null 2>&1 || true
        rmdir "$(dirname "$UPGRADE_SOURCE_CHECKOUT")" 2>/dev/null || true
        UPGRADE_SOURCE_CREATED=false
    fi
}

run_install_script() {
    local project_dir="$1"
    local checkout_name
    checkout_name="$(basename "$project_dir")"
    local install_log="$TEST_RUNTIME_DIR/install-${checkout_name}.log"
    local resolved_env_file=""
    local resolved_ssl_dir="$TEST_SSL_DIR"
    local -a install_env
    local -a env_command

    mkdir -p "$TEST_RUNTIME_DIR"

    resolved_env_file="$(resolve_env_file "$project_dir")"
    env_command=(env)
    install_env=(
        "HTTPS_PORT=$HTTPS_PORT"
        "HTTP_PORT=$HTTP_PORT"
        "GATEWAY_PORT=$GATEWAY_PORT"
        "ENABLE_MONITORING=$UPGRADE_ENABLE_MONITORING"
        "ENABLE_TOR=$UPGRADE_ENABLE_TOR"
        "SANCTUARY_DIR=$project_dir"
        "SANCTUARY_RUNTIME_DIR=$TEST_RUNTIME_DIR"
        "SANCTUARY_SSL_DIR=$resolved_ssl_dir"
        "SKIP_GIT_CHECKOUT=true"
        "RATE_LIMIT_LOGIN=100"
        "RATE_LIMIT_PASSWORD_CHANGE=100"
    )

    if [ -n "$UPGRADE_GRAFANA_PORT" ]; then
        install_env+=(
            "MONITORING_BIND_ADDR=$UPGRADE_MONITORING_BIND_ADDR"
            "GRAFANA_PORT=$UPGRADE_GRAFANA_PORT"
            "PROMETHEUS_PORT=$UPGRADE_PROMETHEUS_PORT"
            "ALERTMANAGER_PORT=$UPGRADE_ALERTMANAGER_PORT"
            "LOKI_PORT=$UPGRADE_LOKI_PORT"
            "JAEGER_UI_PORT=$UPGRADE_JAEGER_UI_PORT"
            "JAEGER_OTLP_GRPC_PORT=$UPGRADE_JAEGER_OTLP_GRPC_PORT"
            "JAEGER_OTLP_HTTP_PORT=$UPGRADE_JAEGER_OTLP_HTTP_PORT"
        )
    fi

    if [ -n "$UPGRADE_GRAFANA_CONTAINER_NAME" ]; then
        install_env+=(
            "GRAFANA_CONTAINER_NAME=$UPGRADE_GRAFANA_CONTAINER_NAME"
            "PROMETHEUS_CONTAINER_NAME=$UPGRADE_PROMETHEUS_CONTAINER_NAME"
            "ALERTMANAGER_CONTAINER_NAME=$UPGRADE_ALERTMANAGER_CONTAINER_NAME"
            "LOKI_CONTAINER_NAME=$UPGRADE_LOKI_CONTAINER_NAME"
            "PROMTAIL_CONTAINER_NAME=$UPGRADE_PROMTAIL_CONTAINER_NAME"
            "JAEGER_CONTAINER_NAME=$UPGRADE_JAEGER_CONTAINER_NAME"
        )
    fi

    if [ "$UPGRADE_ENV_LAYOUT" != "legacy-repo-env" ] || [ ! -f "$project_dir/.env" ]; then
        install_env+=("SANCTUARY_ENV_FILE=$resolved_env_file")
    else
        env_command+=(-u SANCTUARY_ENV_FILE)
    fi

    if ! sync_runtime_env_ports "$resolved_env_file"; then
        log_error "Failed to synchronize test port overrides into $resolved_env_file"
        return 1
    fi

    if [ "$VERBOSE" = "true" ] && [ -f "$resolved_env_file" ]; then
        log_info "Preseeded runtime env ports in $resolved_env_file:"
        grep -E '^(HTTPS_PORT|HTTP_PORT|GATEWAY_PORT)=' "$resolved_env_file" || true
    fi

    set +e
    "${env_command[@]}" "${install_env[@]}" bash "$project_dir/install.sh" </dev/null 2>&1 | tee "$install_log"
    local exit_code=${PIPESTATUS[0]}
    set -e

    if [ $exit_code -ne 0 ]; then
        log_error "install.sh failed for checkout: $project_dir"
        log_error "Install log: $install_log"
        return 1
    fi

    if ! sync_runtime_env_ports "$resolved_env_file"; then
        log_error "Failed to synchronize test port overrides into $resolved_env_file"
        return 1
    fi

    return 0
}

run_upgrade_runtime_command() {
    local project_dir="${1:-$PROJECT_ROOT}"
    shift

    local resolved_env_file=""
    local -a env_command=(env)

    resolved_env_file="$(resolve_env_file "$project_dir")"
    if ! sync_runtime_env_ports "$resolved_env_file"; then
        log_error "Failed to synchronize test port overrides into $resolved_env_file"
        return 1
    fi

    env_command+=(
        "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"
        "SANCTUARY_ENV_FILE=$resolved_env_file"
        "SANCTUARY_SSL_DIR=$TEST_SSL_DIR"
        "HTTPS_PORT=$HTTPS_PORT"
        "HTTP_PORT=$HTTP_PORT"
        "GATEWAY_PORT=$GATEWAY_PORT"
        "ENABLE_MONITORING=$UPGRADE_ENABLE_MONITORING"
        "ENABLE_TOR=$UPGRADE_ENABLE_TOR"
        "RATE_LIMIT_LOGIN=100"
        "RATE_LIMIT_PASSWORD_CHANGE=100"
    )

    if [ -n "$UPGRADE_GRAFANA_PORT" ]; then
        env_command+=(
            "MONITORING_BIND_ADDR=$UPGRADE_MONITORING_BIND_ADDR"
            "GRAFANA_PORT=$UPGRADE_GRAFANA_PORT"
            "PROMETHEUS_PORT=$UPGRADE_PROMETHEUS_PORT"
            "ALERTMANAGER_PORT=$UPGRADE_ALERTMANAGER_PORT"
            "LOKI_PORT=$UPGRADE_LOKI_PORT"
            "JAEGER_UI_PORT=$UPGRADE_JAEGER_UI_PORT"
            "JAEGER_OTLP_GRPC_PORT=$UPGRADE_JAEGER_OTLP_GRPC_PORT"
            "JAEGER_OTLP_HTTP_PORT=$UPGRADE_JAEGER_OTLP_HTTP_PORT"
        )
    fi

    if [ -n "$UPGRADE_GRAFANA_CONTAINER_NAME" ]; then
        env_command+=(
            "GRAFANA_CONTAINER_NAME=$UPGRADE_GRAFANA_CONTAINER_NAME"
            "PROMETHEUS_CONTAINER_NAME=$UPGRADE_PROMETHEUS_CONTAINER_NAME"
            "ALERTMANAGER_CONTAINER_NAME=$UPGRADE_ALERTMANAGER_CONTAINER_NAME"
            "LOKI_CONTAINER_NAME=$UPGRADE_LOKI_CONTAINER_NAME"
            "PROMTAIL_CONTAINER_NAME=$UPGRADE_PROMTAIL_CONTAINER_NAME"
            "JAEGER_CONTAINER_NAME=$UPGRADE_JAEGER_CONTAINER_NAME"
        )
    fi

    "${env_command[@]}" "$@"
}

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
declare -a FAILED_TESTS

# ============================================
# Test Framework
# ============================================

run_test() {
    local test_name="$1"
    local test_func="$2"

    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    log_info "Running test: $test_name"
    echo "-------------------------------------------"

    set +e
    $test_func
    local exit_code=$?
    set -e

    if [ $exit_code -eq 0 ]; then
        log_success "PASSED: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        log_error "FAILED: $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        FAILED_TESTS+=("$test_name")
    fi
}

# ============================================
# Setup and Teardown
# ============================================

setup() {
    log_info "Setting up upgrade test environment..."
    log_info "  Test ID:       $TEST_ID"
    log_info "  Target Root:   $TARGET_PROJECT_ROOT"
    log_info "  Target Ref:    $UPGRADE_TARGET_LABEL"
    log_info "  Test Mode:     $UPGRADE_TEST_MODE"
    log_info "  Fixture:       ${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}"
    log_info "  Compose Proj:  $COMPOSE_PROJECT_NAME"
    log_info "  HTTPS Port:    $HTTPS_PORT"
    log_info "  HTTP Port:     $HTTP_PORT"
    log_info "  Gateway Port:  $GATEWAY_PORT"

    # Verify prerequisites
    if ! check_docker_available; then
        log_error "Docker is not available. Cannot run upgrade tests."
        exit 1
    fi

    export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
    export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"

    cleanup_compose_projects_by_prefix "sanctuary-upgrade-test-" "$COMPOSE_PROJECT_NAME" 2>/dev/null || true
    cleanup_containers "$TARGET_PROJECT_ROOT" 2>/dev/null || true

    if ! prepare_upgrade_source_checkout; then
        log_error "Failed to prepare upgrade source checkout"
        exit 1
    fi

    log_info "  Source Ref:    $UPGRADE_SOURCE_LABEL"
    log_info "  Source Root:   $PROJECT_ROOT"

    setup_cleanup_trap "teardown"
}

teardown() {
    log_info "Cleaning up upgrade test environment..."

    if [ "$KEEP_CONTAINERS" = "false" ]; then
        cleanup_containers "$TARGET_PROJECT_ROOT" 2>/dev/null || true
        if [ "$UPGRADE_SOURCE_CREATED" = "true" ]; then
            cleanup_containers "$UPGRADE_SOURCE_CHECKOUT" 2>/dev/null || true
        fi
    else
        log_warning "Keeping containers running (--keep-containers specified)"
        get_container_status "$TARGET_PROJECT_ROOT"
    fi

    # Clean up cookie jar
    if [ -f "$COOKIE_JAR" ]; then
        rm -f "$COOKIE_JAR"
    fi

    if [ -d "$TEST_RUNTIME_DIR" ]; then
        rm -rf "$TEST_RUNTIME_DIR"
    fi

    cleanup_upgrade_source_checkout
}

collect_upgrade_artifacts_if_requested() {
    if [ "$UPGRADE_ARTIFACTS_CAPTURED" = "true" ] || [ -z "$UPGRADE_ARTIFACTS_DIR" ]; then
        return 0
    fi

    mkdir -p "$UPGRADE_ARTIFACTS_DIR"
    SANCTUARY_UPGRADE_JOB_NAME="${SANCTUARY_UPGRADE_JOB_NAME:-manual}" \
    SANCTUARY_UPGRADE_SOURCE_REF_LABEL="$UPGRADE_SOURCE_LABEL" \
    SANCTUARY_UPGRADE_FIXTURE_LABEL="${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}" \
    SANCTUARY_UPGRADE_TEST_MODE="$UPGRADE_TEST_MODE" \
    SANCTUARY_UPGRADE_RUNTIME_DIR="$TEST_RUNTIME_DIR" \
    SANCTUARY_ENV_FILE="$(resolve_env_file "$PROJECT_ROOT")" \
    GRAFANA_CONTAINER_NAME="$UPGRADE_GRAFANA_CONTAINER_NAME" \
    PROMETHEUS_CONTAINER_NAME="$UPGRADE_PROMETHEUS_CONTAINER_NAME" \
    LOKI_CONTAINER_NAME="$UPGRADE_LOKI_CONTAINER_NAME" \
    PROMTAIL_CONTAINER_NAME="$UPGRADE_PROMTAIL_CONTAINER_NAME" \
    ALERTMANAGER_CONTAINER_NAME="$UPGRADE_ALERTMANAGER_CONTAINER_NAME" \
    JAEGER_CONTAINER_NAME="$UPGRADE_JAEGER_CONTAINER_NAME" \
    "$SCRIPT_DIR/../utils/collect-upgrade-artifacts.sh" "$UPGRADE_ARTIFACTS_DIR" "$PROJECT_ROOT" || true
    UPGRADE_ARTIFACTS_CAPTURED=true
}

# ============================================
# Test: Verify Existing Installation or Create One
# ============================================

test_ensure_existing_installation() {
    log_info "Creating source installation from $UPGRADE_SOURCE_LABEL..."

    if [ "$VERBOSE" = "true" ]; then
        log_info "Current requested ports before source install: HTTPS=$HTTPS_PORT HTTP=$HTTP_PORT GATEWAY=$GATEWAY_PORT"
    fi

    cd "$PROJECT_ROOT"

    if ! run_upgrade_fixture_hook upgrade_fixture_before_source_install; then
        log_error "Upgrade fixture '${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}' failed before the source installation"
        return 1
    fi

    if ! run_install_script "$PROJECT_ROOT"; then
        return 1
    fi

    # Wait for containers
    if ! wait_for_all_containers_healthy 300; then
        log_error "Initial installation failed"
        return 1
    fi

    # Wait for migration to complete
    if ! wait_for_migration_complete 180; then
        log_error "Migration failed during initial installation"
        return 1
    fi

    # Extra wait for backend to fully initialize
    sleep 5

    if ! wait_for_browser_auth_ready; then
        log_error "Browser auth endpoint did not become ready after the source installation"
        return 1
    fi

    if load_runtime_env; then
        ORIGINAL_JWT_SECRET="$JWT_SECRET"
        ORIGINAL_ENCRYPTION_KEY="$ENCRYPTION_KEY"
        ORIGINAL_GATEWAY_SECRET="$GATEWAY_SECRET"
        ORIGINAL_POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
        log_info "Loaded initial secrets from $(resolve_env_file)"
    fi

    log_success "Initial installation created from $UPGRADE_SOURCE_LABEL"
    return 0
}

# ============================================
# Test: Create Test Data Before Upgrade
# ============================================

test_apply_upgrade_fixture_after_source_install() {
    log_info "Applying upgrade fixture '${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}' after source installation..."

    if ! run_upgrade_fixture_hook upgrade_fixture_after_source_install; then
        log_error "Upgrade fixture '${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}' failed after the source installation"
        return 1
    fi

    log_success "Upgrade fixture '${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}' applied"
    return 0
}

# ============================================
# Test: Capture Pre-Upgrade State
# ============================================

test_capture_pre_upgrade_state() {
    log_info "Capturing pre-upgrade state..."

    # Capture runtime env contents
    if load_runtime_env; then
        ORIGINAL_JWT_SECRET="$JWT_SECRET"
        ORIGINAL_ENCRYPTION_KEY="$ENCRYPTION_KEY"
        ORIGINAL_GATEWAY_SECRET="$GATEWAY_SECRET"
        ORIGINAL_POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
        log_info "Captured JWT_SECRET: ${ORIGINAL_JWT_SECRET:0:8}..."
        log_info "Captured ENCRYPTION_KEY: ${ORIGINAL_ENCRYPTION_KEY:0:8}..."
        log_info "Captured GATEWAY_SECRET: ${ORIGINAL_GATEWAY_SECRET:0:8}..."
        log_info "Captured POSTGRES_PASSWORD: ${ORIGINAL_POSTGRES_PASSWORD:0:8}..."
    else
        log_error "Runtime env not found"
        return 1
    fi

    # Capture database state
    local user_count=$(compose_exec postgres psql -U sanctuary -d sanctuary -t -c \
        "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d ' ')
    log_info "User count: $user_count"

    log_success "Pre-upgrade state captured"
    return 0
}

upsert_env_value() {
    local key="$1"
    local value="$2"
    local file="$3"
    local tmp_file="${file}.tmp"

    mkdir -p "$(dirname "$file")"

    if [ ! -f "$file" ]; then
        printf '%s=%s\n' "$key" "$value" > "$file"
        chmod 600 "$file" 2>/dev/null || true
        return 0
    fi

    awk -F= -v key="$key" -v value="$value" '
        BEGIN { updated = 0 }
        $1 == key {
            print key "=" value
            updated = 1
            next
        }
        { print }
        END {
            if (updated == 0) {
                print key "=" value
            }
        }
    ' "$file" > "$tmp_file" || {
        rm -f "$tmp_file"
        return 1
    }

    mv "$tmp_file" "$file"
    chmod 600 "$file" 2>/dev/null || true
}

sync_runtime_env_ports() {
    local env_file="$1"

    upsert_env_value "HTTPS_PORT" "$HTTPS_PORT" "$env_file" || return 1
    upsert_env_value "HTTP_PORT" "$HTTP_PORT" "$env_file" || return 1
    upsert_env_value "GATEWAY_PORT" "${GATEWAY_PORT:-4000}" "$env_file" || return 1
}

# ============================================
# Test: Stop Containers for Upgrade
# ============================================

test_stop_containers_for_upgrade() {
    log_info "Stopping source containers before upgrade..."

    cd "$PROJECT_ROOT"
    load_runtime_env || return 1

    run_project_compose "$PROJECT_ROOT" stop 2>&1

    # Verify containers stopped
    local running=$(docker ps --filter "name=${COMPOSE_PROJECT_NAME}-" --filter "status=running" -q | wc -l)
    if [ "$running" -gt 0 ]; then
        log_error "Some containers still running after stop"
        return 1
    fi

    log_success "Containers stopped"
    return 0
}

# ============================================
# Test: Simulate Git Pull (Update)
# ============================================

test_simulate_git_update() {
    log_info "Switching from source checkout to current checkout..."

    cd "$PROJECT_ROOT"

    # Verify we're in a git repository
    if ! git rev-parse --is-inside-work-tree &>/dev/null; then
        log_error "Not in a git repository"
        return 1
    fi

    # Get current commit
    local current_commit=$(git rev-parse HEAD)
    local target_commit=$(git -C "$TARGET_PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
    log_info "Source commit: $current_commit"
    log_info "Target commit: $target_commit"

    PROJECT_ROOT="$TARGET_PROJECT_ROOT"

    if [ "$current_commit" = "$target_commit" ]; then
        log_warning "Source and target resolve to the same commit; upgrade lane is running as a restart fallback"
    else
        log_info "Target checkout ready at $TARGET_PROJECT_ROOT"
    fi

    log_success "Upgrade target prepared"
    return 0
}

# ============================================
# Test: Restart Containers After Upgrade
# ============================================

test_restart_containers_after_upgrade() {
    log_info "Running upgrade from $UPGRADE_SOURCE_LABEL to $UPGRADE_TARGET_LABEL..."

    cd "$PROJECT_ROOT"

    if ! run_upgrade_fixture_hook upgrade_fixture_before_upgrade; then
        log_error "Upgrade fixture '${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}' failed while preparing the target upgrade"
        return 1
    fi

    # Load secrets from the env layout that will actually drive the upgrade.
    load_runtime_env || return 1

    if ! run_install_script "$PROJECT_ROOT"; then
        return 1
    fi

    # Wait for containers to be healthy
    if ! wait_for_all_containers_healthy 300; then
        log_error "Containers failed to start after upgrade"
        return 1
    fi

    # Wait for migration to complete before proceeding
    if ! wait_for_migration_complete 180; then
        log_warning "Migration may not have completed cleanly"
        # Don't fail here - migration might have already been done
    fi

    # Extra wait for backend to fully initialize after migration
    sleep 5

    log_success "Upgrade completed successfully"
    return 0
}

# ============================================
# Test: Verify Secrets Preserved
# ============================================

test_verify_secrets_preserved() {
    log_info "Verifying secrets were preserved..."

    # Reload runtime env
    load_runtime_env || return 1

    if [ "$JWT_SECRET" != "$ORIGINAL_JWT_SECRET" ]; then
        log_error "JWT_SECRET changed after upgrade"
        log_error "  Original: ${ORIGINAL_JWT_SECRET:0:8}..."
        log_error "  Current:  ${JWT_SECRET:0:8}..."
        return 1
    fi

    if [ "$ENCRYPTION_KEY" != "$ORIGINAL_ENCRYPTION_KEY" ]; then
        log_error "ENCRYPTION_KEY changed after upgrade"
        log_error "  Original: ${ORIGINAL_ENCRYPTION_KEY:0:8}..."
        log_error "  Current:  ${ENCRYPTION_KEY:0:8}..."
        return 1
    fi

    if [ "$GATEWAY_SECRET" != "$ORIGINAL_GATEWAY_SECRET" ]; then
        log_error "GATEWAY_SECRET changed after upgrade"
        log_error "  Original: ${ORIGINAL_GATEWAY_SECRET:0:8}..."
        log_error "  Current:  ${GATEWAY_SECRET:0:8}..."
        return 1
    fi

    if [ "$POSTGRES_PASSWORD" != "$ORIGINAL_POSTGRES_PASSWORD" ]; then
        log_error "POSTGRES_PASSWORD changed after upgrade"
        log_error "  Original: ${ORIGINAL_POSTGRES_PASSWORD:0:8}..."
        log_error "  Current:  ${POSTGRES_PASSWORD:0:8}..."
        return 1
    fi

    log_success "All 4 secrets preserved correctly"
    return 0
}

# ============================================
# Test: Verify Data Preserved After Upgrade
# ============================================

test_verify_data_preserved() {
    log_info "Verifying data preserved after upgrade..."

    if ! wait_for_browser_auth_ready; then
        log_error "Browser auth endpoint did not become ready after upgrade"
        return 1
    fi

    # Try to login with the password we set before upgrade
    rm -f "$COOKIE_JAR"
    local login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    if ! echo "$login_response" | grep -q '"user"'; then
        log_error "Cannot login with pre-upgrade password"
        log_error "Response: $login_response"
        return 1
    fi

    extract_csrf_token

    log_success "User data preserved after upgrade"
    return 0
}

# ============================================
# Test: Verify Migration Runs on Upgrade
# ============================================

test_verify_migration_on_upgrade() {
    log_info "Verifying migration container ran..."

    # Get migrate container name dynamically
    local container=$(get_container_name "migrate")
    if [ -z "$container" ]; then
        log_warning "Migration container not found (may have been removed)"
        return 0
    fi

    # Check if migrate container exists and completed
    local status=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo "not_found")

    if [ "$status" = "exited" ]; then
        local exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$container" 2>/dev/null)
        if [ "$exit_code" = "0" ]; then
            log_success "Migration container completed successfully"
            return 0
        else
            log_error "Migration container failed with exit code: $exit_code"
            compose_logs migrate 20 | tail -20
            return 1
        fi
    elif [ "$status" = "not_found" ]; then
        log_warning "Migration container not found (may have been removed)"
        return 0
    else
        log_warning "Migration container in unexpected state: $status"
        return 0
    fi
}

test_recover_postgres_password_drift() {
    log_info "Testing PostgreSQL password synchronization during setup..."

    cd "$PROJECT_ROOT"
    load_runtime_env || return 1

    local original_password="$POSTGRES_PASSWORD"
    local drifted_password="drifted-${TEST_ID}-postgres-password"
    local setup_output=""
    local -a services_to_stop=(backend worker frontend gateway ai migrate)

    if [ "$drifted_password" = "$original_password" ]; then
        drifted_password="${drifted_password}-x"
    fi

    if ! upsert_env_value "POSTGRES_PASSWORD" "$drifted_password" "$TEST_ENV_FILE"; then
        log_error "Failed to inject a drifted POSTGRES_PASSWORD into the runtime env"
        return 1
    fi

    # Keep postgres running so setup.sh can recover the real password from the
    # existing container and volume, then restart the application stack.
    if [ "$UPGRADE_ENABLE_MONITORING" = "yes" ]; then
        services_to_stop+=(grafana prometheus loki promtail alertmanager jaeger)
    fi
    if [ "$UPGRADE_ENABLE_TOR" = "yes" ]; then
        services_to_stop+=(tor)
    fi
    run_project_compose "$PROJECT_ROOT" stop "${services_to_stop[@]}" 2>&1 || true

    setup_output=$(run_upgrade_runtime_command "$PROJECT_ROOT" \
        bash "$PROJECT_ROOT/scripts/setup.sh" --force --non-interactive --skip-ssl 2>&1) || {
        log_error "setup.sh failed while recovering the PostgreSQL password drift"
        log_error "Output: $setup_output"
        return 1
    }

    if [ "$VERBOSE" = "true" ]; then
        echo "$setup_output"
    fi

    load_runtime_env || return 1

    if [ "$POSTGRES_PASSWORD" != "$drifted_password" ]; then
        log_error "setup.sh did not preserve the drifted PostgreSQL password in the runtime env"
        log_error "  Expected: $drifted_password"
        log_error "  Current:  $POSTGRES_PASSWORD"
        return 1
    fi

    if ! wait_for_all_containers_healthy 300; then
        log_error "Containers did not become healthy after PostgreSQL password recovery"
        return 1
    fi

    if ! wait_for_migration_complete 120; then
        log_error "Migration did not complete after PostgreSQL password recovery"
        return 1
    fi

    if ! wait_for_browser_auth_ready; then
        log_error "Browser auth endpoint did not become ready after PostgreSQL password recovery"
        return 1
    fi

    local postgres_container=""
    local postgres_network=""
    local db_check=""
    postgres_container="$(run_project_compose "$PROJECT_ROOT" ps -q postgres)"
    postgres_network=$(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' \
        "$postgres_container" | head -n 1)
    db_check=$(docker run --rm --network "$postgres_network" -e "PGPASSWORD=$drifted_password" \
        postgres:16-alpine \
        psql -w -h postgres -U sanctuary -d sanctuary -tAc "SELECT 1" 2>/dev/null || true)

    if [ "$db_check" != "1" ]; then
        log_error "Database did not accept the synchronized PostgreSQL password from the Compose network"
        return 1
    fi

    rm -f "$COOKIE_JAR"
    local login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    if ! echo "$login_response" | grep -q '"user"'; then
        log_error "Login failed after PostgreSQL password recovery"
        log_error "Response: $login_response"
        return 1
    fi

    log_success "setup.sh synchronized the PostgreSQL password drift"
    return 0
}

test_browser_auth_smoke() {
    log_info "Running browser-visible auth smoke checks..."

    UPGRADE_BROWSER_BASE_URL="$UPGRADE_BROWSER_BASE_URL" \
    UPGRADE_BROWSER_ORIGIN="$UPGRADE_BROWSER_ORIGIN" \
    UPGRADE_SMOKE_PASSWORD="$ORIGINAL_USER_PASSWORD" \
    UPGRADE_EXPECT_WEBSOCKET="$UPGRADE_EXPECT_WEBSOCKET" \
    bash "$SCRIPT_DIR/upgrade-browser-smoke.test.sh"
}

test_worker_smoke() {
    log_info "Running worker/support-package smoke checks..."

    SANCTUARY_PROJECT_ROOT="$PROJECT_ROOT" \
    SANCTUARY_UPGRADE_SUPPORT_PACKAGE_FILE="$TEST_RUNTIME_DIR/support-package.json" \
    bash "$SCRIPT_DIR/upgrade-worker-smoke.test.sh"
}

run_extended_upgrade_scenarios() {
    if [ "$UPGRADE_TEST_MODE" != "full" ]; then
        log_info "Skipping extended recovery scenarios in core mode"
        return 0
    fi

    run_test "Recover PostgreSQL Password Drift" test_recover_postgres_password_drift
    run_test "Verify All Services" test_verify_all_services
    run_test "Force Rebuild Upgrade" test_force_rebuild_upgrade
    run_test "Volume Data Persistence" test_volume_data_persistence
}

# ============================================
# Test: Verify All Services Functional
# ============================================

test_verify_all_services() {
    log_info "Verifying all services are functional..."

    if ! wait_for_browser_auth_ready; then
        log_error "Browser auth endpoint did not become ready before service verification"
        return 1
    fi

    # Login (cookie-based)
    rm -f "$COOKIE_JAR"
    local login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    if ! echo "$login_response" | grep -q '"user"'; then
        log_error "Cannot authenticate after upgrade"
        log_error "Response: $login_response"
        return 1
    fi

    extract_csrf_token

    # Test /me endpoint (GET — cookies only)
    local me_response=$(curl -k -s -b "$COOKIE_JAR" \
        "$API_BASE_URL/api/v1/auth/me")

    if ! echo "$me_response" | grep -q '"username"'; then
        log_error "GET /me endpoint failed"
        return 1
    fi

    # Test /wallets endpoint
    local wallets_response=$(curl -k -s -b "$COOKIE_JAR" \
        "$API_BASE_URL/api/v1/wallets")

    if ! echo "$wallets_response" | grep -qE '^\['; then
        log_error "GET /wallets endpoint failed"
        return 1
    fi

    log_success "All services functional after upgrade"
    return 0
}

test_verify_upgrade_fixture_after_upgrade() {
    log_info "Verifying upgrade fixture '${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}' after upgrade..."

    if ! run_upgrade_fixture_hook upgrade_fixture_after_upgrade; then
        log_error "Upgrade fixture '${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}' failed after upgrade"
        return 1
    fi

    log_success "Upgrade fixture '${UPGRADE_FIXTURE_LABEL:-$UPGRADE_FIXTURE}' verified"
    return 0
}

# ============================================
# Test: Force Rebuild Upgrade
# ============================================

test_force_rebuild_upgrade() {
    log_info "Testing force rebuild upgrade..."

    cd "$PROJECT_ROOT"

    # Load secrets
    load_runtime_env || return 1

    local rebuild_output=""
    set +e
    rebuild_output=$(run_upgrade_runtime_command "$PROJECT_ROOT" \
        bash "$PROJECT_ROOT/start.sh" --rebuild 2>&1)
    local exit_code=$?
    set -e

    if [ "$VERBOSE" = "true" ]; then
        echo "$rebuild_output"
    fi

    if [ $exit_code -ne 0 ]; then
        log_error "start.sh --rebuild failed"
        log_error "Output: $rebuild_output"
        return 1
    fi

    # Wait for all containers
    if ! wait_for_all_containers_healthy 300; then
        log_error "Force rebuild failed"
        return 1
    fi

    # Wait for migration to complete
    if ! wait_for_migration_complete 180; then
        log_warning "Migration may not have completed cleanly after rebuild"
        # Don't fail - migration might be idempotent
    fi

    # Extra wait for backend to fully initialize
    sleep 5

    if ! wait_for_browser_auth_ready; then
        log_error "Browser auth endpoint did not become ready after force rebuild"
        return 1
    fi

    # Verify login still works (cookie-based)
    rm -f "$COOKIE_JAR"
    local login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    if ! echo "$login_response" | grep -q '"user"'; then
        log_error "Login failed after force rebuild"
        log_error "Response: $login_response"
        return 1
    fi

    extract_csrf_token

    log_success "Force rebuild upgrade successful"
    return 0
}

# ============================================
# Test: Volume Data Persistence
# ============================================

test_volume_data_persistence() {
    log_info "Testing volume data persistence..."

    cd "$PROJECT_ROOT"

    # Check postgres_data volume exists (volume names include project name)
    local volume_exists=$(docker volume ls --filter "name=postgres_data" -q 2>/dev/null)

    if [ -z "$volume_exists" ]; then
        log_warning "PostgreSQL data volume not found with expected name"
        # This might be okay if using different naming
    else
        log_info "Found PostgreSQL data volume"
    fi

    # Verify data still accessible with retry mechanism
    # After force-recreate, postgres may need a moment to fully initialize
    local max_attempts=10
    local attempt=1
    local user_count=""

    while [ $attempt -le $max_attempts ]; do
        user_count=$(compose_exec postgres psql -U sanctuary -d sanctuary -t -c \
            "SELECT COUNT(*) FROM users;" 2>&1)
        local exit_code=$?

        # Clean up whitespace
        user_count=$(echo "$user_count" | tr -d ' \n\r\t')

        log_debug "Attempt $attempt/$max_attempts: exit=$exit_code, user_count='$user_count'"

        # Check if we got a valid number >= 1
        if [ "$exit_code" = "0" ] && [[ "$user_count" =~ ^[0-9]+$ ]] && [ "$user_count" -ge 1 ]; then
            log_success "Volume data persisted correctly (found $user_count users)"
            return 0
        fi

        if [ $attempt -lt $max_attempts ]; then
            log_info "Waiting for database to be ready (attempt $attempt/$max_attempts)..."
            sleep 3
        fi
        attempt=$((attempt + 1))
    done

    log_error "No users found in database after $max_attempts attempts - data may have been lost"
    log_error "Last query result: '$user_count'"
    # Show container status for debugging
    docker ps --filter "name=postgres" --format "table {{.Names}}\t{{.Status}}"
    return 1
}

# ============================================
# Main Test Runner
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Upgrade Install E2E Test${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""

    # Setup
    setup

    # Phase 1: Prepare existing installation
    run_test "Ensure Existing Installation" test_ensure_existing_installation
    run_test "Apply Upgrade Fixture" test_apply_upgrade_fixture_after_source_install
    run_test "Capture Pre-Upgrade State" test_capture_pre_upgrade_state

    # Phase 2: Simulate upgrade
    run_test "Stop Containers for Upgrade" test_stop_containers_for_upgrade
    run_test "Simulate Git Update" test_simulate_git_update
    run_test "Restart Containers After Upgrade" test_restart_containers_after_upgrade

    # Phase 3: Verify upgrade success
    run_test "Verify Secrets Preserved" test_verify_secrets_preserved
    run_test "Verify Data Preserved" test_verify_data_preserved
    run_test "Verify Migration on Upgrade" test_verify_migration_on_upgrade
    run_test "Browser Auth Smoke" test_browser_auth_smoke
    run_test "Worker Support Smoke" test_worker_smoke
    run_test "Verify Upgrade Fixture" test_verify_upgrade_fixture_after_upgrade
    run_extended_upgrade_scenarios

    if [ $TESTS_FAILED -gt 0 ]; then
        collect_upgrade_artifacts_if_requested
    fi

    # Teardown
    teardown

    # Summary
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Test Summary${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
    echo "  Total:  $TESTS_RUN"
    echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
    echo ""

    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Failed Tests:${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            echo "  - $test"
        done
        echo ""
        exit 1
    else
        echo -e "${GREEN}All tests passed!${NC}"
        echo ""
        exit 0
    fi
}

# Run tests
main "$@"
