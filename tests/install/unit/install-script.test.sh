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
NGINX_ENTRYPOINT="$PROJECT_ROOT/docker/nginx/docker-entrypoint.sh"

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

assert_not_contains() {
    local haystack="$1"
    local needle="$2"
    local message="${3:-unexpected content found}"
    if [[ "$haystack" == *"$needle"* ]]; then
        echo -e "${RED}ASSERTION FAILED:${NC} $message"
        return 1
    fi
}

extract_shell_function() {
    local function_name="$1"
    local source_file="$2"

    awk -v function_name="$function_name" '
        $0 ~ "^" function_name "\\(\\)[[:space:]]*\\{" {
            in_function = 1
        }
        in_function {
            line = $0
            print line
            opens += gsub(/\{/, "{", line)
            closes += gsub(/\}/, "}", line)
            if (opens > 0 && opens == closes) {
                exit
            }
        }
    ' "$source_file"
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

test_install_script_detects_skip_checkout_upgrade_mode() {
    if grep -q 'SKIP_GIT_CHECKOUT' "$INSTALL_SCRIPT" \
        && grep -q "Existing runtime env detected" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should detect upgrade mode when skipping git checkout with an existing runtime env"
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
# Unit Tests: installer GitHub distribution behavior
# ============================================

setup_forge_installer_fixture() {
    local name="$1"

    FORGE_TEST_DIR="$TEST_TMP_DIR/forge-$name"
    FORGE_INSTALL_DIR="$FORGE_TEST_DIR/install"
    FORGE_FAKEBIN="$FORGE_TEST_DIR/fakebin"
    FORGE_STATE_DIR="$FORGE_TEST_DIR/state"
    FORGE_RUN_DIR="$FORGE_TEST_DIR/run"

    mkdir -p "$FORGE_INSTALL_DIR/.git" "$FORGE_INSTALL_DIR/scripts" "$FORGE_FAKEBIN" "$FORGE_STATE_DIR" "$FORGE_RUN_DIR"
    printf '%s\n' "github" > "$FORGE_STATE_DIR/remote-source"
    : > "$FORGE_STATE_DIR/git.log"

    cat > "$FORGE_INSTALL_DIR/scripts/setup.sh" <<'EOF'
#!/bin/bash
if [ -n "${FAKE_INSTALL_EVENT_LOG:-}" ]; then
    if [ -n "${SANCTUARY_DEPLOYMENT_LOCK_TOKEN:-}" ] \
        && [ -f "${FAKE_EXPECTED_LOCK_OWNER:-/missing}" ]; then
        node "$FAKE_DEPLOYMENT_SESSION_SCRIPT" assert-lock >/dev/null || exit 96
        echo "setup:lock-present" >> "$FAKE_INSTALL_EVENT_LOG"
    else
        echo "setup:lock-missing" >> "$FAKE_INSTALL_EVENT_LOG"
        exit 98
    fi
fi
exit 0
EOF
    chmod +x "$FORGE_INSTALL_DIR/scripts/setup.sh"

    cat > "$FORGE_FAKEBIN/docker" <<'EOF'
#!/bin/bash
if [ -n "${FAKE_INSTALL_EVENT_LOG:-}" ]; then
    printf 'docker:%s\n' "$*" >> "$FAKE_INSTALL_EVENT_LOG"
fi
if [ "$1" = "volume" ] && [ "$2" = "ls" ]; then
    if [ -n "${FAKE_EXPECTED_LOCK_OWNER:-}" ]; then
        if [ -f "$FAKE_EXPECTED_LOCK_OWNER" ]; then
            echo "database-inspection:lock-present" >> "$FAKE_INSTALL_EVENT_LOG"
        else
            echo "database-inspection:lock-missing" >> "$FAKE_INSTALL_EVENT_LOG"
            exit 95
        fi
    fi
    exit 0
fi
exit 0
EOF
    chmod +x "$FORGE_FAKEBIN/docker"

    cat > "$FORGE_FAKEBIN/curl" <<'EOF'
#!/bin/bash
url="${!#}"

if [[ "$url" == *"api.github.com/repos/nekoguntai-castle/sanctuary/releases/latest" ]]; then
    if [ "${FAKE_CURL_GITHUB_RELEASE:-v9.9.9}" = "fail" ]; then
        exit 22
    fi
    printf '{"tag_name":"%s"}\n' "${FAKE_CURL_GITHUB_RELEASE:-v9.9.9}"
    exit 0
fi

exit 22
EOF
    chmod +x "$FORGE_FAKEBIN/curl"

    cat > "$FORGE_FAKEBIN/git" <<'EOF'
#!/bin/bash
if [ "$1" = "-C" ]; then
    shift 2
fi

state_dir="${FAKE_FORGE_STATE_DIR:?missing FAKE_FORGE_STATE_DIR}"
remote_file="$state_dir/remote-source"
log_file="$state_dir/git.log"

source_from_url() {
    case "$1" in
        *codeberg.org*) echo "codeberg" ;;
        *github.com*) echo "github" ;;
        *) echo "unknown" ;;
    esac
}

url_for_source() {
    case "$1" in
        codeberg) echo "https://codeberg.org/nekoguntai-castle/sanctuary.git" ;;
        github) echo "https://github.com/nekoguntai-castle/sanctuary.git" ;;
        *) echo "https://unknown.invalid/sanctuary.git" ;;
    esac
}

current_source="$(cat "$remote_file" 2>/dev/null || echo github)"

case "$1" in
    config)
        if [ "$2" = "--get" ] && [ "$3" = "remote.origin.url" ]; then
            url_for_source "$current_source"
            exit 0
        fi
        ;;
    describe)
        echo "${FAKE_GIT_DESCRIBE:-v0.8.50}"
        exit 0
        ;;
    rev-parse)
        echo "abcdef0"
        exit 0
        ;;
    remote)
        case "$2" in
            get-url)
                url_for_source "$current_source"
                exit 0
                ;;
            set-url|add)
                next_source="$(source_from_url "$4")"
                echo "$next_source" > "$remote_file"
                echo "remote-$2:$next_source" >> "$log_file"
                exit 0
                ;;
        esac
        ;;
    fetch)
        if [ -n "${FAKE_EXPECTED_LOCK_OWNER:-}" ]; then
            if [ -f "$FAKE_EXPECTED_LOCK_OWNER" ]; then
                echo "fetch:lock-present" >> "$FAKE_INSTALL_EVENT_LOG"
            else
                echo "fetch:lock-missing" >> "$FAKE_INSTALL_EVENT_LOG"
                exit 97
            fi
        fi
        current_source="$(cat "$remote_file" 2>/dev/null || echo github)"
        fetch_args=" $* "
        if [[ "$fetch_args" == *" --force "* ]]; then
            echo "fetch-force:$current_source" >> "$log_file"
        else
            echo "fetch:$current_source" >> "$log_file"
        fi
        if [ "$current_source" = "github" ] && [ "${FAKE_GIT_FETCH_CLOBBER_GITHUB:-false}" = "true" ] && [[ "$fetch_args" != *" --force "* ]]; then
            echo ' ! [rejected]            v0.7.4      -> v0.7.4  (would clobber existing tag)' >&2
            exit 1
        fi
        if [ "$current_source" = "github" ] && [ "${FAKE_GIT_FETCH_FAIL_GITHUB:-false}" = "true" ]; then
            exit 1
        fi
        exit 0
        ;;
    checkout)
        echo "checkout:$2" >> "$log_file"
        exit 0
        ;;
    ls-remote)
        url="${!#}"
        source="$(source_from_url "$url")"
        echo "ls-remote:$source" >> "$log_file"
        if [ "$source" = "github" ] && [ "${FAKE_GIT_LS_REMOTE_FAIL_GITHUB:-false}" = "true" ]; then
            exit 1
        fi
        printf 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v9.9.9-rc1\n'
        printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v9.9.9\n'
        exit 0
        ;;
    clone)
        url="$2"
        target="$3"
        source="$(source_from_url "$url")"
        echo "clone:$source" >> "$log_file"
        if [ "$source" = "github" ] && [ "${FAKE_GIT_CLONE_FAIL_GITHUB:-false}" = "true" ]; then
            exit 1
        fi
        mkdir -p "$target/.git" "$target/scripts"
        printf '#!/bin/bash\nexit 0\n' > "$target/scripts/setup.sh"
        chmod +x "$target/scripts/setup.sh"
        exit 0
        ;;
esac

echo "unexpected git command: $*" >> "$log_file"
exit 1
EOF
    chmod +x "$FORGE_FAKEBIN/git"
}

run_forge_installer() {
    local output_file="$1"
    shift

    (
        cd "$FORGE_RUN_DIR"
        PATH="$FORGE_FAKEBIN:$PATH" \
            FAKE_FORGE_STATE_DIR="$FORGE_STATE_DIR" \
            FAKE_CURL_GITHUB_RELEASE="${FAKE_CURL_GITHUB_RELEASE:-v9.9.9}" \
            FAKE_GIT_FETCH_FAIL_GITHUB="${FAKE_GIT_FETCH_FAIL_GITHUB:-false}" \
            FAKE_GIT_FETCH_CLOBBER_GITHUB="${FAKE_GIT_FETCH_CLOBBER_GITHUB:-false}" \
            FAKE_GIT_LS_REMOTE_FAIL_GITHUB="${FAKE_GIT_LS_REMOTE_FAIL_GITHUB:-false}" \
            FAKE_GIT_CLONE_FAIL_GITHUB="${FAKE_GIT_CLONE_FAIL_GITHUB:-false}" \
            FAKE_GIT_DESCRIBE="${FAKE_GIT_DESCRIBE:-v0.8.50}" \
            SANCTUARY_DIR="$FORGE_INSTALL_DIR" \
            SANCTUARY_ASSUME_YES=true \
            SANCTUARY_SKIP_UPGRADE_BACKUP=true \
            SANCTUARY_ENV_FILE="$FORGE_STATE_DIR/runtime.env" \
            SANCTUARY_RUNTIME_DIR="$FORGE_STATE_DIR/runtime" \
            FAKE_INSTALL_EVENT_LOG="${FAKE_INSTALL_EVENT_LOG:-}" \
            FAKE_EXPECTED_LOCK_OWNER="${FAKE_EXPECTED_LOCK_OWNER:-}" \
            FAKE_DEPLOYMENT_SESSION_SCRIPT="$PROJECT_ROOT/scripts/ownership/deployment-session.mjs" \
            bash "$INSTALL_SCRIPT" "$@" > "$output_file" 2>&1
    )
}

test_streamed_installer_locks_legacy_upgrade_without_sourcing_checkout_helpers() {
    setup_forge_installer_fixture "legacy-lock-bootstrap"
    local output="$FORGE_STATE_DIR/output.log"
    local event_log="$FORGE_STATE_DIR/events.log"
    local marker="$FORGE_STATE_DIR/untrusted-helper-ran"
    local lock_owner="$FORGE_STATE_DIR/runtime/ownership/deployments/deploy-sanctuary/mutation-lock/owner.json"
    local legacy_state="$FORGE_INSTALL_DIR/legacy-wallet-state"

    mkdir -p "$FORGE_INSTALL_DIR/scripts/ownership"
    printf 'wallet-state-must-survive\n' > "$legacy_state"
    cat > "$FORGE_INSTALL_DIR/scripts/ownership/producer-hooks.sh" <<EOF
#!/bin/bash
touch "$marker"
exit 99
EOF
    cat > "$FORGE_INSTALL_DIR/scripts/ownership/deployment-lifecycle.sh" <<EOF
#!/bin/bash
touch "$marker"
exit 99
EOF
    : > "$event_log"

    FAKE_GIT_DESCRIBE=v0.8.69 \
    FAKE_INSTALL_EVENT_LOG="$event_log" \
    FAKE_EXPECTED_LOCK_OWNER="$lock_owner" \
        run_forge_installer "$output" || {
        cat "$output"
        return 1
    }

    [ ! -e "$marker" ] || {
        echo -e "${RED}ASSERTION FAILED:${NC} streamed installer sourced unverified legacy checkout code"
        return 1
    }
    assert_equals "wallet-state-must-survive" "$(cat "$legacy_state")" \
        "legacy application state should be preserved" || return 1
    assert_contains "$(cat "$event_log")" "fetch:lock-present" \
        "upgrade fetch must run under the deployment lock" || return 1
    assert_contains "$(cat "$event_log")" "database-inspection:lock-present" \
        "upgrade backup discovery must run under the deployment lock" || return 1
    assert_contains "$(cat "$event_log")" "setup:lock-present" \
        "updated setup must inherit the installer lock" || return 1
    assert_not_contains "$(cat "$event_log")" "lock-missing" \
        "no upgrade mutation may precede lock acquisition" || return 1
    [ ! -e "$lock_owner" ] || {
        echo -e "${RED}ASSERTION FAILED:${NC} installer lock should be released at exit"
        return 1
    }
    if grep -Eq '^docker:(compose down|volume rm|network rm|rm )' "$event_log"; then
        echo -e "${RED}ASSERTION FAILED:${NC} legacy upgrade performed destructive Docker cleanup"
        cat "$event_log"
        return 1
    fi
}

test_streamed_installer_preserves_legacy_upgrade_on_lock_conflict() {
    setup_forge_installer_fixture "legacy-lock-conflict"
    local output="$FORGE_STATE_DIR/output.log"
    local lock_dir="$FORGE_STATE_DIR/runtime/ownership/deployments/deploy-sanctuary/mutation-lock"
    local legacy_state="$FORGE_INSTALL_DIR/legacy-wallet-state"

    mkdir -p "$lock_dir"
    chmod 700 "$FORGE_STATE_DIR/runtime/ownership/deployments/deploy-sanctuary" "$lock_dir"
    printf 'preexisting-lock\n' > "$lock_dir/owner.json"
    printf 'wallet-state-must-survive\n' > "$legacy_state"

    if FAKE_GIT_DESCRIBE=v0.8.69 run_forge_installer "$output"; then
        echo -e "${RED}ASSERTION FAILED:${NC} conflicting legacy upgrade lock should be refused"
        return 1
    fi

    assert_contains "$(cat "$output")" "deployment mutation lock is already held" \
        "lock conflict should be explicit" || return 1
    assert_not_contains "$(cat "$FORGE_STATE_DIR/git.log")" "fetch:" \
        "lock conflict must precede repository mutation" || return 1
    assert_not_contains "$(cat "$FORGE_STATE_DIR/git.log")" "checkout:" \
        "lock conflict must precede checkout mutation" || return 1
    assert_equals "wallet-state-must-survive" "$(cat "$legacy_state")" \
        "lock conflict must preserve legacy application state" || return 1
    assert_equals "preexisting-lock" "$(cat "$lock_dir/owner.json")" \
        "installer must not alter a competing lock" || return 1
}

test_existing_installation_rewrites_stale_origin_to_github() {
    setup_forge_installer_fixture "stale-origin"
    printf '%s\n' "codeberg" > "$FORGE_STATE_DIR/remote-source"
    local output="$FORGE_STATE_DIR/output.log"

    run_forge_installer "$output" || {
        cat "$output"
        return 1
    }

    local log
    log="$(cat "$FORGE_STATE_DIR/git.log")"
    assert_contains "$log" "remote-set-url:github" "upgrade should rewrite a stale origin to GitHub" || return 1
    assert_contains "$log" "fetch:github" "upgrade should fetch from GitHub" || return 1
    if echo "$log" | grep -q "fetch:codeberg"; then
        echo -e "${RED}ASSERTION FAILED:${NC} upgrade should not fetch from the stale origin"
        echo "$log"
        return 1
    fi
}

test_online_codeberg_source_is_rejected() {
    setup_forge_installer_fixture "source-rejected"
    local output="$FORGE_STATE_DIR/output.log"

    if run_forge_installer "$output" --source codeberg; then
        echo -e "${RED}ASSERTION FAILED:${NC} online Codeberg source should be rejected"
        cat "$output"
        return 1
    fi

    assert_contains "$(cat "$output")" "Online installation is GitHub-only" "failure should explain the supported source" || return 1
    if [ -s "$FORGE_STATE_DIR/git.log" ]; then
        echo -e "${RED}ASSERTION FAILED:${NC} rejected source should not invoke git"
        cat "$FORGE_STATE_DIR/git.log"
        return 1
    fi
}

test_explicit_github_source_remains_compatible() {
    setup_forge_installer_fixture "github-compatibility"
    local output="$FORGE_STATE_DIR/output.log"

    run_forge_installer "$output" --source github || {
        cat "$output"
        return 1
    }

    local log
    log="$(cat "$FORGE_STATE_DIR/git.log")"
    assert_contains "$log" "fetch:github" "legacy explicit GitHub source should remain a no-op compatibility option"
}

test_github_fetch_failure_is_clear_and_does_not_fall_back() {
    setup_forge_installer_fixture "github-unreachable"
    local output="$FORGE_STATE_DIR/output.log"

    if FAKE_GIT_FETCH_FAIL_GITHUB=true run_forge_installer "$output"; then
        echo -e "${RED}ASSERTION FAILED:${NC} GitHub fetch failure should fail install"
        cat "$output"
        return 1
    fi

    local log
    log="$(cat "$FORGE_STATE_DIR/git.log")"
    assert_contains "$log" "fetch:github" "installer should attempt GitHub fetch" || return 1
    assert_contains "$(cat "$output")" "Could not fetch updates from GitHub" "failure should identify GitHub" || return 1
    if echo "$log" | grep -q "fetch:codeberg"; then
        echo -e "${RED}ASSERTION FAILED:${NC} GitHub failure should not fall back"
        echo "$log"
        return 1
    fi
}

test_github_tag_clobber_retries_forced_tags() {
    setup_forge_installer_fixture "tag-clobber"
    local output="$FORGE_STATE_DIR/output.log"

    FAKE_GIT_FETCH_CLOBBER_GITHUB=true run_forge_installer "$output" || {
        cat "$output"
        return 1
    }

    local log
    log="$(cat "$FORGE_STATE_DIR/git.log")"
    assert_contains "$log" "fetch:github" "tag-clobber recovery should first try a normal GitHub fetch" || return 1
    assert_contains "$log" "fetch-force:github" "tag-clobber recovery should force-refresh GitHub tags" || return 1
    assert_contains "$(cat "$output")" "Refreshing tags from the canonical source" "operator should see why tags are refreshed"
}

test_release_api_failure_uses_github_tags() {
    setup_forge_installer_fixture "release-tag-fallback"
    local output="$FORGE_STATE_DIR/output.log"

    FAKE_CURL_GITHUB_RELEASE=fail run_forge_installer "$output" || {
        cat "$output"
        return 1
    }

    local log
    log="$(cat "$FORGE_STATE_DIR/git.log")"
    assert_contains "$log" "ls-remote:github" "release lookup should fall back to GitHub tags" || return 1
    assert_contains "$log" "checkout:v9.9.9" "GitHub tag fallback should select the discovered release"
    if echo "$log" | grep -q "checkout:v9.9.9-rc1"; then
        echo -e "${RED}ASSERTION FAILED:${NC} stable installer fallback should not select a release candidate"
        return 1
    fi
}

test_clean_install_clones_github() {
    setup_forge_installer_fixture "clean-clone"
    mv "$FORGE_INSTALL_DIR" "$FORGE_TEST_DIR/existing-install-fixture"
    local output="$FORGE_STATE_DIR/output.log"

    run_forge_installer "$output" || {
        cat "$output"
        return 1
    }

    local log
    log="$(cat "$FORGE_STATE_DIR/git.log")"
    assert_contains "$log" "clone:github" "clean install should clone GitHub" || return 1
    assert_contains "$log" "checkout:v9.9.9" "clean install should check out the GitHub release tag"
}

test_clean_install_github_failure_is_clear_and_atomic() {
    setup_forge_installer_fixture "clone-failure"
    mv "$FORGE_INSTALL_DIR" "$FORGE_TEST_DIR/existing-install-fixture"
    local output="$FORGE_STATE_DIR/output.log"

    if FAKE_GIT_CLONE_FAIL_GITHUB=true run_forge_installer "$output"; then
        echo -e "${RED}ASSERTION FAILED:${NC} GitHub clone failure should fail install"
        cat "$output"
        return 1
    fi

    assert_contains "$(cat "$output")" "Could not clone Sanctuary from GitHub" "clone failure should identify GitHub" || return 1
    if compgen -G "$FORGE_TEST_DIR/.sanctuary-clone.*" > /dev/null; then
        echo -e "${RED}ASSERTION FAILED:${NC} failed clone should remove its temporary directory"
        return 1
    fi
}

test_offline_prepared_ignores_legacy_source_option() {
    setup_forge_installer_fixture "offline-source"
    local output="$FORGE_STATE_DIR/output.log"

    run_forge_installer "$output" --offline-prepared --source codeberg || {
        cat "$output"
        return 1
    }

    assert_contains "$(cat "$output")" "Offline bundle" "offline-prepared behavior should not depend on an online source"
}

test_install_script_uses_only_github_online_distribution() {
    if grep -qi "codeberg.org" "$INSTALL_SCRIPT"; then
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should not contain a Codeberg online endpoint"
        return 1
    fi

    grep -q "raw.githubusercontent.com/nekoguntai-castle/sanctuary/main/install.sh" "$INSTALL_SCRIPT" \
        && grep -q "https://github.com/nekoguntai-castle/sanctuary.git" "$INSTALL_SCRIPT" \
        && grep -q "https://api.github.com/repos/nekoguntai-castle/sanctuary/releases/latest" "$INSTALL_SCRIPT"
}

# ============================================
# Unit Tests: start.sh file structure
# ============================================

START_SCRIPT="$PROJECT_ROOT/start.sh"
POSTGRES_RECONCILE_SCRIPT="$PROJECT_ROOT/scripts/reconcile-postgres-password.sh"

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

test_start_script_reconciles_postgres_password() {
    if grep -q "scripts/reconcile-postgres-password.sh" "$START_SCRIPT" \
        && grep -q "start_compose_stack" "$START_SCRIPT" \
        && grep -q "psql -w -h postgres" "$POSTGRES_RECONCILE_SCRIPT" \
        && grep -q "ALTER USER" "$POSTGRES_RECONCILE_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should reconcile Postgres role password before app startup"
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

test_start_script_help_is_mutation_free() {
    local fixture_dir="$TEST_TMP_DIR/start-llm-secret"
    local env_file="$fixture_dir/sanctuary.env"
    local output=""
    local contents=""

    mkdir -p "$fixture_dir/bin"
    cat > "$env_file" << EOF
JWT_SECRET=test-jwt-secret
ENCRYPTION_KEY=test-encryption-key
GATEWAY_SECRET=test-gateway-secret
POSTGRES_PASSWORD=test-postgres-password
EOF

    cat > "$fixture_dir/bin/docker" << 'EOF'
#!/bin/sh
case "$*" in
  "info"|"compose version"|"image inspect sanctuary-backend:local"|"image inspect sanctuary-frontend:local"|"image inspect sanctuary-gateway:local")
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOF
    chmod +x "$fixture_dir/bin/docker"

    output=$(
        SANCTUARY_ENV_FILE="$env_file" \
        SANCTUARY_RUNTIME_DIR="$fixture_dir/runtime" \
        LLM_EGRESS_PROXY_SECRET= \
        PATH="$fixture_dir/bin:$PATH" \
        bash "$START_SCRIPT" --help 2>&1
    ) || {
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh --help should remain available"
        echo "$output"
        return 1
    }

    contents="$(cat "$env_file")"
    assert_not_contains "$contents" "LLM_EGRESS_PROXY_SECRET=" \
        "start.sh --help must not mutate the runtime environment"
}

test_backend_compose_exposes_auth_rate_limit_overrides() {
    if grep -q 'RATE_LIMIT_LOGIN:.*RATE_LIMIT_LOGIN' "$PROJECT_ROOT/docker-compose.yml" \
        && grep -q 'RATE_LIMIT_2FA:.*RATE_LIMIT_2FA' "$PROJECT_ROOT/docker-compose.yml" \
        && grep -q 'RATE_LIMIT_PASSWORD_CHANGE:.*RATE_LIMIT_PASSWORD_CHANGE' "$PROJECT_ROOT/docker-compose.yml" \
        && grep -q 'RATE_LIMIT_LOGIN RATE_LIMIT_2FA RATE_LIMIT_PASSWORD_CHANGE' "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} backend compose/start path should expose auth rate-limit overrides"
        return 1
    fi
}

test_llm_egress_proxy_maps_host_gateway_for_host_providers() {
    local service_block
    service_block="$(
        awk '
            /^  llm-egress-proxy:/ { in_service=1; next }
            /^  [A-Za-z0-9_-]+:/ { if (in_service) exit }
            in_service { print }
        ' "$PROJECT_ROOT/docker-compose.yml"
    )"

    if echo "$service_block" | grep -Fq 'host.docker.internal:host-gateway'; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} llm-egress-proxy should map host.docker.internal for host-local LLM providers"
        return 1
    fi
}

test_worker_compose_command_matches_backend_dist_layout() {
    if grep -Fq 'command: ["node", "dist/server/src/worker.js"]' "$PROJECT_ROOT/docker-compose.yml" \
        && ! grep -Fq 'dist/app/src/worker.js' "$PROJECT_ROOT/docker-compose.yml"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} worker compose command should match backend image dist/server layout"
        return 1
    fi
}

test_mcp_compose_command_matches_backend_dist_layout() {
    if grep -Fq 'command: ["node", "dist/server/src/mcp-entry.js"]' "$PROJECT_ROOT/docker-compose.yml" \
        && ! grep -Fq 'dist/app/src/mcp-entry.js' "$PROJECT_ROOT/docker-compose.yml"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} MCP compose command should match backend image dist/server layout"
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
    if grep -q "create_upgrade_backup_or_prompt\|create-upgrade-backup.sh\|pg_dump" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should provide local backup handling for upgrades"
        return 1
    fi
}

test_install_script_supports_offline_bundle() {
    if grep -q -- "--offline-bundle" "$INSTALL_SCRIPT" \
        && grep -q "SANCTUARY_OFFLINE_BUNDLE" "$INSTALL_SCRIPT" \
        && grep -q -- "--allow-downgrade" "$INSTALL_SCRIPT" \
        && grep -q "apply-bundle.sh" "$INSTALL_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} install.sh should support signed offline bundle upgrades"
        return 1
    fi
}

test_setup_script_supports_offline_mode() {
    if grep -q -- "--offline" "$SETUP_SCRIPT" \
        && grep -q "validate_offline_images" "$SETUP_SCRIPT" \
        && grep -q "true|yes|1" "$SETUP_SCRIPT" \
        && grep -q -- "--no-build" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should support offline no-build startup"
        return 1
    fi
}

test_setup_offline_mode_overrides_existing_online_metadata() {
    local test_root env_file
    test_root=$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-offline-metadata-test.XXXXXX")
    env_file="$test_root/sanctuary.env"

    cat > "$env_file" <<'EOF'
JWT_SECRET=test-jwt-secret
ENCRYPTION_KEY=test-encryption-key
ENCRYPTION_SALT=test-encryption-salt
GATEWAY_SECRET=test-gateway-secret
WORKER_DIAGNOSTICS_SECRET=0000000000000000000000000000000000000000000000000000000000000000
POSTGRES_PASSWORD=test-postgres-password
LLM_EGRESS_PROXY_SECRET=0000000000000000000000000000000000000000000000000000000000000000
REDIS_PASSWORD=test-redis-password
SANCTUARY_INSTALL_MODE=online
SANCTUARY_OFFLINE_VERSION=
EOF

    SANCTUARY_RUNTIME_DIR="$test_root" \
    SANCTUARY_ENV_FILE="$env_file" \
    SANCTUARY_SSL_DIR="$test_root/ssl" \
    SANCTUARY_INSTALL_MODE=offline \
    SANCTUARY_OFFLINE_VERSION=v0.8.58-rc.9 \
        bash "$SETUP_SCRIPT" --offline --force --non-interactive --no-start --skip-ssl --skip-prereqs \
        >/dev/null 2>&1

    local result=0
    grep -qx 'SANCTUARY_INSTALL_MODE=offline' "$env_file" || result=1
    grep -qx 'SANCTUARY_OFFLINE_VERSION=v0.8.58-rc.9' "$env_file" || result=1
    find "$test_root" -type f -delete
    find "$test_root" -type l -delete
    find "$test_root" -depth -type d -empty -delete
    return "$result"
}

test_start_script_refuses_offline_rebuild() {
    if grep -q "SANCTUARY_INSTALL_MODE" "$START_SCRIPT" \
        && grep -q "SANCTUARY_ALLOW_OFFLINE_REBUILD" "$START_SCRIPT" \
        && grep -q "offline bundle" "$START_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} start.sh should refuse offline rebuilds by default"
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

test_setup_script_recovers_corrupt_buildkit_cache() {
    local build_body
    build_body="$(extract_shell_function "run_compose_build" "$SETUP_SCRIPT")"

    assert_contains "$build_body" "compose_build_failed_due_to_cache_corruption" \
        "setup.sh build wrapper should detect cache-corruption failures" || return 1
    assert_contains "$build_body" "recover_docker_builder_cache" \
        "setup.sh should recover corrupt Docker builder cache before retrying" || return 1
    assert_contains "$build_body" 'docker compose "${COMPOSE_FILE_ARGS[@]}" build --no-cache' \
        "setup.sh should retry corrupt BuildKit failures with a clean no-cache build" || return 1

    local detector_body
    detector_body="$(extract_shell_function "compose_build_failed_due_to_cache_corruption" "$SETUP_SCRIPT")"
    assert_contains "$detector_body" "archive/tar: invalid tar header" \
        "setup.sh should recognize BuildKit invalid tar cache failures" || return 1
    assert_contains "$detector_body" "failed to extract layer" \
        "setup.sh should recognize layer extraction cache failures"
}

test_setup_script_does_not_rebuild_during_compose_up_after_build() {
    local start_body
    start_body="$(extract_shell_function "start_services" "$SETUP_SCRIPT")"

    assert_contains "$start_body" "run_compose_build \$BUILD_ARGS" \
        "setup.sh should route image builds through the retrying build wrapper" || return 1
    assert_contains "$start_body" "compose_up_after_build_args" \
        "setup.sh should use no-build compose-up args after a successful build" || return 1

    local up_args_body
    up_args_body="$(extract_shell_function "compose_up_after_build_args" "$SETUP_SCRIPT")"
    assert_contains "$up_args_body" "-d --no-build" \
        "post-build compose up should not trigger another image build"
}

test_setup_script_retries_corrupt_buildkit_cache_with_fake_docker() {
    local fixture_dir="$TEST_TMP_DIR/buildkit-recovery"
    local fakebin="$fixture_dir/bin"
    local env_file="$fixture_dir/runtime/sanctuary.env"
    local ssl_dir="$fixture_dir/runtime/ssl"
    local log_file="$fixture_dir/docker.log"
    local count_file="$fixture_dir/build-count"
    local output=""

    mkdir -p "$fakebin" "$(dirname "$env_file")" "$ssl_dir"

    cat > "$fakebin/docker" <<'EOF'
#!/usr/bin/env bash
set -e

log_file="${FAKE_DOCKER_LOG:?}"
count_file="${FAKE_DOCKER_BUILD_COUNT:?}"

if [ "$1" = "compose" ]; then
    shift
    while [ "$#" -gt 0 ]; do
        case "$1" in
            -f|--file|--project-directory|--env-file|-p)
                shift 2
                ;;
            *)
                break
                ;;
        esac
    done
    case "$1" in
        config)
            if [ "${2:-}" = "--format" ] && [ "${3:-}" = "json" ]; then
                echo '{"services":{},"networks":{},"volumes":{}}'
            else
                printf '%s\n' backend frontend worker postgres
            fi
            exit 0
            ;;
        version)
            echo "Docker Compose version v5.1.3"
            exit 0
            ;;
        build)
            shift
            printf 'compose build:%s\n' "$*" >> "$log_file"
            count=0
            [ -f "$count_file" ] && count="$(cat "$count_file")"
            count=$((count + 1))
            printf '%s\n' "$count" > "$count_file"
            if [ "$count" -eq 1 ]; then
                echo "target backend: failed to solve: failed to extract layer sha256:deadbeef: archive/tar: invalid tar header" >&2
                exit 1
            fi
            case " $* " in
                *" --no-cache "*)
                    exit 0
                    ;;
                *)
                    echo "retry must use --no-cache" >&2
                    exit 1
                    ;;
            esac
            ;;
        up)
            shift
            if [ "${1:-}" = "--help" ]; then
                echo "Usage: docker compose up [--wait] [--pull]"
                exit 0
            fi
            printf 'compose up:%s\n' "$*" >> "$log_file"
            case " $* " in
                *" --no-build "*)
                    exit 0
                    ;;
                *)
                    echo "compose up must use --no-build after setup build" >&2
                    exit 1
                    ;;
            esac
            ;;
        exec)
            exit 0
            ;;
        ps)
            exit 0
            ;;
    esac
fi

if [ "$1" = "builder" ] && [ "${2:-}" = "prune" ]; then
    printf 'builder prune:%s\n' "${*:2}" >> "$log_file"
    exit 0
fi

if [ "$1" = "image" ] && [ "${2:-}" = "inspect" ]; then
    case "${3:-}" in
        sanctuary-*) exit 0 ;;
        *) exit 1 ;;
    esac
fi

if [ "$1" = "pull" ]; then
    printf 'docker pull:%s\n' "${2:-}" >> "$log_file"
    exit 0
fi

if [ "$1" = "ps" ]; then
    exit 0
fi

if [[ "$1" =~ ^(volume|network|container)$ ]] && [ "${2:-}" = "ls" ]; then
    exit 0
fi

printf 'unexpected docker command:%s\n' "$*" >> "$log_file"
exit 1
EOF
    chmod +x "$fakebin/docker"

    output=$(
        PATH="$fakebin:$PATH" \
            FAKE_DOCKER_LOG="$log_file" \
            FAKE_DOCKER_BUILD_COUNT="$count_file" \
            SANCTUARY_ENV_FILE="$env_file" \
            SANCTUARY_RUNTIME_DIR="$fixture_dir/runtime" \
            SANCTUARY_SSL_DIR="$ssl_dir" \
            HTTPS_PORT=58445 \
            HTTP_PORT=58082 \
            GATEWAY_PORT=54002 \
            ENABLE_MONITORING=no \
            ENABLE_TOR=no \
            bash "$SETUP_SCRIPT" --force --non-interactive --skip-ssl --skip-prereqs 2>&1
    ) || {
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should recover a corrupt BuildKit cache failure"
        echo "$output"
        [ -f "$log_file" ] && cat "$log_file"
        return 1
    }

    local log
    log="$(cat "$log_file")"
    assert_contains "$log" "compose build:" \
        "setup.sh should run an initial compose build" || return 1
    assert_contains "$log" "docker pull:tecnativa/docker-socket-proxy:latest@sha256:1f5038b54f06c3e18422902cf00ba21803d1c97805aae032e5e6673d532d3459" \
        "setup.sh should explicitly pull a missing digest-pinned runtime image" || return 1
    assert_contains "$log" "builder prune:prune --force" \
        "setup.sh should clear builder cache before retrying" || return 1
    assert_contains "$log" "compose build:--no-cache" \
        "setup.sh should retry the failed build with --no-cache" || return 1
    assert_contains "$log" "compose up:-d --no-build postgres" \
        "setup.sh should start postgres without rebuilding after build" || return 1
    assert_contains "$log" "compose up:-d --no-build --wait" \
        "setup.sh should start the full stack without rebuilding after build" || return 1
    assert_contains "$output" "Docker builder cache appears to be corrupt" \
        "setup.sh should explain the targeted BuildKit cache recovery" || return 1
    assert_contains "$output" "::error title=CI timing::compose build completed in" \
        "setup.sh should time failed compose builds without hiding the exit code" || return 1
    assert_contains "$output" "::notice title=CI timing::compose build cache-recovery retry completed in" \
        "setup.sh should time the cache-recovery compose build retry"
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

test_setup_script_requires_routed_api_readiness() {
    local contents main_body call_count
    contents="$(cat "$SETUP_SCRIPT")"
    main_body="$(extract_shell_function "main" "$SETUP_SCRIPT")"

    assert_contains "$contents" "wait_for_routed_api()" \
        "setup.sh should define a browser-routed API readiness gate" || return 1
    assert_contains "$contents" "/api/v1/health" \
        "setup.sh should probe the backend through the frontend route" || return 1
    assert_contains "$contents" 'docker compose "${COMPOSE_FILE_ARGS[@]}" exec -T frontend' \
        "setup.sh should use the required frontend container for its routed probe" || return 1
    call_count="$(grep -c '^[[:space:]]*wait_for_routed_api$' <<< "$main_body")"
    assert_equals "2" "$call_count" \
        "setup.sh should gate both noninteractive and interactive startup paths"
}

test_nginx_entrypoint_selects_runtime_dns_resolver() {
    local resolver_body
    local docker_resolv="$TEST_TMP_DIR/resolv-docker.conf"
    local podman_resolv="$TEST_TMP_DIR/resolv-podman.conf"
    local dual_stack_resolv="$TEST_TMP_DIR/resolv-dual-stack.conf"
    local malformed_resolv="$TEST_TMP_DIR/resolv-malformed.conf"
    local output

    resolver_body="$(extract_shell_function "resolve_dns_resolver" "$NGINX_ENTRYPOINT")"
    printf 'nameserver 127.0.0.11\n' > "$docker_resolv"
    printf 'nameserver 10.89.0.1\n' > "$podman_resolv"
    printf 'nameserver fd00::1\nnameserver 10.89.0.1\n' > "$dual_stack_resolv"
    printf 'nameserver 999.2.3.4\nnameserver not-an-address\n' > "$malformed_resolv"

    output="$(NGINX_RESOLV_CONF_PATH="$docker_resolv" bash -c "$resolver_body; resolve_dns_resolver")" || return 1
    assert_equals "127.0.0.11" "$output" "Docker DNS resolver should be selected" || return 1
    output="$(NGINX_RESOLV_CONF_PATH="$podman_resolv" bash -c "$resolver_body; resolve_dns_resolver")" || return 1
    assert_equals "10.89.0.1" "$output" "Podman DNS resolver should be selected" || return 1
    output="$(NGINX_RESOLV_CONF_PATH="$dual_stack_resolv" bash -c "$resolver_body; resolve_dns_resolver")" || return 1
    assert_equals "10.89.0.1" "$output" "valid IPv4 should be selected after an IPv6 resolver" || return 1

    if NGINX_RESOLV_CONF_PATH="$malformed_resolv" bash -c "$resolver_body; resolve_dns_resolver" \
        > "$TEST_TMP_DIR/resolver-malformed.out" 2> "$TEST_TMP_DIR/resolver-malformed.err"; then
        echo -e "${RED}ASSERTION FAILED:${NC} malformed resolvers should fail closed"
        return 1
    fi
    assert_contains "$(cat "$TEST_TMP_DIR/resolver-malformed.err")" "no valid IPv4 nameserver" \
        "malformed resolver diagnostics should be visible on stderr" || return 1

    if NGINX_RESOLV_CONF_PATH="$TEST_TMP_DIR/missing-resolv.conf" bash -c "$resolver_body; resolve_dns_resolver" \
        > "$TEST_TMP_DIR/resolver-missing.out" 2> "$TEST_TMP_DIR/resolver-missing.err"; then
        echo -e "${RED}ASSERTION FAILED:${NC} missing resolv.conf should fail closed"
        return 1
    fi
    assert_contains "$(cat "$TEST_TMP_DIR/resolver-missing.err")" "no valid IPv4 nameserver" \
        "missing resolver diagnostics should be visible on stderr"
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

test_setup_script_skips_postgres_reconcile_when_no_start() {
    if grep -q 'if \[ "$OPT_NO_START" = false \]; then' "$SETUP_SCRIPT" \
        && grep -q "reconcile_postgres_password_with_running_database" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should not reconcile the live Postgres role for --no-start test/setup runs"
        return 1
    fi
}

test_setup_script_reconciles_postgres_after_starting_database() {
    if grep -q "scripts/reconcile-postgres-password.sh" "$SETUP_SCRIPT" \
        && grep -q "up .*postgres" "$SETUP_SCRIPT"; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should start Postgres before running password reconciliation"
        return 1
    fi
}

test_setup_script_rejects_missing_salt_for_existing_key() {
    local env_file="$TEST_TMP_DIR/legacy-missing-salt.env"
    local ssl_dir="$TEST_TMP_DIR/ssl"
    local output=""
    local exit_code=0

    cat > "$env_file" << 'EOF'
JWT_SECRET=legacy-jwt-secret-value-for-upgrade-tests
ENCRYPTION_KEY=legacy-encryption-key-value-for-upgrade-tests-123456
GATEWAY_SECRET=legacy-gateway-secret-value-for-upgrade-tests
POSTGRES_PASSWORD=legacy-postgres-password
LLM_EGRESS_PROXY_SECRET=legacy-llm-egress-proxy-secret
REDIS_PASSWORD=legacy-redis-password
HTTPS_PORT=58443
HTTP_PORT=58080
GATEWAY_PORT=54000
ENABLE_MONITORING=no
ENABLE_TOR=no
EOF

    set +e
    output=$(
        export SANCTUARY_ENV_FILE="$env_file"
        export SANCTUARY_RUNTIME_DIR="$TEST_TMP_DIR/runtime-fresh-salt"
        export SANCTUARY_SSL_DIR="$ssl_dir"
        export HTTPS_PORT=58443
        export HTTP_PORT=58080
        export GATEWAY_PORT=54000
        export ENABLE_MONITORING=no
        export ENABLE_TOR=no
        bash "$SETUP_SCRIPT" --force --non-interactive --no-start --skip-ssl --skip-prereqs 2>&1
    )
    exit_code=$?
    set -e

    if [ "$exit_code" -eq 0 ]; then
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should reject legacy env missing ENCRYPTION_SALT"
        echo "$output"
        return 1
    fi

    if grep -q '^ENCRYPTION_SALT=sanctuary-node-config$' "$env_file"; then
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should not write the rejected legacy default salt"
        return 1
    fi

    assert_contains "$output" "Existing ENCRYPTION_KEY found without ENCRYPTION_SALT" \
        "setup.sh should explain missing salt rejection"
    assert_contains "$output" "Do not generate a new salt over encrypted data" \
        "setup.sh should warn against breaking encrypted data"
}

test_setup_script_rejects_legacy_default_salt() {
    local env_file="$TEST_TMP_DIR/legacy-default-salt.env"
    local ssl_dir="$TEST_TMP_DIR/ssl-legacy-default"
    local output=""
    local exit_code=0

    cat > "$env_file" << 'EOF'
JWT_SECRET=legacy-jwt-secret-value-for-upgrade-tests
ENCRYPTION_KEY=legacy-encryption-key-value-for-upgrade-tests-123456
ENCRYPTION_SALT=sanctuary-node-config
GATEWAY_SECRET=legacy-gateway-secret-value-for-upgrade-tests
POSTGRES_PASSWORD=legacy-postgres-password
LLM_EGRESS_PROXY_SECRET=legacy-llm-egress-proxy-secret
REDIS_PASSWORD=legacy-redis-password
HTTPS_PORT=58445
HTTP_PORT=58082
GATEWAY_PORT=54002
ENABLE_MONITORING=no
ENABLE_TOR=no
EOF

    set +e
    output=$(
        export SANCTUARY_ENV_FILE="$env_file"
        export SANCTUARY_RUNTIME_DIR="$TEST_TMP_DIR/runtime-egress-policy"
        export SANCTUARY_SSL_DIR="$ssl_dir"
        export HTTPS_PORT=58445
        export HTTP_PORT=58082
        export GATEWAY_PORT=54002
        export ENABLE_MONITORING=no
        export ENABLE_TOR=no
        bash "$SETUP_SCRIPT" --force --non-interactive --no-start --skip-ssl --skip-prereqs 2>&1
    )
    exit_code=$?
    set -e

    if [ "$exit_code" -eq 0 ]; then
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should reject the legacy default ENCRYPTION_SALT"
        echo "$output"
        return 1
    fi

    assert_contains "$output" "legacy default value" \
        "setup.sh should explain legacy default salt rejection"
    assert_contains "$output" "production now rejects" \
        "setup.sh should align with production config validation"
}

make_empty_ownership_docker() {
    local fakebin="$1"
    mkdir -p "$fakebin"
    cat > "$fakebin/docker" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = compose ] && [[ " $* " == *" config --format json "* ]]; then
    echo '{"services":{},"networks":{},"volumes":{}}'
fi
exit 0
EOF
    chmod +x "$fakebin/docker"
}

test_setup_script_generates_unique_salt_for_fresh_install() {
    local env_file="$TEST_TMP_DIR/fresh-random-salt.env"
    local ssl_dir="$TEST_TMP_DIR/fresh-ssl"
    local fakebin="$TEST_TMP_DIR/fresh-random-salt-bin"
    local output=""
    local generated_salt=""

    make_empty_ownership_docker "$fakebin"
    output=$(
        export PATH="$fakebin:$PATH"
        export SANCTUARY_ENV_FILE="$env_file"
        export SANCTUARY_RUNTIME_DIR="$TEST_TMP_DIR/runtime-fresh-salt"
        export SANCTUARY_SSL_DIR="$ssl_dir"
        export HTTPS_PORT=58444
        export HTTP_PORT=58081
        export GATEWAY_PORT=54001
        export ENABLE_MONITORING=no
        export ENABLE_TOR=no
        bash "$SETUP_SCRIPT" --force --non-interactive --no-start --skip-ssl --skip-prereqs 2>&1
    ) || {
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should handle fresh env generation"
        echo "$output"
        return 1
    }

    generated_salt=$(sed -n 's/^ENCRYPTION_SALT=//p' "$env_file")
    if [ -z "$generated_salt" ]; then
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should write ENCRYPTION_SALT for fresh installs"
        echo "  Env file:"
        cat "$env_file"
        return 1
    fi

    if [ "$generated_salt" = "sanctuary-node-config" ]; then
        echo -e "${RED}ASSERTION FAILED:${NC} fresh installs should not use the legacy default salt"
        return 1
    fi

    assert_contains "$output" "ENCRYPTION_SALT: generated" \
        "setup.sh should report generated salt for fresh installs"
}

test_setup_script_persists_llm_egress_policy_env() {
    local env_file="$TEST_TMP_DIR/llm-egress-policy.env"
    local ssl_dir="$TEST_TMP_DIR/llm-egress-policy-ssl"
    local output=""
    local contents=""
    local fakebin="$TEST_TMP_DIR/llm-egress-policy-bin"

    make_empty_ownership_docker "$fakebin"
    output=$(
        export PATH="$fakebin:$PATH"
        export SANCTUARY_ENV_FILE="$env_file"
        export SANCTUARY_RUNTIME_DIR="$TEST_TMP_DIR/runtime-egress-policy"
        export SANCTUARY_SSL_DIR="$ssl_dir"
        export HTTPS_PORT=58446
        export HTTP_PORT=58083
        export GATEWAY_PORT=54003
        export ENABLE_MONITORING=no
        export ENABLE_TOR=no
        export LLM_EGRESS_PROXY_ALLOWED_HOSTS="studio.local"
        export LLM_EGRESS_PROXY_ALLOWED_CIDRS="192.168.1.0/24"
        export LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS=false
        bash "$SETUP_SCRIPT" --force --non-interactive --no-start --skip-ssl --skip-prereqs 2>&1
    ) || {
        echo -e "${RED}ASSERTION FAILED:${NC} setup.sh should persist LLM egress policy env"
        echo "$output"
        return 1
    }

    contents="$(cat "$env_file")"
    assert_contains "$contents" "LLM_EGRESS_PROXY_ALLOWED_HOSTS=studio.local" \
        "setup.sh should preserve explicit LLM egress allowed hosts"
    assert_contains "$contents" "LLM_EGRESS_PROXY_ALLOWED_CIDRS=192.168.1.0/24" \
        "setup.sh should preserve explicit LLM egress allowed CIDRs"
    assert_contains "$contents" "LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS=false" \
        "setup.sh should preserve explicit LLM public HTTPS policy"
}

# ============================================
# Unit Tests: .env.example
# ============================================

ENV_EXAMPLE="$PROJECT_ROOT/config/env/.env.example"
FRESH_INSTALL_TEST="$PROJECT_ROOT/tests/install/e2e/fresh-install.test.sh"

test_env_example_exists() {
    assert_file_exists "$ENV_EXAMPLE" "config/env/.env.example should exist"
}

test_env_example_has_all_required_secrets() {
    local missing=""
    grep -q "JWT_SECRET" "$ENV_EXAMPLE" || missing="$missing JWT_SECRET"
    grep -q "ENCRYPTION_KEY" "$ENV_EXAMPLE" || missing="$missing ENCRYPTION_KEY"
    grep -q "GATEWAY_SECRET" "$ENV_EXAMPLE" || missing="$missing GATEWAY_SECRET"
    grep -q "WORKER_DIAGNOSTICS_SECRET" "$ENV_EXAMPLE" \
        || missing="$missing WORKER_DIAGNOSTICS_SECRET"
    grep -q "POSTGRES_PASSWORD" "$ENV_EXAMPLE" || missing="$missing POSTGRES_PASSWORD"

    if [ -z "$missing" ]; then
        return 0
    else
        echo -e "${RED}ASSERTION FAILED:${NC} .env.example missing:$missing"
        return 1
    fi
}

test_fresh_install_supplies_worker_diagnostics_secret() {
    local generation_count compose_count
    generation_count=$(grep -Fc 'local worker_diagnostics_secret=$(openssl rand -hex 32)' \
        "$FRESH_INSTALL_TEST")
    compose_count=$(grep -Fc 'WORKER_DIAGNOSTICS_SECRET="$worker_diagnostics_secret"' \
        "$FRESH_INSTALL_TEST")

    assert_equals "2" "$generation_count" \
        "fresh-install build and up should each generate a worker diagnostics secret"
    assert_equals "2" "$compose_count" \
        "fresh-install build and up should each supply the worker diagnostics secret"
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
    run_test "fresh install supplies WORKER_DIAGNOSTICS_SECRET" test_fresh_install_supplies_worker_diagnostics_secret
    run_test "install script loads runtime env for upgrades" test_install_script_loads_runtime_env_for_upgrades
    run_test "install script detects skip-checkout upgrade mode" test_install_script_detects_skip_checkout_upgrade_mode
    run_test "install script has silent openssl check" test_install_script_has_silent_openssl_check
    run_test "install script uses has_openssl for capture" test_install_script_uses_has_openssl_for_capture
    run_test "install script no hardcoded container names" test_install_script_no_hardcoded_container_names
    echo ""

    echo -e "${YELLOW}Test Suite: Installer GitHub Distribution Behavior${NC}"
    run_test "streamed installer safely locks a legacy upgrade" test_streamed_installer_locks_legacy_upgrade_without_sourcing_checkout_helpers
    run_test "streamed installer preserves legacy upgrade on lock conflict" test_streamed_installer_preserves_legacy_upgrade_on_lock_conflict
    run_test "existing installation rewrites stale origin to GitHub" test_existing_installation_rewrites_stale_origin_to_github
    run_test "online Codeberg source is rejected" test_online_codeberg_source_is_rejected
    run_test "explicit GitHub source remains compatible" test_explicit_github_source_remains_compatible
    run_test "GitHub fetch failure is clear and has no fallback" test_github_fetch_failure_is_clear_and_does_not_fall_back
    run_test "GitHub tag clobber force-refreshes tags" test_github_tag_clobber_retries_forced_tags
    run_test "release API failure uses GitHub tags" test_release_api_failure_uses_github_tags
    run_test "clean install clones GitHub" test_clean_install_clones_github
    run_test "failed GitHub clone is clear and atomic" test_clean_install_github_failure_is_clear_and_atomic
    run_test "offline prepared mode ignores legacy source option" test_offline_prepared_ignores_legacy_source_option
    run_test "installer online distribution is GitHub-only" test_install_script_uses_only_github_online_distribution
    echo ""

    echo -e "${YELLOW}Test Suite: start.sh File Structure${NC}"
    run_test "start script exists" test_start_script_exists
    run_test "start script is executable" test_start_script_is_executable
    run_test "start script checks JWT_SECRET" test_start_script_checks_jwt_secret
    run_test "start script checks ENCRYPTION_KEY" test_start_script_checks_encryption_key
    run_test "start script checks GATEWAY_SECRET" test_start_script_checks_gateway_secret
    run_test "start script checks POSTGRES_PASSWORD" test_start_script_checks_postgres_password
    run_test "start script exports secrets" test_start_script_exports_secrets
    run_test "start script reconciles Postgres password" test_start_script_reconciles_postgres_password
    run_test "start script sources .env file" test_start_script_sources_env_file
    run_test "start script has .env.local fallback" test_start_script_has_env_local_fallback
    run_test "start script .env has set -a" test_start_script_env_has_set_a
    run_test "start script .env.local has set -a" test_start_script_env_local_has_set_a
    run_test "start script help is mutation-free" test_start_script_help_is_mutation_free
    run_test "backend compose exposes auth rate-limit overrides" test_backend_compose_exposes_auth_rate_limit_overrides
    run_test "llm egress proxy maps host gateway for host providers" test_llm_egress_proxy_maps_host_gateway_for_host_providers
    run_test "worker compose command matches backend dist layout" test_worker_compose_command_matches_backend_dist_layout
    run_test "MCP compose command matches backend dist layout" test_mcp_compose_command_matches_backend_dist_layout
    echo ""

    echo -e "${YELLOW}Test Suite: Pre-flight Checks${NC}"
    run_test "install script has disk space check" test_install_script_has_disk_space_check
    run_test "install script has memory check" test_install_script_has_memory_check
    run_test "install script has WSL check" test_install_script_has_wsl_check
    run_test "install script has architecture check" test_install_script_has_architecture_check
    run_test "install script has port conflict check" test_install_script_has_port_conflict_check
    run_test "install script checks multiple ports" test_install_script_checks_multiple_ports
    run_test "install script has upgrade backup guidance" test_install_script_has_upgrade_backup_guidance
    run_test "install script supports offline bundle" test_install_script_supports_offline_bundle
    run_test "setup script supports offline mode" test_setup_script_supports_offline_mode
    run_test "setup offline mode overrides existing online metadata" test_setup_offline_mode_overrides_existing_online_metadata
    run_test "start script refuses offline rebuild" test_start_script_refuses_offline_rebuild
    run_test "install script has health check timeout" test_install_script_has_health_check_timeout
    run_test "install script passes --upgrade flag" test_install_script_passes_upgrade_flag
    echo ""

    echo -e "${YELLOW}Test Suite: Upgrade Clean Rebuild${NC}"
    run_test "setup script has --upgrade flag" test_setup_script_has_upgrade_flag
    run_test "setup script uses --no-cache on upgrade" test_setup_script_uses_no_cache_on_upgrade
    run_test "setup script recovers corrupt BuildKit cache" test_setup_script_recovers_corrupt_buildkit_cache
    run_test "setup script avoids rebuild during compose up" test_setup_script_does_not_rebuild_during_compose_up_after_build
    run_test "setup script retries corrupt BuildKit cache with fake Docker" test_setup_script_retries_corrupt_buildkit_cache_with_fake_docker
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
    run_test "setup script skips Postgres reconcile with --no-start" test_setup_script_skips_postgres_reconcile_when_no_start
    run_test "setup script reconciles Postgres after starting database" test_setup_script_reconciles_postgres_after_starting_database
    run_test "setup script rejects missing salt for existing key" test_setup_script_rejects_missing_salt_for_existing_key
    run_test "setup script rejects legacy default salt" test_setup_script_rejects_legacy_default_salt
    run_test "setup script generates unique salt for fresh install" test_setup_script_generates_unique_salt_for_fresh_install
    run_test "setup script persists LLM egress policy env" test_setup_script_persists_llm_egress_policy_env
    run_test "setup script requires routed API readiness" test_setup_script_requires_routed_api_readiness
    run_test "nginx entrypoint selects runtime DNS resolver" test_nginx_entrypoint_selects_runtime_dns_resolver
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
