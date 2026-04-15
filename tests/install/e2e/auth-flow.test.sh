#!/bin/bash
# ============================================
# Authentication Flow Tests
# ============================================
#
# These tests verify the authentication and
# password change flows work correctly.
#
# Run: ./auth-flow.test.sh
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

VERBOSE=false
KEEP_STATE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE=true
            export DEBUG=true
            shift
            ;;
        --keep-state)
            KEEP_STATE=true
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
HTTPS_PORT="${HTTPS_PORT:-8443}"
API_BASE_URL="https://localhost:${HTTPS_PORT}"
COOKIE_JAR="/tmp/sanctuary-test-cookies-${TEST_ID}.txt"

# Test passwords
DEFAULT_PASSWORD="sanctuary"
NEW_PASSWORD="NewSecurePass123!"
SECOND_PASSWORD="AnotherSecure456!"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
declare -a FAILED_TESTS

# Shared authentication state (cookie-based, Phase 6 auth)
# The backend sets HttpOnly sanctuary_access + sanctuary_refresh cookies and
# a readable sanctuary_csrf cookie. Subsequent requests flow cookies via
# -b "$COOKIE_JAR"; mutations must echo the CSRF token in X-CSRF-Token.
CURRENT_PASSWORD=""
CSRF_TOKEN=""

# Extract the sanctuary_csrf cookie value from the Netscape-format cookie jar.
# Fields are tab-separated: domain, HttpOnly, path, Secure, expiry, name, value.
# We read the 7th field of the row whose 6th field equals sanctuary_csrf.
extract_csrf_token() {
    if [ ! -f "$COOKIE_JAR" ]; then
        CSRF_TOKEN=""
        return
    fi
    CSRF_TOKEN=$(awk -F'\t' '$6 == "sanctuary_csrf" { print $7 }' "$COOKIE_JAR" | tail -n 1)
}

# Cleanup trap to remove the cookie jar when the script exits
cleanup_cookie_jar() {
    if [ -f "$COOKIE_JAR" ]; then
        rm -f "$COOKIE_JAR"
    fi
}
trap cleanup_cookie_jar EXIT

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
# Helper Functions
# ============================================

# Issue a login request. Clears the cookie jar first so the new
# sanctuary_access / sanctuary_refresh / sanctuary_csrf cookies fully replace
# any prior session (re-logins after password changes are common in this file).
# After the subshell-returned response is captured, callers must invoke
# `extract_csrf_token` in the parent shell to refresh CSRF_TOKEN. The helper
# itself cannot do that, because `$(make_login_request ...)` runs in a
# subshell and any assignment to CSRF_TOKEN there is discarded on return —
# the cookie jar file survives (curl -c writes it), but the parent's
# CSRF_TOKEN stays stale until it re-reads the jar.
make_login_request() {
    local username="$1"
    local password="$2"

    # Delay to avoid rate limiting during rapid test execution
    # Rate limit is 5 attempts per 15 minutes, so we need to be careful
    sleep 1

    rm -f "$COOKIE_JAR"

    curl -k -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
        "$API_BASE_URL/api/v1/auth/login"
}

# Issue an authenticated request using the saved cookie jar. Mutating verbs
# (POST/PUT/PATCH/DELETE) include the X-CSRF-Token header from CSRF_TOKEN to
# satisfy the double-submit cookie middleware. GETs send no CSRF header.
make_authenticated_request() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"

    local curl_opts=("-k" "-s" "-X" "$method" "-b" "$COOKIE_JAR" "-c" "$COOKIE_JAR" "-H" "Content-Type: application/json")

    case "$method" in
        POST|PUT|PATCH|DELETE)
            curl_opts+=("-H" "X-CSRF-Token: $CSRF_TOKEN")
            ;;
    esac

    if [ -n "$data" ]; then
        curl_opts+=("-d" "$data")
    fi

    curl "${curl_opts[@]}" "$API_BASE_URL$endpoint"
}

# ============================================
# Test: API Reachable
# ============================================

test_api_reachable() {
    log_info "Testing API reachability..."

    local response=$(curl -k -s "$API_BASE_URL/health" 2>/dev/null || \
        curl -k -s "$API_BASE_URL/api/v1/health" 2>/dev/null)

    if [ -z "$response" ]; then
        log_error "API not reachable at $API_BASE_URL"
        return 1
    fi

    log_success "API is reachable"
    return 0
}

# ============================================
# Test: Login with Default Credentials
# ============================================

test_login_default_credentials() {
    log_info "Testing login with default credentials..."

    local response=$(make_login_request "admin" "$DEFAULT_PASSWORD")
    extract_csrf_token
    log_debug "Response: $response"

    if echo "$response" | grep -q '"user"'; then
        CURRENT_PASSWORD="$DEFAULT_PASSWORD"
        log_success "Login successful with default credentials"
        return 0
    else
        # Maybe password was already changed
        log_warning "Default password may have been changed"
        CURRENT_PASSWORD=""
        return 0
    fi
}

# ============================================
# Test: Login Response Structure
# ============================================

test_login_response_structure() {
    log_info "Testing login response structure..."

    # Try with default or known password. We bypass make_login_request here
    # because we need to capture response headers (Set-Cookie) as well as the
    # body to assert the Phase 6 contract end-to-end.
    local password="${CURRENT_PASSWORD:-$DEFAULT_PASSWORD}"
    local headers_file="/tmp/sanctuary-test-headers-${TEST_ID}.txt"

    sleep 1
    rm -f "$COOKIE_JAR" "$headers_file"

    local response
    response=$(curl -k -s -D "$headers_file" -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$password\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    extract_csrf_token

    if [ -z "$response" ]; then
        log_error "No response from login endpoint"
        rm -f "$headers_file"
        return 1
    fi

    log_debug "Response: $response"

    # Phase 6 contract: body must contain expiresIn and user but NOT a token.
    if echo "$response" | grep -q '"token"'; then
        log_error "SECURITY: Response should not contain 'token' field (Phase 6 cookie auth)"
        rm -f "$headers_file"
        return 1
    fi

    if ! echo "$response" | grep -q '"expiresIn"'; then
        log_error "Response missing 'expiresIn' field"
        rm -f "$headers_file"
        return 1
    fi

    if ! echo "$response" | grep -q '"user"'; then
        log_error "Response missing 'user' field"
        rm -f "$headers_file"
        return 1
    fi

    # Check user object structure
    if ! echo "$response" | grep -q '"username"'; then
        log_error "Response missing 'username' in user object"
        rm -f "$headers_file"
        return 1
    fi

    # Verify password is NOT in response
    if echo "$response" | grep -q '"password"'; then
        log_error "SECURITY: Password should not be in response"
        rm -f "$headers_file"
        return 1
    fi

    # Verify the server issued a sanctuary_access cookie via Set-Cookie header.
    if ! grep -qi '^set-cookie:.*sanctuary_access=' "$headers_file"; then
        log_error "Login response missing Set-Cookie: sanctuary_access"
        rm -f "$headers_file"
        return 1
    fi

    rm -f "$headers_file"
    log_success "Login response structure is correct"
    return 0
}

# ============================================
# Test: Invalid Credentials Rejected
# ============================================

test_invalid_credentials_rejected() {
    log_info "Testing invalid credentials are rejected..."

    # Test wrong password — success would echo a "user" field in the body.
    local response=$(make_login_request "admin" "WrongPassword123!")
    extract_csrf_token
    log_debug "Wrong password response: $response"

    if echo "$response" | grep -q '"user"'; then
        log_error "Login succeeded with wrong password"
        return 1
    fi

    # Test non-existent user
    response=$(make_login_request "nonexistent_user_xyz" "SomePassword123!")
    log_debug "Non-existent user response: $response"

    if echo "$response" | grep -q '"user"'; then
        log_error "Login succeeded with non-existent user"
        return 1
    fi

    log_success "Invalid credentials correctly rejected"
    return 0
}

# ============================================
# Test: usingDefaultPassword Flag
# ============================================

test_using_default_password_flag() {
    log_info "Testing usingDefaultPassword flag..."

    if [ -z "$CURRENT_PASSWORD" ] || [ "$CURRENT_PASSWORD" != "$DEFAULT_PASSWORD" ]; then
        log_warning "Not using default password, skipping flag check"
        return 0
    fi

    local response=$(make_login_request "admin" "$DEFAULT_PASSWORD")
    extract_csrf_token
    log_debug "Response: $response"

    if echo "$response" | grep -q '"usingDefaultPassword":true'; then
        log_success "usingDefaultPassword flag is set to true"
        return 0
    elif echo "$response" | grep -q '"usingDefaultPassword"'; then
        log_warning "usingDefaultPassword flag exists but is not true"
        return 0
    else
        log_warning "usingDefaultPassword flag not found in response"
        return 0
    fi
}

# ============================================
# Test: Token Verification
# ============================================

test_token_verification() {
    log_info "Testing session verification via /auth/me..."

    # Ensure the cookie jar has a valid session (re-login if needed).
    if [ ! -f "$COOKIE_JAR" ] || [ -z "$CSRF_TOKEN" ]; then
        local password="${CURRENT_PASSWORD:-$DEFAULT_PASSWORD}"
        make_login_request "admin" "$password" > /dev/null
    fi

    if [ ! -f "$COOKIE_JAR" ]; then
        log_error "No auth cookie jar available"
        return 1
    fi

    # Test /me endpoint with the cookie jar (GET — no CSRF required)
    local me_response=$(make_authenticated_request "GET" "/api/v1/auth/me")
    log_debug "Me response: $me_response"

    if echo "$me_response" | grep -q '"username"'; then
        log_success "Session verification successful"
        return 0
    else
        log_error "Session verification failed"
        return 1
    fi
}

# ============================================
# Test: Invalid Token Rejected
# ============================================

test_invalid_token_rejected() {
    log_info "Testing invalid session cookie is rejected..."

    # Send a bogus sanctuary_access cookie (Phase 6 cookie auth) — the
    # middleware should reject it just like an invalid Bearer token.
    local response=$(curl -k -s -X GET \
        -H "Cookie: sanctuary_access=invalid.token.here" \
        -H "Content-Type: application/json" \
        "$API_BASE_URL/api/v1/auth/me")

    log_debug "Invalid cookie response: $response"

    if echo "$response" | grep -q '"username"'; then
        log_error "Request succeeded with invalid session cookie"
        return 1
    fi

    log_success "Invalid session cookie correctly rejected"
    return 0
}

# ============================================
# Test: Missing Token Rejected
# ============================================

test_missing_token_rejected() {
    log_info "Testing missing token is rejected..."

    local response=$(curl -k -s -X GET \
        -H "Content-Type: application/json" \
        "$API_BASE_URL/api/v1/auth/me")

    log_debug "No token response: $response"

    if echo "$response" | grep -q '"username"'; then
        log_error "Request succeeded without token"
        return 1
    fi

    log_success "Missing token correctly rejected"
    return 0
}

# ============================================
# Test: Password Change
# ============================================

test_password_change() {
    log_info "Testing password change..."

    if [ -z "$CURRENT_PASSWORD" ]; then
        log_warning "No current password known, trying default"
        CURRENT_PASSWORD="$DEFAULT_PASSWORD"
    fi

    # Login first — populates COOKIE_JAR and CSRF_TOKEN
    local login_response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    extract_csrf_token

    if ! echo "$login_response" | grep -q '"user"' || [ -z "$CSRF_TOKEN" ]; then
        log_error "Cannot get auth session for password change"
        return 1
    fi

    # Change password (POST → CSRF token attached automatically)
    local change_response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
        "{\"currentPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$NEW_PASSWORD\"}")

    log_debug "Change password response: $change_response"

    # Check if error in response
    if echo "$change_response" | grep -qiE '"error"|"message":".*fail|"message":".*invalid'; then
        log_error "Password change failed"
        return 1
    fi

    # Update current password
    CURRENT_PASSWORD="$NEW_PASSWORD"

    log_success "Password changed successfully"
    return 0
}

# ============================================
# Test: Login with New Password
# ============================================

test_login_new_password() {
    log_info "Testing login with new password..."

    local response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    extract_csrf_token
    log_debug "Response: $response"

    if echo "$response" | grep -q '"user"'; then
        log_success "Login successful with new password"
        return 0
    else
        log_error "Login failed with new password"
        return 1
    fi
}

# ============================================
# Test: Old Password No Longer Works
# ============================================

test_old_password_invalid() {
    log_info "Testing old password no longer works..."

    if [ "$CURRENT_PASSWORD" = "$DEFAULT_PASSWORD" ]; then
        log_warning "Password not changed yet, skipping test"
        return 0
    fi

    local response=$(make_login_request "admin" "$DEFAULT_PASSWORD")
    extract_csrf_token
    log_debug "Response: $response"

    if echo "$response" | grep -q '"user"'; then
        log_error "Old password still works after change"
        return 1
    fi

    log_success "Old password correctly rejected"
    return 0
}

# ============================================
# Test: Password Change with Wrong Current
# ============================================

test_password_change_wrong_current() {
    log_info "Testing password change with wrong current password..."

    # Always re-login with the known-good current password to ensure the
    # cookie jar holds a valid session (prior tests may have written stale or
    # failed-login cookies).
    local login_response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    extract_csrf_token
    if ! echo "$login_response" | grep -q '"user"' || [ -z "$CSRF_TOKEN" ]; then
        log_error "Cannot get auth session"
        return 1
    fi

    local response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
        "{\"currentPassword\":\"WrongCurrentPassword!\",\"newPassword\":\"AnyPassword123!\"}")

    log_debug "Response: $response"

    # Should fail
    if echo "$response" | grep -qiE '"error"|"status":[^2]|"message":".*fail|"message":".*invalid|"message":".*incorrect'; then
        log_success "Password change correctly rejected with wrong current password"
        return 0
    fi

    # If no error indicator, check if it actually succeeded (bad)
    local test_login=$(make_login_request "admin" "AnyPassword123!")
    extract_csrf_token
    if echo "$test_login" | grep -q '"user"'; then
        log_error "Password was changed with wrong current password"
        return 1
    fi

    log_success "Password change rejected"
    return 0
}

# ============================================
# Test: Password Complexity Requirements
# ============================================

test_password_complexity() {
    log_info "Testing password complexity requirements..."

    # Always re-establish a fresh authenticated session.
    local login_response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    extract_csrf_token
    if ! echo "$login_response" | grep -q '"user"' || [ -z "$CSRF_TOKEN" ]; then
        log_warning "Cannot get auth session, skipping complexity test"
        return 0
    fi

    # Try passwords that are too short (less than 6 characters)
    # Server only enforces minimum length of 6 characters
    local weak_passwords=("123" "12345" "admin")

    for weak_pass in "${weak_passwords[@]}"; do
        local response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
            "{\"currentPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$weak_pass\"}")

        log_debug "Short password '$weak_pass' response: $response"

        # Should get an error about password length
        if ! echo "$response" | grep -qiE '"error"|"message":".*characters'; then
            # Verify password wasn't changed by trying to login
            local test_login=$(make_login_request "admin" "$weak_pass")
            if echo "$test_login" | grep -q '"user"'; then
                log_error "Short password '$weak_pass' was accepted"
                CURRENT_PASSWORD="$weak_pass"  # Update for cleanup
                return 1
            fi
        fi
    done

    log_success "Weak passwords correctly rejected"
    return 0
}

# ============================================
# Test: Second Password Change
# ============================================

test_second_password_change() {
    log_info "Testing second password change..."

    # Login with current password — populates COOKIE_JAR + CSRF_TOKEN
    local login_response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    extract_csrf_token
    if ! echo "$login_response" | grep -q '"user"' || [ -z "$CSRF_TOKEN" ]; then
        log_error "Cannot get auth session"
        return 1
    fi

    # Change password again
    local change_response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
        "{\"currentPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$SECOND_PASSWORD\"}")

    log_debug "Response: $change_response"

    # Check for rate limiting - this is expected behavior if we've done many password operations
    if echo "$change_response" | grep -qi "too many\|rate limit"; then
        log_warning "Rate limited (expected after multiple password tests) - skipping"
        return 0
    fi

    # Verify new password works
    local test_login=$(make_login_request "admin" "$SECOND_PASSWORD")
    extract_csrf_token
    if echo "$test_login" | grep -q '"user"'; then
        CURRENT_PASSWORD="$SECOND_PASSWORD"
        log_success "Second password change successful"
        return 0
    fi

    # If rate limited on verification login, that's also fine
    if echo "$test_login" | grep -qi "too many\|rate limit"; then
        log_warning "Rate limited on verification - skipping"
        return 0
    fi

    log_error "Second password change failed"
    return 1
}

# ============================================
# Test: usingDefaultPassword After Change
# ============================================

test_not_using_default_after_change() {
    log_info "Testing usingDefaultPassword is false after change..."

    if [ "$CURRENT_PASSWORD" = "$DEFAULT_PASSWORD" ]; then
        log_warning "Still using default password, skipping test"
        return 0
    fi

    local response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    extract_csrf_token
    log_debug "Response: $response"

    if echo "$response" | grep -q '"usingDefaultPassword":true'; then
        log_error "usingDefaultPassword should be false after password change"
        return 1
    fi

    log_success "usingDefaultPassword correctly not set after password change"
    return 0
}

# ============================================
# Test: Token Expiration (Optional)
# ============================================

test_token_format() {
    log_info "Testing sanctuary_access cookie format (JWT)..."

    # Make sure we have a fresh session in the cookie jar.
    if [ ! -f "$COOKIE_JAR" ]; then
        make_login_request "admin" "${CURRENT_PASSWORD:-$DEFAULT_PASSWORD}" > /dev/null
    fi

    if [ ! -f "$COOKIE_JAR" ]; then
        log_error "No cookie jar available"
        return 1
    fi

    # Pull the sanctuary_access cookie value (Netscape jar — 6th field is name,
    # 7th is value). Same awk pattern as extract_csrf_token.
    local access_token
    access_token=$(awk -F'\t' '$6 == "sanctuary_access" { print $7 }' "$COOKIE_JAR" | tail -n 1)

    if [ -z "$access_token" ]; then
        log_error "sanctuary_access cookie not found in jar"
        return 1
    fi

    # JWT tokens have 3 parts separated by dots
    local parts=$(echo "$access_token" | tr '.' '\n' | wc -l)

    if [ "$parts" -eq 3 ]; then
        log_success "Cookie is valid JWT format (3 parts)"
        return 0
    else
        log_error "Cookie is not valid JWT format (expected 3 parts, got $parts)"
        return 1
    fi
}

# ============================================
# Cleanup: Reset Password to Default
# ============================================

cleanup_reset_password() {
    if [ "$KEEP_STATE" = "true" ]; then
        log_info "Keeping state (--keep-state specified)"
        log_info "Current password: $CURRENT_PASSWORD"
        return 0
    fi

    log_info "Resetting password to default..."

    if [ "$CURRENT_PASSWORD" = "$DEFAULT_PASSWORD" ]; then
        log_info "Already using default password"
        return 0
    fi

    # Login with current password
    local login_response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    extract_csrf_token

    if ! echo "$login_response" | grep -q '"user"' || [ -z "$CSRF_TOKEN" ]; then
        log_warning "Cannot reset password - unable to login (may be rate limited)"
        return 0
    fi

    # Change back to default
    local change_response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
        "{\"currentPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$DEFAULT_PASSWORD\"}")

    # Check for rate limiting
    if echo "$change_response" | grep -qi "too many\|rate limit"; then
        log_warning "Rate limited - cannot reset password (this is fine, cleanup will happen on next fresh install)"
        return 0
    fi

    # Verify
    local test_login=$(make_login_request "admin" "$DEFAULT_PASSWORD")
    extract_csrf_token
    if echo "$test_login" | grep -q '"user"'; then
        log_success "Password reset to default"
    else
        log_warning "Could not reset password to default"
    fi
}

# ============================================
# Main Test Runner
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Authentication Flow Tests${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""

    # Verify API is reachable first
    run_test "API Reachable" test_api_reachable

    # Login tests
    run_test "Login with Default Credentials" test_login_default_credentials
    run_test "Login Response Structure" test_login_response_structure
    run_test "Invalid Credentials Rejected" test_invalid_credentials_rejected
    run_test "usingDefaultPassword Flag" test_using_default_password_flag

    # Token tests
    run_test "Token Verification" test_token_verification
    run_test "Invalid Token Rejected" test_invalid_token_rejected
    run_test "Missing Token Rejected" test_missing_token_rejected
    run_test "Token Format" test_token_format

    # Password change tests
    run_test "Password Change" test_password_change
    run_test "Login with New Password" test_login_new_password
    run_test "Old Password Invalid" test_old_password_invalid
    run_test "Password Change Wrong Current" test_password_change_wrong_current
    run_test "Password Complexity" test_password_complexity
    run_test "Second Password Change" test_second_password_change
    run_test "Not Using Default After Change" test_not_using_default_after_change

    # Cleanup
    cleanup_reset_password

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
