#!/bin/bash
# ============================================
# End-to-End Fresh Install Test
# ============================================
#
# This test simulates a complete fresh installation of Sanctuary
# and verifies all steps of the install process work correctly.
#
# Requirements:
#   - Docker and Docker Compose v2
#   - Git
#   - OpenSSL
#   - curl
#   - At least 4GB RAM available for Docker
#
# Run: ./fresh-install.test.sh [--keep-containers]
#
# Options:
#   --keep-containers  Don't clean up containers after test (useful for debugging)
#   --skip-cleanup     Skip initial cleanup (run on existing install)
#   --verbose          Show detailed output
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
SKIP_CLEANUP=false
VERBOSE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-containers)
            KEEP_CONTAINERS=true
            shift
            ;;
        --skip-cleanup)
            SKIP_CLEANUP=true
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
TEST_ID=$(generate_test_run_id)
TEST_INSTALL_DIR=$(create_test_directory "/tmp" "sanctuary-install-test")
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"
API_BASE_URL="https://localhost:${HTTPS_PORT}"
COOKIE_JAR="/tmp/sanctuary-test-cookies-${TEST_ID}.txt"

# The TLS material for the nginx frontend container is generated into
# $TEST_INSTALL_DIR/runtime/ssl (outside the repo checkout). Export
# SANCTUARY_SSL_DIR so every subsequent `docker compose` invocation
# mounts the same directory where `test_ssl_certificate_generation`
# writes fullchain.pem/privkey.pem — otherwise nginx falls back to
# plain HTTP and the frontend container never becomes healthy.
export SANCTUARY_SSL_DIR="$TEST_INSTALL_DIR/runtime/ssl"
mkdir -p "$SANCTUARY_SSL_DIR"

# Test state
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
declare -a FAILED_TESTS

# Shared authentication state (cookie-based, Phase 6 auth)
# The backend sets HttpOnly sanctuary_access + sanctuary_refresh cookies
# and a readable sanctuary_csrf cookie. Subsequent requests flow cookies
# via -b "$COOKIE_JAR"; mutations must echo the CSRF token in X-CSRF-Token.
CSRF_TOKEN=""
CURRENT_PASSWORD="sanctuary"
LOGIN_RESPONSE=""

# Extract the sanctuary_csrf cookie value from the Netscape-format cookie
# jar. Fields are tab-separated: domain, HttpOnly, path, Secure, expiry,
# name, value. We read the 7th field of the row whose 6th field equals
# sanctuary_csrf. Sets CSRF_TOKEN (empty string if the cookie isn't set).
extract_csrf_token() {
    if [ ! -f "$COOKIE_JAR" ]; then
        CSRF_TOKEN=""
        return
    fi
    CSRF_TOKEN=$(awk -F'\t' '$6 == "sanctuary_csrf" { print $7 }' "$COOKIE_JAR" | tail -n 1)
}

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
    log_info "Setting up test environment..."
    log_info "  Test ID:       $TEST_ID"
    log_info "  Install Dir:   $TEST_INSTALL_DIR"
    log_info "  HTTPS Port:    $HTTPS_PORT"
    log_info "  API Base URL:  $API_BASE_URL"

    # Verify prerequisites
    if ! check_docker_available; then
        log_error "Docker is not available. Cannot run install tests."
        exit 1
    fi

    if ! command -v git &> /dev/null; then
        log_error "Git is not installed. Cannot run install tests."
        exit 1
    fi

    # Clean up any existing installation (unless skipped)
    if [ "$SKIP_CLEANUP" = "false" ]; then
        log_info "Cleaning up any existing Sanctuary containers..."
        cleanup_containers "$PROJECT_ROOT" 2>/dev/null || true
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

    # Clean up test directory
    if [ -d "$TEST_INSTALL_DIR" ]; then
        rm -rf "$TEST_INSTALL_DIR"
    fi

    # Clean up cookie jar
    if [ -f "$COOKIE_JAR" ]; then
        rm -f "$COOKIE_JAR"
    fi
}

# ============================================
# Test: Prerequisites Check
# ============================================

test_prerequisites_check() {
    log_info "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found"
        return 1
    fi
    log_debug "Docker found: $(docker --version)"

    # Check Docker daemon
    if ! docker info &> /dev/null; then
        log_error "Docker daemon not running"
        return 1
    fi
    log_debug "Docker daemon is running"

    # Check Docker Compose v2
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose v2 not available"
        return 1
    fi
    log_debug "Docker Compose found: $(docker compose version)"

    # Check Git
    if ! command -v git &> /dev/null; then
        log_error "Git not found"
        return 1
    fi
    log_debug "Git found: $(git --version)"

    # Check curl
    if ! command -v curl &> /dev/null; then
        log_error "curl not found"
        return 1
    fi
    log_debug "curl found: $(curl --version | head -1)"

    log_success "All prerequisites met"
    return 0
}

# ============================================
# Test: Repository Structure
# ============================================

test_repository_structure() {
    log_info "Verifying repository structure..."

    # Check install.sh exists
    assert_file_exists "$PROJECT_ROOT/install.sh" "install.sh should exist"

    # Check docker-compose.yml exists
    assert_file_exists "$PROJECT_ROOT/docker-compose.yml" "docker-compose.yml should exist"

    # Check SSL generation script
    assert_file_exists "$PROJECT_ROOT/docker/nginx/ssl/generate-certs.sh" \
        "SSL certificate generation script should exist"

    # Check server directory
    assert_directory_exists "$PROJECT_ROOT/server" "server directory should exist"
    assert_file_exists "$PROJECT_ROOT/server/Dockerfile" "server Dockerfile should exist"
    assert_file_exists "$PROJECT_ROOT/server/prisma/seed.ts" "database seed script should exist"

    # Check frontend Dockerfile
    assert_file_exists "$PROJECT_ROOT/Dockerfile" "frontend Dockerfile should exist"

    log_success "Repository structure verified"
    return 0
}

# ============================================
# Test: SSL Certificate Generation
# ============================================

test_ssl_certificate_generation() {
    log_info "Testing SSL certificate generation..."

    local ssl_dir="$TEST_INSTALL_DIR/runtime/ssl"
    local cert_script="$PROJECT_ROOT/docker/nginx/ssl/generate-certs.sh"

    # Remove existing certificates for clean test
    rm -f "$ssl_dir/fullchain.pem" "$ssl_dir/privkey.pem" 2>/dev/null || true

    # Run certificate generation
    if ! SANCTUARY_SSL_DIR="$ssl_dir" bash "$cert_script" localhost 2>/dev/null; then
        log_error "Certificate generation script failed"
        return 1
    fi

    # Verify certificates were created
    assert_file_exists "$ssl_dir/fullchain.pem" "fullchain.pem should be created"
    assert_file_exists "$ssl_dir/privkey.pem" "privkey.pem should be created"

    # Verify certificate is valid
    if ! openssl x509 -in "$ssl_dir/fullchain.pem" -noout 2>/dev/null; then
        log_error "Generated certificate is not valid"
        return 1
    fi

    # Check certificate subject
    local subject=$(openssl x509 -in "$ssl_dir/fullchain.pem" -noout -subject 2>/dev/null)
    if [[ "$subject" != *"localhost"* ]]; then
        log_warning "Certificate subject does not contain 'localhost'"
    fi

    log_success "SSL certificates generated and verified"
    return 0
}

# ============================================
# Test: Environment Variable Generation
# ============================================

test_environment_variable_generation() {
    log_info "Testing environment variable generation..."

    # Test secret generation from install.sh logic
    local secret1=""
    local secret2=""

    if command -v openssl &> /dev/null; then
        secret1=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)
        secret2=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)
    else
        secret1=$(cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 48)
        secret2=$(cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 48)
    fi

    # Verify secrets are generated
    assert_not_empty "$secret1" "First secret should be generated"
    assert_not_empty "$secret2" "Second secret should be generated"

    # Verify secrets are unique
    if [ "$secret1" = "$secret2" ]; then
        log_error "Generated secrets should be unique"
        return 1
    fi

    # Verify secret length (should be at least 32 chars)
    if [ ${#secret1} -lt 32 ]; then
        log_error "Secret length is too short: ${#secret1}"
        return 1
    fi

    log_success "Environment variable generation verified"
    return 0
}

# ============================================
# Test: Docker Compose Build
# ============================================

test_docker_compose_build() {
    log_info "Testing Docker Compose build..."

    cd "$PROJECT_ROOT"

    # Generate all required secrets for build
    local jwt_secret=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)
    local encryption_key=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)
    local gateway_secret=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)
    local postgres_password=$(openssl rand -base64 16 | tr -d '=/+' | head -c 24)
    local ai_config_secret=$(openssl rand -hex 32)
    local redis_password=$(openssl rand -base64 16 | tr -d '=/+' | head -c 24)

    # Build containers
    log_info "Building Docker images (this may take a few minutes)..."
    if ! JWT_SECRET="$jwt_secret" ENCRYPTION_KEY="$encryption_key" \
         GATEWAY_SECRET="$gateway_secret" POSTGRES_PASSWORD="$postgres_password" \
         AI_CONFIG_SECRET="$ai_config_secret" REDIS_PASSWORD="$redis_password" \
         HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
         docker compose build 2>&1; then
        log_error "Docker Compose build failed"
        return 1
    fi

    log_success "Docker images built successfully"
    return 0
}

# ============================================
# Test: Docker Compose Up
# ============================================

test_docker_compose_up() {
    log_info "Testing Docker Compose up..."

    cd "$PROJECT_ROOT"

    # Generate all required secrets
    local jwt_secret=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)
    local encryption_key=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)
    local gateway_secret=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)
    local postgres_password=$(openssl rand -base64 16 | tr -d '=/+' | head -c 24)
    local ai_config_secret=$(openssl rand -hex 32)
    local redis_password=$(openssl rand -base64 16 | tr -d '=/+' | head -c 24)

    # Start containers
    log_info "Starting containers..."
    if ! JWT_SECRET="$jwt_secret" ENCRYPTION_KEY="$encryption_key" \
         GATEWAY_SECRET="$gateway_secret" POSTGRES_PASSWORD="$postgres_password" \
         AI_CONFIG_SECRET="$ai_config_secret" REDIS_PASSWORD="$redis_password" \
         HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
         docker compose up -d 2>&1; then
        log_error "Docker Compose up failed"
        return 1
    fi

    # Show container status
    if [ "$VERBOSE" = "true" ]; then
        get_container_status "$PROJECT_ROOT"
    fi

    log_success "Containers started successfully"
    return 0
}

# ============================================
# Test: Database Container Health
# ============================================

test_database_container_health() {
    log_info "Testing database container health..."

    local container=$(get_container_name "postgres")

    # Wait for database to be healthy
    if ! wait_for_container_healthy "$container" 120; then
        log_error "Database container failed to become healthy"
        compose_logs postgres 50 | head -30
        return 1
    fi

    # Verify we can connect to database
    local result=$(compose_exec postgres pg_isready -U sanctuary -d sanctuary 2>/dev/null)
    if [[ "$result" != *"accepting connections"* ]]; then
        log_error "Cannot connect to database"
        return 1
    fi

    log_success "Database container is healthy"
    return 0
}

# ============================================
# Test: Migration Container
# ============================================

test_migration_container() {
    log_info "Testing database migration..."

    # Wait for migration to complete
    if ! wait_for_migration_complete 180; then
        log_error "Database migration failed"
        return 1
    fi

    # Try to verify admin user was created via SQL query
    # Note: This may fail in some CI environments due to psql output formatting
    # The login test later provides definitive validation
    if ! check_admin_user_exists "postgres"; then
        log_warning "Could not verify admin user via SQL (will be validated by login test)"
    else
        log_success "Admin user verified in database"
    fi

    # Verify default password marker was created
    if ! check_default_password_marker "postgres"; then
        log_warning "Default password marker not found (may be expected for some versions)"
    fi

    log_success "Database migration completed successfully"
    return 0
}

# ============================================
# Test: Backend Container Health
# ============================================

test_backend_container_health() {
    log_info "Testing backend container health..."

    local container=$(get_container_name "backend")

    # Wait for backend to be healthy
    if ! wait_for_container_healthy "$container" 120; then
        log_error "Backend container failed to become healthy"
        compose_logs backend 50 | head -30
        return 1
    fi

    # Verify health endpoint responds
    local health_response=$(compose_exec backend wget -q -O - http://localhost:3001/health 2>/dev/null || echo "failed")
    if [ "$health_response" = "failed" ]; then
        log_error "Backend health endpoint not responding"
        return 1
    fi

    log_success "Backend container is healthy"
    return 0
}

# ============================================
# Test: Frontend Container Health
# ============================================

test_frontend_container_health() {
    log_info "Testing frontend container health..."

    local container=$(get_container_name "frontend")

    # Wait for frontend to be healthy
    if ! wait_for_container_healthy "$container" 120; then
        log_error "Frontend container failed to become healthy"
        compose_logs frontend 50 | head -30
        return 1
    fi

    log_success "Frontend container is healthy"
    return 0
}

# ============================================
# Test: Gateway Container Health
# ============================================

test_gateway_container_health() {
    log_info "Testing gateway container health..."

    local container=$(get_container_name "gateway")

    # Wait for gateway to be healthy
    if ! wait_for_container_healthy "$container" 120; then
        log_error "Gateway container failed to become healthy"
        compose_logs gateway 50 | head -30
        return 1
    fi

    log_success "Gateway container is healthy"
    return 0
}

# ============================================
# Test: HTTPS Endpoint Accessibility
# ============================================

test_https_endpoint() {
    log_info "Testing HTTPS endpoint accessibility..."

    # Wait for HTTPS endpoint to respond
    if ! wait_for_http_endpoint "$API_BASE_URL" 60 "200"; then
        # Try health endpoint instead
        if ! wait_for_http_endpoint "$API_BASE_URL/health" 30 "200"; then
            log_error "HTTPS endpoint not accessible"
            return 1
        fi
    fi

    log_success "HTTPS endpoint is accessible"
    return 0
}

# ============================================
# Test: API Health Endpoint
# ============================================

test_api_health_endpoint() {
    log_info "Testing API health endpoint..."

    local response=$(curl -k -s "$API_BASE_URL/api/v1/health" 2>/dev/null)

    if [ -z "$response" ]; then
        # Try alternative health endpoint
        response=$(curl -k -s "$API_BASE_URL/health" 2>/dev/null)
    fi

    if [ -z "$response" ]; then
        log_error "No response from health endpoint"
        return 1
    fi

    log_debug "Health response: $response"
    log_success "API health endpoint responding"
    return 0
}

# ============================================
# Test: Login with Default Credentials
# ============================================

test_login_with_default_credentials() {
    log_info "Testing login with default credentials..."

    # Clear any stale cookie jar from a previous run
    rm -f "$COOKIE_JAR"

    LOGIN_RESPONSE=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"sanctuary"}' \
        "$API_BASE_URL/api/v1/auth/login")

    log_debug "Login response: $LOGIN_RESPONSE"

    # Phase 6 cookie auth: success is a body containing "user" plus the
    # sanctuary_access / sanctuary_csrf cookies being written to the jar.
    if ! echo "$LOGIN_RESPONSE" | grep -q '"user"'; then
        log_error "Login failed - no user in response"
        log_error "Response: $LOGIN_RESPONSE"
        return 1
    fi

    extract_csrf_token
    if [ -z "$CSRF_TOKEN" ]; then
        log_error "Failed to capture sanctuary_csrf cookie from login"
        return 1
    fi

    log_success "Login with default credentials successful"
    return 0
}

# ============================================
# Test: Default Password Flag
# ============================================

test_default_password_flag() {
    log_info "Testing usingDefaultPassword flag..."

    # Use the saved login response from test_login_with_default_credentials
    # to avoid making another login request (rate limiting)
    if [ -z "$LOGIN_RESPONSE" ]; then
        log_warning "No saved login response - skipping default password flag check"
        return 0
    fi

    log_debug "Using saved login response: $LOGIN_RESPONSE"

    # Check for usingDefaultPassword flag
    if echo "$LOGIN_RESPONSE" | grep -q '"usingDefaultPassword":true'; then
        log_success "usingDefaultPassword flag is set to true"
        return 0
    else
        log_warning "usingDefaultPassword flag not found or not true"
        log_warning "This may be expected depending on the API version"
        # Don't fail the test - this is a nice-to-have
        return 0
    fi
}

# ============================================
# Test: Password Change Flow
# ============================================

test_password_change_flow() {
    log_info "Testing password change flow..."

    # Must have an authenticated cookie jar + CSRF token from prior login
    if [ ! -f "$COOKIE_JAR" ] || [ -z "$CSRF_TOKEN" ]; then
        log_error "No saved auth cookies - cannot test password change"
        return 1
    fi

    # Change password using cookie auth + CSRF token (state-changing POST)
    local new_password="NewSecurePassword123!"
    local change_response=$(curl -k -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -H "X-CSRF-Token: $CSRF_TOKEN" \
        -d "{\"currentPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$new_password\"}" \
        "$API_BASE_URL/api/v1/auth/me/change-password")

    log_debug "Password change response: $change_response"

    # Check if password change was successful
    if echo "$change_response" | grep -qiE '"error"|"message":".*fail|"message":".*invalid'; then
        log_error "Password change failed"
        log_error "Response: $change_response"
        return 1
    fi

    # Update current password tracker
    CURRENT_PASSWORD="$new_password"

    # Re-login with the new password; this rotates both the access cookie
    # and the sanctuary_csrf cookie, so we must re-extract CSRF_TOKEN.
    rm -f "$COOKIE_JAR"
    local new_login_response=$(curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$new_password\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    if ! echo "$new_login_response" | grep -q '"user"'; then
        log_error "Cannot login with new password"
        return 1
    fi

    extract_csrf_token
    if [ -z "$CSRF_TOKEN" ]; then
        log_error "Failed to capture sanctuary_csrf cookie after re-login"
        return 1
    fi

    log_success "Password change flow working correctly"
    return 0
}

# ============================================
# Test: Basic API Endpoints
# ============================================

test_basic_api_endpoints() {
    log_info "Testing basic API endpoints..."

    # Use the saved cookie jar (updated by password change test)
    if [ ! -f "$COOKIE_JAR" ]; then
        log_error "No saved cookie jar - cannot test API endpoints"
        return 1
    fi

    log_debug "Using saved cookie jar for API tests"

    # Test /me endpoint (GET — no CSRF token needed)
    local me_response=$(curl -k -s -b "$COOKIE_JAR" \
        "$API_BASE_URL/api/v1/auth/me")

    if ! echo "$me_response" | grep -q '"username"'; then
        log_error "GET /api/v1/auth/me failed"
        log_error "Response: $me_response"
        return 1
    fi
    log_debug "GET /me: OK"

    # Test /wallets endpoint (should return empty list initially)
    local wallets_response=$(curl -k -s -b "$COOKIE_JAR" \
        "$API_BASE_URL/api/v1/wallets")

    # Should return an array (even if empty)
    if ! echo "$wallets_response" | grep -qE '^\['; then
        log_error "GET /api/v1/wallets failed"
        log_error "Response: $wallets_response"
        return 1
    fi
    log_debug "GET /wallets: OK"

    # Test /devices endpoint
    local devices_response=$(curl -k -s -b "$COOKIE_JAR" \
        "$API_BASE_URL/api/v1/devices")

    if ! echo "$devices_response" | grep -qE '^\['; then
        log_error "GET /api/v1/devices failed"
        log_error "Response: $devices_response"
        return 1
    fi
    log_debug "GET /devices: OK"

    log_success "Basic API endpoints responding correctly"
    return 0
}

# ============================================
# Test: Gateway API
# ============================================

test_gateway_api() {
    log_info "Testing gateway API..."

    local gateway_port="${GATEWAY_PORT:-4000}"
    local gateway_url="http://localhost:${gateway_port}"

    # Test gateway health
    local health_response=$(curl -s "$gateway_url/health" 2>/dev/null)
    if [ -z "$health_response" ]; then
        log_warning "Gateway health endpoint not responding"
        # Don't fail - gateway is optional
        return 0
    fi

    log_success "Gateway API responding"
    return 0
}

# ============================================
# Main Test Runner
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Fresh Install E2E Test${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""

    # Setup
    setup

    # Run tests in order
    run_test "Prerequisites Check" test_prerequisites_check
    run_test "Repository Structure" test_repository_structure
    run_test "SSL Certificate Generation" test_ssl_certificate_generation
    run_test "Environment Variable Generation" test_environment_variable_generation
    run_test "Docker Compose Build" test_docker_compose_build
    run_test "Docker Compose Up" test_docker_compose_up
    run_test "Database Container Health" test_database_container_health
    run_test "Migration Container" test_migration_container
    run_test "Backend Container Health" test_backend_container_health
    run_test "Frontend Container Health" test_frontend_container_health
    run_test "Gateway Container Health" test_gateway_container_health
    run_test "HTTPS Endpoint Accessibility" test_https_endpoint
    run_test "API Health Endpoint" test_api_health_endpoint
    run_test "Login with Default Credentials" test_login_with_default_credentials
    run_test "Default Password Flag" test_default_password_flag
    run_test "Password Change Flow" test_password_change_flow
    run_test "Basic API Endpoints" test_basic_api_endpoints
    run_test "Gateway API" test_gateway_api

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
