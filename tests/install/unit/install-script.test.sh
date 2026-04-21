#!/bin/bash
# ============================================
# Unit Tests for install.sh Functions
# ============================================
#
# These tests verify individual functions in install.sh
# in isolation using bash unit testing patterns.
#
# Run: ./install-script.test.sh
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test result tracking
declare -a FAILED_TESTS

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
INSTALL_SCRIPT="$PROJECT_ROOT/install.sh"
SETUP_SCRIPT="$PROJECT_ROOT/scripts/setup.sh"

# ============================================
# Test Framework
# ============================================

assert_equals() {
    local expected="$1"
    local actual="$2"
    local message="${3:-Values should be equal}"

    if [ "$expected" = "$actual" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} $message"
        echo "  Expected: '$expected'"
        echo "  Actual:   '$actual'"
        return 1
    fi
}

assert_not_empty() {
    local value="$1"
    local message="${2:-Value should not be empty}"

    if [ -n "$value" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} $message"
        echo "  Value is empty"
        return 1
    fi
}

assert_file_exists() {
    local file="$1"
    local message="${2:-File should exist}"

    if [ -f "$file" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} $message"
        echo "  File not found: $file"
        return 1
    fi
}

assert_command_exists() {
    local cmd="$1"
    local message="${2:-Command should exist}"

    if command -v "$cmd" &> /dev/null; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} $message"
        echo "  Command not found: $cmd"
        return 1
    fi
}

assert_exit_code() {
    local expected="$1"
    local actual="$2"
    local message="${3:-Exit code should match}"

    if [ "$expected" = "$actual" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} $message"
        echo "  Expected exit code: $expected"
        echo "  Actual exit code:   $actual"
        return 1
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local message="${3:-String should contain substring}"

    if [[ "$haystack" == *"$needle"* ]]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} $message"
        echo "  String does not contain: '$needle'"
        return 1
    fi
}

assert_length() {
    local value="$1"
    local min_length="$2"
    local message="${3:-String should have minimum length}"

    local actual_length=${#value}
    if [ "$actual_length" -ge "$min_length" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} $message"
        echo "  Expected minimum length: $min_length"
        echo "  Actual length:          $actual_length"
        return 1
    fi
}

run_test() {
    local test_name="$1"
    local test_func="$2"

    TESTS_RUN=$((TESTS_RUN + 1))
    echo -n "  Running: $test_name... "

    # Run the test function and capture exit status
    set +e
    $test_func
    local exit_code=$?
    set -e

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}PASSED${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}FAILED${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        FAILED_TESTS+=("$test_name")
    fi
}

# ============================================
# Test Setup / Teardown
# ============================================

setup() {
    # Create temporary test directory
    TEST_TMP_DIR=$(mktemp -d)
    export TEST_TMP_DIR
}

teardown() {
    # Clean up temporary test directory
    if [ -n "$TEST_TMP_DIR" ] && [ -d "$TEST_TMP_DIR" ]; then
        rm -rf "$TEST_TMP_DIR"
    fi
}

# ============================================
# Source install.sh functions for testing
# ============================================

# Extract functions from install.sh for testing
# We create a testable version that doesn't run main()

create_testable_script() {
    cat > "$TEST_TMP_DIR/install_functions.sh" << 'EOF'
#!/bin/bash
# Extracted functions from install.sh for testing

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Platform detection (simplified for testing)
SOURCE_PLATFORM="${SOURCE_PLATFORM:-github}"
case "$SOURCE_PLATFORM" in
    gitlab)
        REPO_URL="https://gitlab.com/narusegawa-nekoworks/sanctuary.git"
        ;;
    github|*)
        REPO_URL="https://github.com/nekoguntai-castle/sanctuary.git"
        ;;
esac

# Configuration
INSTALL_DIR="${SANCTUARY_DIR:-$HOME/sanctuary}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"

# Generate random secret
generate_secret() {
    if command -v openssl &> /dev/null; then
        openssl rand -base64 32 | tr -d '=/+' | head -c 48
    elif [ -f /dev/urandom ]; then
        cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 48
    else
        echo "$(date +%s%N)$$" | sha256sum | head -c 48
    fi
}

# Check docker
check_docker() {
    if ! command -v docker &> /dev/null; then
        return 1
    fi
    if ! docker info &> /dev/null 2>&1; then
        return 2
    fi
    if ! docker compose version &> /dev/null 2>&1; then
        return 3
    fi
    return 0
}

# Check git
check_git() {
    if ! command -v git &> /dev/null; then
        return 1
    fi
    return 0
}

# Check openssl (with output for user feedback)
check_openssl() {
    if ! command -v openssl &> /dev/null; then
        echo -e "${YELLOW}Warning: OpenSSL not found.${NC}"
        return 1
    fi
    echo -e "${GREEN}✓${NC} OpenSSL is available"
    return 0
}

# Check openssl (silent, for capture patterns)
has_openssl() {
    command -v openssl &> /dev/null
}

# Get latest release (simplified for testing)
get_latest_release() {
    if command -v curl &> /dev/null; then
        local tag=$(curl -fsSL "https://api.github.com/repos/nekoguntai-castle/sanctuary/releases/latest" 2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4)
        if [ -n "$tag" ]; then
            echo "$tag"
            return 0
        fi
    fi
    echo ""
}
EOF
    source "$TEST_TMP_DIR/install_functions.sh"
}

# ============================================
# Unit Tests: generate_secret()
# ============================================

test_generate_secret_returns_value() {
    local secret=$(generate_secret)
    assert_not_empty "$secret" "generate_secret should return a non-empty value"
}

test_generate_secret_correct_length() {
    local secret=$(generate_secret)
    assert_length "$secret" 32 "generate_secret should return at least 32 characters"
}

test_generate_secret_unique() {
    local secret1=$(generate_secret)
    local secret2=$(generate_secret)

    if [ "$secret1" != "$secret2" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} generate_secret should return unique values"
        echo "  Got same value twice: $secret1"
        return 1
    fi
}

test_generate_secret_alphanumeric() {
    local secret=$(generate_secret)

    # Check if it only contains alphanumeric characters
    if [[ "$secret" =~ ^[a-zA-Z0-9]+$ ]]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} generate_secret should return alphanumeric characters"
        echo "  Got: $secret"
        return 1
    fi
}

# ============================================
# Unit Tests: check_docker()
# ============================================

test_check_docker_command_exists() {
    # This test verifies that the function properly detects docker
    if command -v docker &> /dev/null; then
        check_docker
        local exit_code=$?
        # If docker exists, it should not return 1 (command not found)
        if [ $exit_code -eq 1 ]; then
            echo -e "${RED}ASSERTION FAILED:${NC} check_docker returned 1 (not found) but docker exists"
            return 1
        fi
        return 0
    else
        # Docker not installed - test that function returns 1
        check_docker
        assert_exit_code 1 $? "check_docker should return 1 when docker is not installed"
    fi
}

# ============================================
# Unit Tests: check_git()
# ============================================

test_check_git_command_exists() {
    if command -v git &> /dev/null; then
        check_git
        assert_exit_code 0 $? "check_git should return 0 when git is installed"
    else
        check_git
        assert_exit_code 1 $? "check_git should return 1 when git is not installed"
    fi
}

# ============================================
# Unit Tests: check_openssl()
# ============================================

test_check_openssl_command_exists() {
    if command -v openssl &> /dev/null; then
        check_openssl
        assert_exit_code 0 $? "check_openssl should return 0 when openssl is installed"
    else
        check_openssl
        assert_exit_code 1 $? "check_openssl should return 1 when openssl is not installed"
    fi
}

# ============================================
# Unit Tests: has_openssl() capture pattern
# ============================================

test_has_openssl_capture_pattern() {
    # This tests the actual pattern used in install.sh
    # The bug was: HAS_OPENSSL=$(check_openssl && echo "yes" || echo "no")
    # which captured the echo output from check_openssl PLUS "yes"

    # Simulate the correct pattern (using has_openssl which has no output)
    local result=$(has_openssl && echo "yes" || echo "no")

    # Result should be exactly "yes" or "no", not multi-line
    if [[ "$result" == "yes" ]] || [[ "$result" == "no" ]]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} has_openssl capture should produce 'yes' or 'no'"
        echo "  Got: '$result'"
        echo "  (If multi-line, the pattern is broken)"
        return 1
    fi
}

test_has_openssl_no_output() {
    # has_openssl should produce NO output (unlike check_openssl which prints status)
    local output=$(has_openssl 2>&1)

    if [ -z "$output" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} has_openssl should produce no output"
        echo "  Got: '$output'"
        return 1
    fi
}

# ============================================
# Unit Tests: Environment Variables
# ============================================

test_default_install_dir() {
    unset SANCTUARY_DIR
    source "$TEST_TMP_DIR/install_functions.sh"
    assert_equals "$HOME/sanctuary" "$INSTALL_DIR" "Default INSTALL_DIR should be \$HOME/sanctuary"
}

test_custom_install_dir() {
    export SANCTUARY_DIR="/custom/path"
    source "$TEST_TMP_DIR/install_functions.sh"
    assert_equals "/custom/path" "$INSTALL_DIR" "INSTALL_DIR should use SANCTUARY_DIR when set"
    unset SANCTUARY_DIR
}

test_default_https_port() {
    unset HTTPS_PORT
    source "$TEST_TMP_DIR/install_functions.sh"
    assert_equals "8443" "$HTTPS_PORT" "Default HTTPS_PORT should be 8443"
}

test_custom_https_port() {
    export HTTPS_PORT="9443"
    source "$TEST_TMP_DIR/install_functions.sh"
    assert_equals "9443" "$HTTPS_PORT" "HTTPS_PORT should use custom value when set"
    unset HTTPS_PORT
}

test_default_http_port() {
    unset HTTP_PORT
    source "$TEST_TMP_DIR/install_functions.sh"
    assert_equals "8080" "$HTTP_PORT" "Default HTTP_PORT should be 8080"
}

test_custom_http_port() {
    export HTTP_PORT="9080"
    source "$TEST_TMP_DIR/install_functions.sh"
    assert_equals "9080" "$HTTP_PORT" "HTTP_PORT should use custom value when set"
    unset HTTP_PORT
}

# ============================================
# Unit Tests: install.sh file structure
# ============================================

test_install_script_exists() {
    assert_file_exists "$INSTALL_SCRIPT" "install.sh should exist in project root"
}

test_install_script_is_executable() {
    if [ -x "$INSTALL_SCRIPT" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should be executable"
        return 1
    fi
}

test_install_script_has_shebang() {
    local first_line=$(head -1 "$INSTALL_SCRIPT")
    assert_equals "#!/bin/bash" "$first_line" "install.sh should start with bash shebang"
}

test_install_script_has_set_e() {
    if grep -q "^set -e" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should have 'set -e' for error handling"
        return 1
    fi
}

test_install_script_has_docker_check() {
    # Docker check is now in setup.sh (install.sh delegates to setup.sh)
    if grep -q "check_docker\|docker info\|Docker.*installed" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should have docker check function"
        return 1
    fi
}

test_install_script_has_git_check() {
    # install.sh checks for git before cloning
    if grep -q "command -v git\|git.*installed\|Git is" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should have git check"
        return 1
    fi
}

test_install_script_has_openssl_check() {
    # OpenSSL check is now in setup.sh (install.sh delegates to setup.sh)
    if grep -q "check_openssl\|command -v openssl\|OpenSSL" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should have openssl check"
        return 1
    fi
}

test_install_script_generates_jwt_secret() {
    if grep -q "JWT_SECRET" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should generate JWT_SECRET"
        return 1
    fi
}

test_install_script_generates_encryption_key() {
    if grep -q "ENCRYPTION_KEY" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should generate ENCRYPTION_KEY"
        return 1
    fi
}

test_install_script_generates_gateway_secret() {
    if grep -q "GATEWAY_SECRET" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should generate GATEWAY_SECRET"
        return 1
    fi
}

test_install_script_generates_postgres_password() {
    if grep -q "POSTGRES_PASSWORD" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should generate POSTGRES_PASSWORD"
        return 1
    fi
}

test_install_script_uses_docker_compose() {
    if grep -q "docker compose" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should use 'docker compose' command"
        return 1
    fi
}

test_install_script_creates_env_file() {
    # Runtime env file creation is now in setup.sh (install.sh delegates to setup.sh)
    if grep -q 'cat > "\$ENV_FILE"' "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should create the resolved runtime env file"
        return 1
    fi
}

test_install_script_loads_runtime_env_for_upgrades() {
    if grep -q "resolve_runtime_env_file" "$INSTALL_SCRIPT" \
        && grep -q "SANCTUARY_ENV_FILE" "$INSTALL_SCRIPT" \
        && grep -q '\$INSTALL_DIR/\.env' "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should load runtime env first and legacy .env as upgrade fallback"
        return 1
    fi
}

test_install_script_has_silent_openssl_check() {
    # setup.sh uses command -v openssl for silent checks
    # This test verifies setup.sh can check openssl availability silently
    if grep -q "command -v openssl" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should have silent openssl check"
        echo "  This is needed for clean capture patterns like \$(has_openssl && echo yes)"
        return 1
    fi
}

test_install_script_uses_has_openssl_for_capture() {
    # setup.sh must use command -v openssl for silent capture (not check_openssl which has echo)
    if grep -q 'command -v openssl' "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh must use command -v openssl for silent check"
        echo "  Using check_openssl captures echo output and breaks the comparison"
        return 1
    fi
}

test_install_script_no_hardcoded_container_names() {
    # Container status checks should not hardcode project-specific names like 'sanctuary-frontend'
    # They should use docker compose ps which respects COMPOSE_PROJECT_NAME
    if grep -q 'sanctuary-frontend\|sanctuary-backend\|sanctuary-postgres' "$INSTALL_SCRIPT"; then
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh has hardcoded container names"
        echo "  Use 'docker compose ps --format' with service names instead"
        grep -n 'sanctuary-frontend\|sanctuary-backend\|sanctuary-postgres' "$INSTALL_SCRIPT"
        return 1
    fi
    return 0
}

# ============================================
# Unit Tests: start.sh file structure
# ============================================

START_SCRIPT="$PROJECT_ROOT/start.sh"

test_start_script_exists() {
    assert_file_exists "$START_SCRIPT" "start.sh should exist in project root"
}

test_start_script_is_executable() {
    if [ -x "$START_SCRIPT" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should be executable"
        return 1
    fi
}

test_start_script_checks_jwt_secret() {
    if grep -q "JWT_SECRET" "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should check JWT_SECRET"
        return 1
    fi
}

test_start_script_checks_encryption_key() {
    if grep -q "ENCRYPTION_KEY" "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should check ENCRYPTION_KEY"
        return 1
    fi
}

test_start_script_checks_gateway_secret() {
    if grep -q "GATEWAY_SECRET" "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should check GATEWAY_SECRET"
        return 1
    fi
}

test_start_script_checks_postgres_password() {
    if grep -q "POSTGRES_PASSWORD" "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should check POSTGRES_PASSWORD"
        return 1
    fi
}

test_start_script_exports_secrets() {
    if grep -q "export.*JWT_SECRET.*ENCRYPTION_KEY.*GATEWAY_SECRET.*POSTGRES_PASSWORD" "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should export all required secrets"
        return 1
    fi
}

test_start_script_sources_env_file() {
    # start.sh should source the resolved env file, with support for
    # SANCTUARY_ENV_FILE and legacy .env fallback.
    if grep -q 'source "\$ENV_FILE"' "$START_SCRIPT" && grep -q 'SANCTUARY_ENV_FILE' "$START_SCRIPT" && grep -q '\.env' "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should source the resolved env file"
        return 1
    fi
}

test_start_script_has_env_local_fallback() {
    # start.sh should have fallback to .env.local for backwards compatibility
    if grep -q '\.env\.local' "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should have .env.local fallback"
        return 1
    fi
}

test_start_script_env_local_has_set_a() {
    # CRITICAL: the resolved env file loader covers both external env
    # files and the .env.local fallback, and must export variables.
    local env_loader_block=$(sed -n '/if.*-f.*"\$ENV_FILE"/,/^fi$/p' "$START_SCRIPT")

    if echo "$env_loader_block" | grep -q "set -a" && echo "$env_loader_block" | grep -q 'source "\$ENV_FILE"'; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} resolved env loader must use 'set -a' to export variables"
        echo "  Without this, secrets won't be passed to docker compose"
        return 1
    fi
}

test_start_script_env_has_set_a() {
    # Primary env source must also use set -a
    local env_block=$(sed -n '/if.*-f.*"\$ENV_FILE"/,/^fi$/p' "$START_SCRIPT")

    if echo "$env_block" | grep -q "set -a" && echo "$env_block" | grep -q 'source "\$ENV_FILE"'; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} .env source must use 'set -a' to export variables"
        return 1
    fi
}

# ============================================
# Unit Tests: Pre-flight checks (new functions)
# ============================================

test_install_script_has_disk_space_check() {
    if grep -q "check_disk_space" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should have check_disk_space function"
        return 1
    fi
}

test_install_script_has_memory_check() {
    if grep -q "check_memory" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should have check_memory function"
        return 1
    fi
}

test_install_script_has_wsl_check() {
    if grep -q "check_wsl" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should have check_wsl function"
        return 1
    fi
}

test_install_script_has_architecture_check() {
    if grep -q "check_architecture" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should have check_architecture function"
        return 1
    fi
}

test_install_script_has_port_conflict_check() {
    # Port conflict check is now in setup.sh (install.sh delegates to setup.sh)
    if grep -q "check_port_conflict" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should have check_port_conflict function"
        return 1
    fi
}

test_install_script_checks_multiple_ports() {
    # Port checks are now in setup.sh - should check HTTPS, HTTP, and Gateway ports
    local https_check=$(grep -c 'check_port_conflict.*HTTPS\|https_port' "$SETUP_SCRIPT" || echo "0")
    local http_check=$(grep -c 'check_port_conflict.*HTTP\|http_port' "$SETUP_SCRIPT" || echo "0")
    local gateway_check=$(grep -c 'check_port_conflict.*Gateway\|gateway_port\|GATEWAY' "$SETUP_SCRIPT" || echo "0")

    if [ "$https_check" -ge 1 ] && [ "$http_check" -ge 1 ] && [ "$gateway_check" -ge 1 ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should check HTTPS, HTTP, and Gateway ports"
        echo "  HTTPS checks: $https_check, HTTP checks: $http_check, Gateway checks: $gateway_check"
        return 1
    fi
}

test_install_script_has_upgrade_backup_guidance() {
    if grep -q "backup\|pg_dump" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should provide database backup guidance for upgrades"
        return 1
    fi
}

test_install_script_passes_upgrade_flag() {
    # install.sh should pass --upgrade to setup.sh during upgrades
    # so that Docker images are rebuilt from scratch (no cache)
    if grep -q "\-\-upgrade" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should pass --upgrade flag to setup.sh during upgrades"
        echo "  This ensures Docker images are rebuilt with --no-cache on version upgrades"
        return 1
    fi
}

test_setup_script_has_upgrade_flag() {
    # setup.sh should accept --upgrade flag
    if grep -q "\-\-upgrade" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should accept --upgrade flag"
        return 1
    fi
}

test_setup_script_uses_no_cache_on_upgrade() {
    # setup.sh should use --no-cache when building during upgrades
    if grep -q "no-cache" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should use --no-cache for Docker builds during upgrades"
        echo "  Without this, Docker may serve stale images from the build cache"
        return 1
    fi
}

test_start_script_rebuild_uses_no_cache() {
    # start.sh --rebuild should use --no-cache to ensure fresh images
    if grep -q "no-cache" "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh --rebuild should use --no-cache for Docker builds"
        echo "  Without this, 'start.sh --rebuild' may still serve cached images"
        return 1
    fi
}

test_install_script_has_health_check_timeout() {
    # Health check timeout is now in setup.sh - should have MAX_WAIT for health check polling
    if grep -q "MAX_WAIT" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should have MAX_WAIT for health check timeout"
        return 1
    fi
}

# ============================================
# Unit Tests: start.sh SSL expiry check
# ============================================

test_start_script_has_ssl_expiry_check() {
    if grep -q "check_ssl_expiry\|ssl.*expir" "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should have SSL certificate expiry check"
        return 1
    fi
}

# ============================================
# Unit Tests: uninstall.sh
# ============================================

UNINSTALL_SCRIPT="$PROJECT_ROOT/uninstall.sh"

test_uninstall_script_exists() {
    assert_file_exists "$UNINSTALL_SCRIPT" "uninstall.sh should exist in project root"
}

test_uninstall_script_is_executable() {
    if [ -x "$UNINSTALL_SCRIPT" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} uninstall.sh should be executable"
        return 1
    fi
}

test_uninstall_script_has_force_option() {
    if grep -q "\-\-force\|-f" "$UNINSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} uninstall.sh should have --force option"
        return 1
    fi
}

test_uninstall_script_has_keep_data_option() {
    if grep -q "\-\-keep-data" "$UNINSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} uninstall.sh should have --keep-data option"
        return 1
    fi
}

test_uninstall_script_has_confirmation() {
    if grep -q "DELETE\|confirm" "$UNINSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} uninstall.sh should have confirmation prompt"
        return 1
    fi
}

test_uninstall_script_removes_volumes() {
    if grep -q "docker.*volume\|down -v" "$UNINSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} uninstall.sh should remove Docker volumes"
        return 1
    fi
}

# ============================================
# Unit Tests: scripts/setup.sh
# ============================================

SETUP_SCRIPT="$PROJECT_ROOT/scripts/setup.sh"

test_setup_script_exists() {
    assert_file_exists "$SETUP_SCRIPT" "scripts/setup.sh should exist"
}

test_setup_script_has_secret_fallbacks() {
    # setup.sh should have fallback methods like install.sh (not just openssl)
    if grep -q "/dev/urandom\|sha256sum" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} scripts/setup.sh should have fallback secret generation methods"
        return 1
    fi
}

test_setup_script_generates_48_char_secrets() {
    # Secrets should be 48 characters (aligned with install.sh)
    if grep -q "head -c 48" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} scripts/setup.sh should generate 48-character secrets"
        return 1
    fi
}

test_setup_script_defaults_to_external_runtime_env() {
    if grep -q 'DEFAULT_RUNTIME_DIR=.*\.config/sanctuary' "$SETUP_SCRIPT" \
        && grep -q 'DEFAULT_ENV_FILE=.*sanctuary.env' "$SETUP_SCRIPT" \
        && grep -q 'ENV_FILE=.*SANCTUARY_ENV_FILE' "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should default fresh env files outside the repo"
        return 1
    fi
}

test_setup_script_keeps_legacy_env_fallback() {
    if grep -q 'LEGACY_ENV_FILE=.*PROJECT_DIR.*\.env' "$SETUP_SCRIPT" \
        && grep -q 'ENV_FILE_IS_LEGACY' "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should keep legacy .env fallback for upgrades"
        return 1
    fi
}

test_setup_script_defaults_to_external_ssl_dir() {
    if grep -q 'DEFAULT_SSL_DIR=.*DEFAULT_RUNTIME_DIR.*/ssl' "$SETUP_SCRIPT" \
        && grep -q 'SSL_DIR=.*SANCTUARY_SSL_DIR' "$SETUP_SCRIPT" \
        && grep -q 'LEGACY_SSL_DIR=.*docker/nginx/ssl' "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should default fresh SSL files outside the repo"
        return 1
    fi
}

# ============================================
# Unit Tests: .env.example
# ============================================

ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

test_env_example_exists() {
    assert_file_exists "$ENV_EXAMPLE" ".env.example should exist in project root"
}

test_env_example_has_all_required_secrets() {
    local missing=""
    grep -q "JWT_SECRET" "$ENV_EXAMPLE" || missing="$missing JWT_SECRET"
    grep -q "ENCRYPTION_KEY" "$ENV_EXAMPLE" || missing="$missing ENCRYPTION_KEY"
    grep -q "GATEWAY_SECRET" "$ENV_EXAMPLE" || missing="$missing GATEWAY_SECRET"
    grep -q "POSTGRES_PASSWORD" "$ENV_EXAMPLE" || missing="$missing POSTGRES_PASSWORD"

    if [ -z "$missing" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} .env.example missing:$missing"
        return 1
    fi
}

test_env_example_has_setup_instructions() {
    if grep -qi "install.sh\|setup.sh" "$ENV_EXAMPLE"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} .env.example should reference install.sh or setup.sh"
        return 1
    fi
}

# ============================================
# Unit Tests: SSL certificate generation
# ============================================

test_generate_certs_script_exists() {
    assert_file_exists "$PROJECT_ROOT/docker/nginx/ssl/generate-certs.sh" \
        "generate-certs.sh should exist"
}

test_generate_certs_creates_files() {
    # Only run if openssl is available
    if ! command -v openssl &> /dev/null; then
        echo -e "${YELLOW}SKIPPED:${NC} OpenSSL not available"
        return 0
    fi

    # Create test directory
    local test_ssl_dir="$TEST_TMP_DIR/ssl"
    mkdir -p "$test_ssl_dir"

    # Run certificate generation
    cd "$test_ssl_dir"
    openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
        -keyout "privkey.pem" \
        -out "fullchain.pem" \
        -subj "/CN=test/O=Test/C=US" 2>/dev/null

    assert_file_exists "$test_ssl_dir/privkey.pem" "privkey.pem should be created"
    assert_file_exists "$test_ssl_dir/fullchain.pem" "fullchain.pem should be created"
}

# ============================================
# Main Test Runner
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Install Script Unit Tests${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""

    # Setup
    setup
    create_testable_script

    # Run test suites
    echo -e "${YELLOW}Test Suite: generate_secret()${NC}"
    run_test "generate_secret returns value" test_generate_secret_returns_value
    run_test "generate_secret correct length" test_generate_secret_correct_length
    run_test "generate_secret unique values" test_generate_secret_unique
    run_test "generate_secret alphanumeric" test_generate_secret_alphanumeric
    echo ""

    echo -e "${YELLOW}Test Suite: check_docker()${NC}"
    run_test "check_docker command exists" test_check_docker_command_exists
    echo ""

    echo -e "${YELLOW}Test Suite: check_git()${NC}"
    run_test "check_git command exists" test_check_git_command_exists
    echo ""

    echo -e "${YELLOW}Test Suite: check_openssl()${NC}"
    run_test "check_openssl command exists" test_check_openssl_command_exists
    run_test "has_openssl capture pattern" test_has_openssl_capture_pattern
    run_test "has_openssl no output" test_has_openssl_no_output
    echo ""

    echo -e "${YELLOW}Test Suite: Environment Variables${NC}"
    run_test "default install dir" test_default_install_dir
    run_test "custom install dir" test_custom_install_dir
    run_test "default https port" test_default_https_port
    run_test "custom https port" test_custom_https_port
    run_test "default http port" test_default_http_port
    run_test "custom http port" test_custom_http_port
    echo ""

    echo -e "${YELLOW}Test Suite: install.sh File Structure${NC}"
    run_test "install script exists" test_install_script_exists
    run_test "install script is executable" test_install_script_is_executable
    run_test "install script has shebang" test_install_script_has_shebang
    run_test "install script has set -e" test_install_script_has_set_e
    run_test "install script has docker check" test_install_script_has_docker_check
    run_test "install script has git check" test_install_script_has_git_check
    run_test "install script has openssl check" test_install_script_has_openssl_check
    run_test "install script generates JWT_SECRET" test_install_script_generates_jwt_secret
    run_test "install script generates ENCRYPTION_KEY" test_install_script_generates_encryption_key
    run_test "install script generates GATEWAY_SECRET" test_install_script_generates_gateway_secret
    run_test "install script generates POSTGRES_PASSWORD" test_install_script_generates_postgres_password
    run_test "install script uses docker compose" test_install_script_uses_docker_compose
    run_test "install script creates .env file" test_install_script_creates_env_file
    run_test "install script loads runtime env for upgrades" test_install_script_loads_runtime_env_for_upgrades
    run_test "install script has silent openssl check" test_install_script_has_silent_openssl_check
    run_test "install script uses has_openssl for capture" test_install_script_uses_has_openssl_for_capture
    run_test "install script no hardcoded container names" test_install_script_no_hardcoded_container_names
    echo ""

    echo -e "${YELLOW}Test Suite: start.sh File Structure${NC}"
    run_test "start script exists" test_start_script_exists
    run_test "start script is executable" test_start_script_is_executable
    run_test "start script checks JWT_SECRET" test_start_script_checks_jwt_secret
    run_test "start script checks ENCRYPTION_KEY" test_start_script_checks_encryption_key
    run_test "start script checks GATEWAY_SECRET" test_start_script_checks_gateway_secret
    run_test "start script checks POSTGRES_PASSWORD" test_start_script_checks_postgres_password
    run_test "start script exports secrets" test_start_script_exports_secrets
    run_test "start script sources .env file" test_start_script_sources_env_file
    run_test "start script has .env.local fallback" test_start_script_has_env_local_fallback
    run_test "start script .env has set -a" test_start_script_env_has_set_a
    run_test "start script .env.local has set -a" test_start_script_env_local_has_set_a
    echo ""

    echo -e "${YELLOW}Test Suite: Pre-flight Checks${NC}"
    run_test "install script has disk space check" test_install_script_has_disk_space_check
    run_test "install script has memory check" test_install_script_has_memory_check
    run_test "install script has WSL check" test_install_script_has_wsl_check
    run_test "install script has architecture check" test_install_script_has_architecture_check
    run_test "install script has port conflict check" test_install_script_has_port_conflict_check
    run_test "install script checks multiple ports" test_install_script_checks_multiple_ports
    run_test "install script has upgrade backup guidance" test_install_script_has_upgrade_backup_guidance
    run_test "install script has health check timeout" test_install_script_has_health_check_timeout
    run_test "install script passes --upgrade flag" test_install_script_passes_upgrade_flag
    echo ""

    echo -e "${YELLOW}Test Suite: Upgrade Clean Rebuild${NC}"
    run_test "setup script has --upgrade flag" test_setup_script_has_upgrade_flag
    run_test "setup script uses --no-cache on upgrade" test_setup_script_uses_no_cache_on_upgrade
    run_test "start script --rebuild uses --no-cache" test_start_script_rebuild_uses_no_cache
    echo ""

    echo -e "${YELLOW}Test Suite: start.sh Enhancements${NC}"
    run_test "start script has SSL expiry check" test_start_script_has_ssl_expiry_check
    echo ""

    echo -e "${YELLOW}Test Suite: uninstall.sh${NC}"
    run_test "uninstall script exists" test_uninstall_script_exists
    run_test "uninstall script is executable" test_uninstall_script_is_executable
    run_test "uninstall script has --force option" test_uninstall_script_has_force_option
    run_test "uninstall script has --keep-data option" test_uninstall_script_has_keep_data_option
    run_test "uninstall script has confirmation" test_uninstall_script_has_confirmation
    run_test "uninstall script removes volumes" test_uninstall_script_removes_volumes
    echo ""

    echo -e "${YELLOW}Test Suite: scripts/setup.sh${NC}"
    run_test "setup script exists" test_setup_script_exists
    run_test "setup script has secret fallbacks" test_setup_script_has_secret_fallbacks
    run_test "setup script generates 48-char secrets" test_setup_script_generates_48_char_secrets
    run_test "setup script defaults to external runtime env" test_setup_script_defaults_to_external_runtime_env
    run_test "setup script keeps legacy env fallback" test_setup_script_keeps_legacy_env_fallback
    run_test "setup script defaults to external SSL dir" test_setup_script_defaults_to_external_ssl_dir
    echo ""

    echo -e "${YELLOW}Test Suite: .env.example${NC}"
    run_test ".env.example exists" test_env_example_exists
    run_test ".env.example has all required secrets" test_env_example_has_all_required_secrets
    run_test ".env.example has setup instructions" test_env_example_has_setup_instructions
    echo ""

    echo -e "${YELLOW}Test Suite: SSL Certificate Generation${NC}"
    run_test "generate-certs.sh exists" test_generate_certs_script_exists
    run_test "generate certs creates files" test_generate_certs_creates_files
    echo ""

    # Teardown
    teardown

    # Summary
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
