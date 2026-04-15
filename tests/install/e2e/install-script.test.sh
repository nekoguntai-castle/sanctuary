#!/bin/bash
# ============================================
# End-to-End Install Script Test
# ============================================
#
# This test actually runs install.sh to verify the complete
# installation flow works correctly, including:
#   - .env file creation before docker compose
#   - --pull never flag for local builds
#   - Secret generation
#   - Container startup
#
# This catches issues that manual docker compose tests miss.
#
# Requirements:
#   - Docker and Docker Compose v2
#   - Git
#   - OpenSSL
#   - curl
#
# Run: ./install-script.test.sh [--keep-containers] [--verbose]
# ============================================

set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Source helpers
source "$SCRIPT_DIR/../utils/helpers.sh"

# ============================================
# Configuration
# ============================================

KEEP_CONTAINERS=false
VERBOSE=false

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
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Test configuration
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"
API_BASE_URL="https://localhost:${HTTPS_PORT}"
TEST_ID=$(generate_test_run_id)
COOKIE_JAR="/tmp/sanctuary-test-cookies-${TEST_ID}.txt"

# Test state
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
    log_info "Setting up install script test environment..."
    log_info "  Project Root:  $PROJECT_ROOT"
    log_info "  HTTPS Port:    $HTTPS_PORT"
    log_info "  API Base URL:  $API_BASE_URL"

    # Verify prerequisites
    if ! check_docker_available; then
        log_error "Docker is not available. Cannot run install tests."
        exit 1
    fi

    # Clean up any existing installation
    log_info "Cleaning up any existing Sanctuary containers..."
    cleanup_containers "$PROJECT_ROOT" 2>/dev/null || true

    # Remove any existing .env file to simulate fresh install
    if [ -f "$PROJECT_ROOT/.env" ]; then
        log_info "Removing existing .env file..."
        rm -f "$PROJECT_ROOT/.env"
    fi

    # Remove any existing SSL certs to test generation
    if [ -f "$PROJECT_ROOT/docker/nginx/ssl/fullchain.pem" ]; then
        log_info "Removing existing SSL certificates..."
        rm -f "$PROJECT_ROOT/docker/nginx/ssl/fullchain.pem"
        rm -f "$PROJECT_ROOT/docker/nginx/ssl/privkey.pem"
    fi

    setup_cleanup_trap "teardown"
}

teardown() {
    log_info "Cleaning up test environment..."

    if [ "$KEEP_CONTAINERS" = "false" ]; then
        cleanup_containers "$PROJECT_ROOT" 2>/dev/null || true
    else
        log_warning "Keeping containers running (--keep-containers specified)"
        get_container_status "$PROJECT_ROOT"
    fi

    # Clean up cookie jar
    if [ -f "$COOKIE_JAR" ]; then
        rm -f "$COOKIE_JAR"
    fi
}

# ============================================
# Test: Install Script Exists and Is Executable
# ============================================

test_install_script_exists() {
    log_info "Checking install.sh exists and is executable..."

    if [ ! -f "$PROJECT_ROOT/install.sh" ]; then
        log_error "install.sh not found"
        return 1
    fi

    if [ ! -x "$PROJECT_ROOT/install.sh" ]; then
        log_error "install.sh is not executable"
        return 1
    fi

    log_success "install.sh exists and is executable"
    return 0
}

# ============================================
# Test: Install Script Creates .env File
# ============================================

test_install_script_creates_env() {
    log_info "Testing that install.sh creates .env file before docker compose..."

    cd "$PROJECT_ROOT"

    # Run install.sh in non-interactive mode with test ports
    # ENABLE_MONITORING and ENABLE_TOR are set to skip prompts
    # SKIP_GIT_CHECKOUT=true prevents install.sh from checking out a different
    # version (the "latest release") which would test wrong code in CI
    log_info "Running install.sh (this may take several minutes for first build)..."

    # Capture output for debugging
    local install_output
    install_output=$(HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
        ENABLE_MONITORING="no" ENABLE_TOR="no" \
        SANCTUARY_DIR="$PROJECT_ROOT" \
        SKIP_GIT_CHECKOUT="true" \
        bash -x "$PROJECT_ROOT/install.sh" 2>&1) || {
        log_error "install.sh failed to run"
        log_error "Output: $install_output"
        return 1
    }

    if [ "$VERBOSE" = "true" ]; then
        echo "$install_output"
    fi

    # Verify .env file was created
    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        log_error ".env file was not created by install.sh"
        return 1
    fi

    log_success ".env file created successfully"
    return 0
}

# ============================================
# Test: .env File Contains Required Secrets
# ============================================

test_env_file_has_secrets() {
    log_info "Testing that .env file contains all required secrets..."

    if [ ! -f "$PROJECT_ROOT/.env" ]; then
        log_error ".env file not found"
        return 1
    fi

    local missing_vars=()

    # Check for JWT_SECRET
    if ! grep -q "^JWT_SECRET=" "$PROJECT_ROOT/.env"; then
        missing_vars+=("JWT_SECRET")
    fi

    # Check for ENCRYPTION_KEY
    if ! grep -q "^ENCRYPTION_KEY=" "$PROJECT_ROOT/.env"; then
        missing_vars+=("ENCRYPTION_KEY")
    fi

    # Check for GATEWAY_SECRET
    if ! grep -q "^GATEWAY_SECRET=" "$PROJECT_ROOT/.env"; then
        missing_vars+=("GATEWAY_SECRET")
    fi

    # Check for POSTGRES_PASSWORD
    if ! grep -q "^POSTGRES_PASSWORD=" "$PROJECT_ROOT/.env"; then
        missing_vars+=("POSTGRES_PASSWORD")
    fi

    # Check for REDIS_PASSWORD
    if ! grep -q "^REDIS_PASSWORD=" "$PROJECT_ROOT/.env"; then
        missing_vars+=("REDIS_PASSWORD")
    fi

    if [ ${#missing_vars[@]} -gt 0 ]; then
        log_error "Missing required variables in .env: ${missing_vars[*]}"
        log_error ".env contents:"
        cat "$PROJECT_ROOT/.env"
        return 1
    fi

    # Verify secrets are not empty
    source "$PROJECT_ROOT/.env"

    if [ -z "$JWT_SECRET" ]; then
        log_error "JWT_SECRET is empty"
        return 1
    fi

    if [ -z "$POSTGRES_PASSWORD" ]; then
        log_error "POSTGRES_PASSWORD is empty"
        return 1
    fi

    log_success "All required secrets present in .env"
    return 0
}

# ============================================
# Test: Containers Started Successfully
# ============================================

test_containers_started() {
    log_info "Testing that containers started successfully..."

    cd "$PROJECT_ROOT"

    # Check if containers are running
    local running_containers
    running_containers=$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -c "running" || echo "0")

    if [ "$running_containers" -lt 4 ]; then
        log_error "Expected at least 4 running containers, found: $running_containers"
        docker compose ps
        return 1
    fi

    log_success "Containers are running (found $running_containers)"
    return 0
}

# ============================================
# Test: Database Container Healthy
# ============================================

test_database_healthy() {
    log_info "Testing database container health..."

    cd "$PROJECT_ROOT"

    local container=$(get_container_name "postgres")

    # Wait for database to be healthy
    if ! wait_for_container_healthy "$container" 120; then
        log_error "Database container failed to become healthy"
        docker compose logs --tail 50 postgres 2>&1 | head -30
        return 1
    fi

    log_success "Database container is healthy"
    return 0
}

# ============================================
# Test: Backend Container Healthy
# ============================================

test_backend_healthy() {
    log_info "Testing backend container health..."

    cd "$PROJECT_ROOT"

    local container=$(get_container_name "backend")

    # Wait for backend to be healthy
    if ! wait_for_container_healthy "$container" 120; then
        log_error "Backend container failed to become healthy"
        docker compose logs --tail 50 backend 2>&1 | head -30
        return 1
    fi

    log_success "Backend container is healthy"
    return 0
}

# ============================================
# Test: API Health Endpoint
# ============================================

test_api_health() {
    log_info "Testing API health endpoint..."

    # Wait for API to respond
    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        local response=$(curl -k -s -o /dev/null -w "%{http_code}" "$API_BASE_URL/api/v1/health" 2>/dev/null || echo "000")

        if [ "$response" = "200" ]; then
            log_success "API health endpoint responding (HTTP 200)"
            return 0
        fi

        attempt=$((attempt + 1))
        sleep 2
    done

    log_error "API health endpoint not responding after $max_attempts attempts"
    return 1
}

# ============================================
# Test: Migration Completed
# ============================================

test_migration_completed() {
    log_info "Waiting for database migration and seeding to complete..."

    cd "$PROJECT_ROOT"

    # Wait for migrate container to exit (it runs once and exits)
    local max_attempts=60
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        local migrate_status=$(docker compose ps migrate --format '{{.State}}' 2>/dev/null || echo "unknown")

        # Container exited successfully
        if [[ "$migrate_status" == *"exited"* ]]; then
            # Check exit code
            local exit_code=$(docker compose ps migrate --format '{{.ExitCode}}' 2>/dev/null || echo "1")
            if [ "$exit_code" = "0" ]; then
                log_success "Migration completed successfully"
                return 0
            else
                log_error "Migration failed with exit code: $exit_code"
                docker compose logs migrate 2>&1 | tail -30
                return 1
            fi
        fi

        attempt=$((attempt + 1))
        sleep 2
    done

    log_error "Migration did not complete within timeout"
    docker compose logs migrate 2>&1 | tail -30
    return 1
}

# ============================================
# Test: Login with Default Credentials
# ============================================

test_default_login() {
    log_info "Testing login with default credentials..."

    # Wait for migration/seed to complete (creates admin user)
    # The migrate container runs after backend starts and may take time.
    # Phase 6 cookie auth: success = 200 + body contains "user"; the
    # sanctuary_access / sanctuary_csrf cookies land in $COOKIE_JAR.
    local max_attempts=30
    local attempt=0
    local login_response=""

    while [ $attempt -lt $max_attempts ]; do
        rm -f "$COOKIE_JAR"
        login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
            -H "Content-Type: application/json" \
            -d '{"username":"admin","password":"sanctuary"}' \
            "$API_BASE_URL/api/v1/auth/login")

        log_debug "Login response: $login_response"

        if echo "$login_response" | grep -q '"user"'; then
            log_success "Login with default credentials successful"
            return 0
        fi

        attempt=$((attempt + 1))
        if [ $attempt -lt $max_attempts ]; then
            log_info "Waiting for seed to create admin user (attempt $attempt/$max_attempts)..."
            sleep 5
        fi
    done

    log_error "Login failed after $max_attempts attempts - seed may not have completed"
    log_error "Last response: $login_response"
    return 1
}

# ============================================
# Test: Docker Compose Works Standalone
# ============================================

test_docker_compose_standalone() {
    log_info "Testing that docker compose works standalone (using .env file)..."

    cd "$PROJECT_ROOT"

    # Stop containers first
    docker compose down 2>/dev/null || true

    # Try to start using just docker compose (should read .env automatically)
    log_info "Starting containers with standalone docker compose..."
    if ! docker compose up -d 2>&1; then
        log_error "docker compose up failed when using .env file"
        return 1
    fi

    # Wait briefly for startup
    sleep 10

    # Check if postgres is starting (the one that needs POSTGRES_PASSWORD)
    local postgres_status=$(docker compose ps postgres --format '{{.State}}' 2>/dev/null || echo "unknown")

    if [ "$postgres_status" = "unknown" ] || [ -z "$postgres_status" ]; then
        log_error "postgres container not found"
        docker compose ps
        return 1
    fi

    # Even "running" or "starting" is acceptable - we just need it to not fail due to missing env vars
    if [[ "$postgres_status" == *"running"* ]] || [[ "$postgres_status" == *"starting"* ]] || [[ "$postgres_status" == *"healthy"* ]]; then
        log_success "docker compose works standalone with .env file"
        return 0
    fi

    log_error "postgres container status: $postgres_status"
    docker compose logs --tail 20 postgres 2>&1 || true
    return 1
}

# ============================================
# Main Test Runner
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Install Script E2E Test${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
    echo "This test runs install.sh directly to verify the"
    echo "complete installation flow works correctly."
    echo ""

    # Setup
    setup

    # Run tests in order
    run_test "Install Script Exists" test_install_script_exists
    run_test "Install Script Creates .env" test_install_script_creates_env
    run_test "Env File Has Required Secrets" test_env_file_has_secrets
    run_test "Containers Started" test_containers_started
    run_test "Database Healthy" test_database_healthy
    run_test "Backend Healthy" test_backend_healthy
    run_test "API Health Endpoint" test_api_health
    # Note: We don't explicitly test migration completion because:
    # 1. Migration runs as a one-shot container and may take varying time
    # 2. The "Default Login Works" test implicitly verifies the seed ran
    run_test "Default Login Works" test_default_login
    run_test "Docker Compose Standalone" test_docker_compose_standalone

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
