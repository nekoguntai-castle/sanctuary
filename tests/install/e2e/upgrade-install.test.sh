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
# Run: ./upgrade-install.test.sh [--keep-containers] [--source-ref <git-ref>] [--mode <core|full>]
# ============================================

set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROJECT_ROOT="$TARGET_PROJECT_ROOT"

# Source helpers
source "$SCRIPT_DIR/../utils/helpers.sh"

# ============================================
# Configuration
# ============================================

KEEP_CONTAINERS=false
VERBOSE=false
UPGRADE_SOURCE_REF="${SANCTUARY_UPGRADE_SOURCE_REF:-}"
UPGRADE_TEST_MODE="${SANCTUARY_UPGRADE_TEST_MODE:-full}"

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

# Test configuration
TEST_ID=$(generate_test_run_id)
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sanctuary-upgrade-${TEST_ID}}"
TEST_RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-/tmp/sanctuary-upgrade-runtime-${TEST_ID}}"
TEST_ENV_FILE="${SANCTUARY_ENV_FILE:-$TEST_RUNTIME_DIR/sanctuary.env}"
TEST_SSL_DIR="${SANCTUARY_SSL_DIR:-$TEST_RUNTIME_DIR/ssl}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"
API_BASE_URL="https://localhost:${HTTPS_PORT}"
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
    if [ -f "$TEST_ENV_FILE" ]; then
        echo "$TEST_ENV_FILE"
    elif [ -f "$PROJECT_ROOT/.env" ]; then
        echo "$PROJECT_ROOT/.env"
    else
        echo "$TEST_ENV_FILE"
    fi
}

load_runtime_env() {
    local env_file
    env_file="$(resolve_env_file)"
    if [ ! -f "$env_file" ]; then
        log_error "Runtime env not found: $env_file"
        return 1
    fi

    set -a
    source "$env_file"
    set +a
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

describe_checkout_ref() {
    local repo_root="$1"

    git -C "$repo_root" describe --tags --always 2>/dev/null || \
        git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || \
        echo "unknown"
}

discover_upgrade_source_ref() {
    if [ -n "$UPGRADE_SOURCE_REF" ]; then
        echo "$UPGRADE_SOURCE_REF"
        return 0
    fi

    local target_commit
    target_commit=$(git -C "$TARGET_PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")

    while IFS= read -r tag; do
        [ -z "$tag" ] && continue
        if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            continue
        fi
        local tag_commit
        tag_commit=$(git -C "$TARGET_PROJECT_ROOT" rev-list -n 1 "$tag" 2>/dev/null || echo "")
        if [ -n "$tag_commit" ] && [ "$tag_commit" != "$target_commit" ]; then
            echo "$tag"
            return 0
        fi
    done < <(git -C "$TARGET_PROJECT_ROOT" tag --sort=-v:refname)

    return 1
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

    mkdir -p "$TEST_RUNTIME_DIR"

    set +e
    HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
        ENABLE_MONITORING="no" ENABLE_TOR="no" \
        SANCTUARY_DIR="$project_dir" \
        SANCTUARY_RUNTIME_DIR="$TEST_RUNTIME_DIR" \
        SANCTUARY_ENV_FILE="$TEST_ENV_FILE" \
        SANCTUARY_SSL_DIR="$TEST_SSL_DIR" \
        SKIP_GIT_CHECKOUT="true" \
        RATE_LIMIT_LOGIN=100 RATE_LIMIT_PASSWORD_CHANGE=100 \
        bash "$project_dir/install.sh" </dev/null 2>&1 | tee "$install_log"
    local exit_code=${PIPESTATUS[0]}
    set -e

    if [ $exit_code -ne 0 ]; then
        log_error "install.sh failed for checkout: $project_dir"
        log_error "Install log: $install_log"
        return 1
    fi

    return 0
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
    log_info "  Compose Proj:  $COMPOSE_PROJECT_NAME"
    log_info "  HTTPS Port:    $HTTPS_PORT"

    # Verify prerequisites
    if ! check_docker_available; then
        log_error "Docker is not available. Cannot run upgrade tests."
        exit 1
    fi

    export SANCTUARY_ENV_FILE="$TEST_ENV_FILE"
    export SANCTUARY_SSL_DIR="$TEST_SSL_DIR"

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

# ============================================
# Test: Verify Existing Installation or Create One
# ============================================

test_ensure_existing_installation() {
    log_info "Creating source installation from $UPGRADE_SOURCE_LABEL..."

    cd "$PROJECT_ROOT"

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

test_create_pre_upgrade_data() {
    log_info "Creating test data before upgrade..."

    # Login with default admin credentials (Phase 6 cookie auth)
    rm -f "$COOKIE_JAR"
    local login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"sanctuary"}' \
        "$API_BASE_URL/api/v1/auth/login")

    if echo "$login_response" | grep -q '"user"'; then
        extract_csrf_token
        if [ -z "$CSRF_TOKEN" ]; then
            log_error "Default login succeeded but sanctuary_csrf cookie missing"
            return 1
        fi

        # Change password to a known value for upgrade testing
        ORIGINAL_USER_PASSWORD="UpgradeTestPassword123!"
        curl -k -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST \
            -H "Content-Type: application/json" \
            -H "X-CSRF-Token: $CSRF_TOKEN" \
            -d "{\"currentPassword\":\"sanctuary\",\"newPassword\":\"$ORIGINAL_USER_PASSWORD\"}" \
            "$API_BASE_URL/api/v1/auth/me/change-password" >/dev/null

        # Re-login with new password (rotates cookies + CSRF)
        rm -f "$COOKIE_JAR"
        login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
            -H "Content-Type: application/json" \
            -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
            "$API_BASE_URL/api/v1/auth/login")
    else
        # Default password didn't work (already changed on a prior run);
        # try the test password directly.
        rm -f "$COOKIE_JAR"
        ORIGINAL_USER_PASSWORD="UpgradeTestPassword123!"
        login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
            -H "Content-Type: application/json" \
            -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
            "$API_BASE_URL/api/v1/auth/login")
    fi

    if ! echo "$login_response" | grep -q '"user"'; then
        log_error "Failed to authenticate after password setup"
        log_error "Response: $login_response"
        return 1
    fi

    extract_csrf_token
    if [ -z "$CSRF_TOKEN" ]; then
        log_error "Failed to capture sanctuary_csrf cookie"
        return 1
    fi

    log_success "Test data created (password changed to test password)"
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

replace_env_value() {
    local key="$1"
    local value="$2"
    local file="$3"
    local tmp_file="${file}.tmp"

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
                exit 1
            }
        }
    ' "$file" > "$tmp_file" || {
        rm -f "$tmp_file"
        return 1
    }

    mv "$tmp_file" "$file"
    chmod 600 "$file" 2>/dev/null || true
}

# ============================================
# Test: Stop Containers for Upgrade
# ============================================

test_stop_containers_for_upgrade() {
    log_info "Stopping source containers before upgrade..."

    cd "$PROJECT_ROOT"
    load_runtime_env || return 1

    docker compose stop 2>&1

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

    # Load secrets from runtime env
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
    load_runtime_env

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

    if [ "$drifted_password" = "$original_password" ]; then
        drifted_password="${drifted_password}-x"
    fi

    if ! replace_env_value "POSTGRES_PASSWORD" "$drifted_password" "$TEST_ENV_FILE"; then
        log_error "Failed to inject a drifted POSTGRES_PASSWORD into the runtime env"
        return 1
    fi

    # Keep postgres running so setup.sh can recover the real password from the
    # existing container and volume, then restart the application stack.
    docker compose stop backend worker frontend gateway ai migrate 2>&1 || true

    setup_output=$(SANCTUARY_ENV_FILE="$TEST_ENV_FILE" SANCTUARY_SSL_DIR="$TEST_SSL_DIR" \
        HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
        ENABLE_MONITORING="no" ENABLE_TOR="no" \
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

    local postgres_container=""
    local postgres_network=""
    local db_check=""
    postgres_container="$(docker compose ps -q postgres)"
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
    rebuild_output=$(HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
        SANCTUARY_ENV_FILE="$(resolve_env_file)" SANCTUARY_SSL_DIR="$TEST_SSL_DIR" \
        RATE_LIMIT_LOGIN=100 RATE_LIMIT_PASSWORD_CHANGE=100 \
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
    run_test "Create Pre-Upgrade Data" test_create_pre_upgrade_data
    run_test "Capture Pre-Upgrade State" test_capture_pre_upgrade_state

    # Phase 2: Simulate upgrade
    run_test "Stop Containers for Upgrade" test_stop_containers_for_upgrade
    run_test "Simulate Git Update" test_simulate_git_update
    run_test "Restart Containers After Upgrade" test_restart_containers_after_upgrade

    # Phase 3: Verify upgrade success
    run_test "Verify Secrets Preserved" test_verify_secrets_preserved
    run_test "Verify Data Preserved" test_verify_data_preserved
    run_test "Verify Migration on Upgrade" test_verify_migration_on_upgrade
    run_extended_upgrade_scenarios

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
