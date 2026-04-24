#!/bin/bash
# ============================================
# Sanctuary Install Test Helpers
# ============================================
#
# Common utility functions for install tests.
# Source this file in your test scripts.
#
# Usage: source ./utils/helpers.sh
# ============================================

# Colors for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export CYAN='\033[0;36m'
export NC='\033[0m'

# Default timeouts (in seconds)
export CONTAINER_STARTUP_TIMEOUT="${CONTAINER_STARTUP_TIMEOUT:-300}"
export HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-120}"
export API_RESPONSE_TIMEOUT="${API_RESPONSE_TIMEOUT:-30}"

# ============================================
# Logging Functions
# ============================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    if [ "${DEBUG:-false}" = "true" ]; then
        echo -e "${CYAN}[DEBUG]${NC} $1"
    fi
}

# ============================================
# Docker Helper Functions
# ============================================

run_project_compose() {
    local project_dir="${1:-.}"
    shift

    local -a compose_cmd=(docker compose -f "$project_dir/docker-compose.yml")

    if [ "${ENABLE_MONITORING:-no}" = "yes" ] && [ -f "$project_dir/docker-compose.monitoring.yml" ]; then
        compose_cmd+=(-f "$project_dir/docker-compose.monitoring.yml")
    fi

    if [ "${ENABLE_TOR:-no}" = "yes" ] && [ -f "$project_dir/docker-compose.tor.yml" ]; then
        compose_cmd+=(-f "$project_dir/docker-compose.tor.yml")
    fi

    "${compose_cmd[@]}" "$@"
}

# Get container name for a service (supports dynamic project names)
# Usage: get_container_name "postgres" -> returns "sanctuary-postgres-1" or "{project}-postgres-1"
get_container_name() {
    local service="$1"
    local project="${COMPOSE_PROJECT_NAME:-sanctuary}"

    # Search by pattern (doesn't require env vars like docker compose ps does)
    # First try running containers, then all containers
    local container=$(docker ps --format '{{.Names}}' | grep -E "^${project}-${service}-[0-9]+$" | head -1)
    if [ -n "$container" ]; then
        echo "$container"
        return 0
    fi

    # Fallback: check all containers (including stopped)
    docker ps -a --format '{{.Names}}' | grep -E "^${project}-${service}-[0-9]+$" | head -1
}

# Execute command in a service container (handles dynamic names)
# Uses docker exec directly to avoid requiring env vars for docker compose
# Usage: compose_exec "backend" "wget -q -O - http://localhost:3001/health"
compose_exec() {
    local service="$1"
    shift
    local container=$(get_container_name "$service")
    if [ -n "$container" ]; then
        docker exec "$container" "$@"
    else
        log_error "Container for service '$service' not found"
        return 1
    fi
}

# Get logs from a service (handles dynamic names)
# Uses docker logs directly to avoid requiring env vars for docker compose
# Usage: compose_logs "backend" 50
compose_logs() {
    local service="$1"
    local lines="${2:-50}"
    local container=$(get_container_name "$service")
    if [ -n "$container" ]; then
        docker logs --tail "$lines" "$container" 2>&1
    else
        log_error "Container for service '$service' not found"
        return 1
    fi
}

# Service name mappings (old hardcoded -> service name)
# sanctuary-db -> postgres
# sanctuary-backend -> backend
# sanctuary-frontend -> frontend
# sanctuary-gateway -> gateway
# sanctuary-migrate -> migrate
# sanctuary-ai -> ai
# sanctuary-ollama -> ollama

# Check if Docker is available and running
check_docker_available() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        return 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        return 1
    fi

    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose v2 is not available"
        return 1
    fi

    return 0
}

# Wait for a container to be running
wait_for_container_running() {
    local container_name="$1"
    local timeout="${2:-$CONTAINER_STARTUP_TIMEOUT}"
    local start_time=$(date +%s)

    log_info "Waiting for container '$container_name' to be running (timeout: ${timeout}s)..."

    while true; do
        local status=$(docker inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null)

        if [ "$status" = "running" ]; then
            log_success "Container '$container_name' is running"
            return 0
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for container '$container_name' to be running"
            return 1
        fi

        sleep 2
    done
}

# Wait for a container to be healthy
wait_for_container_healthy() {
    local container_name="$1"
    local timeout="${2:-$HEALTH_CHECK_TIMEOUT}"
    local start_time=$(date +%s)

    log_info "Waiting for container '$container_name' to be healthy (timeout: ${timeout}s)..."

    while true; do
        local health=$(docker inspect -f '{{.State.Health.Status}}' "$container_name" 2>/dev/null)

        if [ "$health" = "healthy" ]; then
            log_success "Container '$container_name' is healthy"
            return 0
        fi

        if [ "$health" = "unhealthy" ]; then
            log_error "Container '$container_name' is unhealthy"
            docker logs "$container_name" --tail 50 2>&1 | head -20
            return 1
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for container '$container_name' to be healthy"
            log_error "Current health status: $health"
            docker logs "$container_name" --tail 50 2>&1 | head -20
            return 1
        fi

        sleep 3
    done
}

# Wait for all Sanctuary containers to be healthy
wait_for_all_containers_healthy() {
    local timeout="${1:-$CONTAINER_STARTUP_TIMEOUT}"

    log_info "Waiting for all Sanctuary containers to be healthy..."

    local services=("postgres" "backend" "frontend" "gateway")

    for service in "${services[@]}"; do
        local container=$(get_container_name "$service")
        if [ -z "$container" ]; then
            log_error "Container for service '$service' not found"
            return 1
        fi
        if ! wait_for_container_healthy "$container" "$timeout"; then
            return 1
        fi
    done

    log_success "All Sanctuary containers are healthy"
    return 0
}

# Get container status summary
get_container_status() {
    local project_dir="${1:-.}"
    local project="${COMPOSE_PROJECT_NAME:-sanctuary}"

    echo ""
    echo "Container Status:"
    echo "================="
    run_project_compose "$project_dir" ps 2>/dev/null || \
        docker ps --filter "name=${project}-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
}

# Stop and remove all Sanctuary containers
cleanup_containers() {
    local project_dir="${1:-.}"
    local project="${COMPOSE_PROJECT_NAME:-sanctuary}"

    log_info "Cleaning up Sanctuary containers..."

    (
        cd "$project_dir"
        if [ -n "${SANCTUARY_ENV_FILE:-}" ] && [ -f "$SANCTUARY_ENV_FILE" ]; then
            set -a
            source "$SANCTUARY_ENV_FILE"
            set +a
        elif [ -f "$project_dir/.env" ]; then
            set -a
            source "$project_dir/.env"
            set +a
        fi
        run_project_compose "$project_dir" down -v --remove-orphans 2>/dev/null || true
    )

    # Remove any orphaned containers
    docker ps -a --filter "name=${project}-" -q | xargs -r docker rm -f 2>/dev/null || true

    log_success "Cleanup complete"
}

cleanup_compose_project_resources() {
    local project="$1"

    [ -n "$project" ] || return 0

    docker ps -a --filter "label=com.docker.compose.project=$project" -q | xargs -r docker rm -f 2>/dev/null || true
    docker network ls --filter "label=com.docker.compose.project=$project" -q | xargs -r docker network rm 2>/dev/null || true
    docker volume ls --filter "label=com.docker.compose.project=$project" -q | xargs -r docker volume rm -f 2>/dev/null || true
}

cleanup_compose_projects_by_prefix() {
    local prefix="$1"
    local exclude_project="${2:-}"
    local projects=""

    projects="$(
        {
            docker ps -a --format '{{.Label "com.docker.compose.project"}}'
            docker network ls --format '{{.Label "com.docker.compose.project"}}'
            docker volume ls --format '{{.Label "com.docker.compose.project"}}'
        } 2>/dev/null | grep -E "^${prefix}" | sort -u
    )"

    [ -n "$projects" ] || return 0

    while IFS= read -r project; do
        [ -n "$project" ] || continue
        if [ -n "$exclude_project" ] && [ "$project" = "$exclude_project" ]; then
            continue
        fi

        log_info "Cleaning up stale compose project: $project"
        cleanup_compose_project_resources "$project"
    done <<EOF
$projects
EOF
}

# ============================================
# HTTP/API Helper Functions
# ============================================

# Wait for an HTTP endpoint to respond
wait_for_http_endpoint() {
    local url="$1"
    local timeout="${2:-$API_RESPONSE_TIMEOUT}"
    local expected_status="${3:-200}"
    local start_time=$(date +%s)

    log_info "Waiting for HTTP endpoint $url (timeout: ${timeout}s)..."

    while true; do
        local status_code=$(curl -k -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

        if [ "$status_code" = "$expected_status" ]; then
            log_success "HTTP endpoint $url is responding with status $status_code"
            return 0
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for HTTP endpoint $url"
            log_error "Last status code: $status_code"
            return 1
        fi

        sleep 2
    done
}

# Make an API request and return the response
api_request() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"
    local token="${4:-}"
    local base_url="${API_BASE_URL:-https://localhost:8443}"

    local curl_opts=("-k" "-s" "-X" "$method")

    if [ -n "$token" ]; then
        curl_opts+=("-H" "Authorization: Bearer $token")
    fi

    curl_opts+=("-H" "Content-Type: application/json")

    if [ -n "$data" ]; then
        curl_opts+=("-d" "$data")
    fi

    curl "${curl_opts[@]}" "${base_url}${endpoint}"
}

# Login and get auth token
login_and_get_token() {
    local username="$1"
    local password="$2"
    local base_url="${API_BASE_URL:-https://localhost:8443}"

    local response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
        "${base_url}/api/v1/auth/login")

    # Extract token from response
    echo "$response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4
}

# Check if user needs to change password (usingDefaultPassword flag)
check_using_default_password() {
    local username="$1"
    local password="$2"
    local base_url="${API_BASE_URL:-https://localhost:8443}"

    local response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
        "${base_url}/api/v1/auth/login")

    # Check if response contains usingDefaultPassword: true
    if echo "$response" | grep -q '"usingDefaultPassword":true'; then
        return 0  # true - using default password
    else
        return 1  # false - not using default password
    fi
}

# Change user password
change_password() {
    local token="$1"
    local current_password="$2"
    local new_password="$3"
    local base_url="${API_BASE_URL:-https://localhost:8443}"

    local response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d "{\"currentPassword\":\"$current_password\",\"newPassword\":\"$new_password\"}" \
        "${base_url}/api/v1/auth/me/change-password")

    echo "$response"
}

# ============================================
# File System Helper Functions
# ============================================

# Create a clean test directory
create_test_directory() {
    local base_dir="${1:-/tmp}"
    local prefix="${2:-sanctuary-test}"

    local test_dir=$(mktemp -d "${base_dir}/${prefix}-XXXXXX")
    echo "$test_dir"
}

# Check if file contains expected content
file_contains() {
    local file="$1"
    local pattern="$2"

    if [ -f "$file" ] && grep -q "$pattern" "$file"; then
        return 0
    else
        return 1
    fi
}

# ============================================
# Test Assertion Functions
# ============================================

assert_equals() {
    local expected="$1"
    local actual="$2"
    local message="${3:-Values should be equal}"

    if [ "$expected" = "$actual" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Expected: '$expected'"
        log_error "  Actual:   '$actual'"
        return 1
    fi
}

assert_not_empty() {
    local value="$1"
    local message="${2:-Value should not be empty}"

    if [ -n "$value" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        return 1
    fi
}

assert_file_exists() {
    local file="$1"
    local message="${2:-File should exist}"

    if [ -f "$file" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  File not found: $file"
        return 1
    fi
}

assert_directory_exists() {
    local dir="$1"
    local message="${2:-Directory should exist}"

    if [ -d "$dir" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Directory not found: $dir"
        return 1
    fi
}

assert_http_status() {
    local url="$1"
    local expected_status="$2"
    local message="${3:-HTTP status should match}"

    local actual_status=$(curl -k -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

    if [ "$actual_status" = "$expected_status" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Expected status: $expected_status"
        log_error "  Actual status:   $actual_status"
        return 1
    fi
}

assert_container_healthy() {
    local container_name="$1"
    local message="${2:-Container should be healthy}"

    local health=$(docker inspect -f '{{.State.Health.Status}}' "$container_name" 2>/dev/null)

    if [ "$health" = "healthy" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Container: $container_name"
        log_error "  Health status: $health"
        return 1
    fi
}

assert_container_running() {
    local container_name="$1"
    local message="${2:-Container should be running}"

    local status=$(docker inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null)

    if [ "$status" = "running" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Container: $container_name"
        log_error "  Status: $status"
        return 1
    fi
}

assert_json_contains() {
    local json="$1"
    local key="$2"
    local expected_value="$3"
    local message="${4:-JSON should contain expected value}"

    # Extract value using grep (simple approach)
    local actual_value=$(echo "$json" | grep -o "\"$key\":[^,}]*" | cut -d':' -f2 | tr -d '"' | tr -d ' ')

    if [ "$actual_value" = "$expected_value" ]; then
        return 0
    else
        log_error "ASSERTION FAILED: $message"
        log_error "  Key: $key"
        log_error "  Expected: $expected_value"
        log_error "  Actual: $actual_value"
        return 1
    fi
}

# ============================================
# Test Environment Setup
# ============================================

# Generate a unique test run ID
generate_test_run_id() {
    echo "test-$(date +%Y%m%d-%H%M%S)-$$"
}

# Export test environment variables
setup_test_environment() {
    local test_id="${1:-$(generate_test_run_id)}"

    export TEST_RUN_ID="$test_id"
    export HTTPS_PORT="${HTTPS_PORT:-8443}"
    export HTTP_PORT="${HTTP_PORT:-8080}"
    export API_BASE_URL="https://localhost:${HTTPS_PORT}"

    log_info "Test environment setup complete"
    log_info "  TEST_RUN_ID: $TEST_RUN_ID"
    log_info "  API_BASE_URL: $API_BASE_URL"
}

# ============================================
# Migration Container Helpers
# ============================================

# Wait for migration container to complete
wait_for_migration_complete() {
    local timeout="${1:-120}"
    local start_time=$(date +%s)

    log_info "Waiting for database migration to complete (timeout: ${timeout}s)..."

    # Get migrate container name dynamically
    local migrate_container=$(get_container_name "migrate")
    if [ -z "$migrate_container" ]; then
        log_warning "Migrate container not found, checking by pattern..."
        migrate_container=$(docker ps -a --format '{{.Names}}' | grep -E '.*-migrate-[0-9]+$' | head -1)
    fi

    if [ -z "$migrate_container" ]; then
        log_error "Could not find migrate container"
        return 1
    fi

    while true; do
        # Check if migrate container exists and has finished
        local status=$(docker inspect -f '{{.State.Status}}' "$migrate_container" 2>/dev/null || echo "not_found")

        if [ "$status" = "exited" ]; then
            local exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$migrate_container" 2>/dev/null)
            if [ "$exit_code" = "0" ]; then
                log_success "Database migration completed successfully"
                return 0
            else
                log_error "Database migration failed with exit code: $exit_code"
                docker logs "$migrate_container" 2>&1 | tail -20
                return 1
            fi
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for database migration"
            return 1
        fi

        sleep 3
    done
}

# ============================================
# Database Helpers
# ============================================

# Check if admin user exists in database
check_admin_user_exists() {
    local service="${1:-postgres}"
    local max_attempts=15
    local attempt=1

    log_debug "Checking for admin user in database (max $max_attempts attempts)..."

    # Get container name for the service
    local container=$(get_container_name "$service")
    if [ -z "$container" ]; then
        log_debug "Container not found for service '$service', using direct compose exec"
        container="$service"
    fi

    # Retry multiple times since seeding might still be completing
    # Total wait time: up to 45 seconds (15 attempts × 3 seconds)
    while [ $attempt -le $max_attempts ]; do
        # Capture both stdout and stderr for debugging
        local result
        local error
        result=$(compose_exec postgres psql -U sanctuary -d sanctuary -t -c \
            "SELECT COUNT(*) FROM users WHERE username = 'admin';" 2>&1)
        local exit_code=$?

        # Clean up whitespace from result
        result=$(echo "$result" | tr -d ' \n\r\t')

        log_debug "Attempt $attempt: psql exit=$exit_code, result='$result'"

        # Check for successful query with count of 1
        if [ "$exit_code" = "0" ] && [ "$result" = "1" ]; then
            log_debug "Admin user found on attempt $attempt"
            return 0
        fi

        # If we got a number but it's 0, the table exists but user doesn't
        if [ "$exit_code" = "0" ] && [ "$result" = "0" ]; then
            log_debug "Table exists but admin user not found yet"
        fi

        # If result contains error text, log it
        if echo "$result" | grep -qi "error\|does not exist"; then
            log_debug "Query error: $result"
        fi

        if [ $attempt -lt $max_attempts ]; then
            sleep 3
        fi
        attempt=$((attempt + 1))
    done

    log_debug "Admin user not found after $max_attempts attempts"
    return 1
}

# Check if default password marker exists
check_default_password_marker() {
    local service="${1:-postgres}"

    local result=$(compose_exec postgres psql -U sanctuary -d sanctuary -t -c \
        "SELECT COUNT(*) FROM system_settings WHERE key LIKE 'initialPassword_%';" 2>/dev/null | tr -d ' ')

    if [ "$result" -ge "1" ]; then
        return 0
    else
        return 1
    fi
}

# ============================================
# Cleanup trap handler
# ============================================

# Set up cleanup trap
setup_cleanup_trap() {
    local cleanup_func="${1:-cleanup_containers}"
    local project_dir="${2:-.}"

    trap "log_warning 'Caught signal, cleaning up...'; $cleanup_func '$project_dir'; exit 1" INT TERM
}
