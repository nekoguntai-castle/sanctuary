#!/bin/bash
# Post-upgrade assertions that exercise user-visible traffic paths.

assert_worker_health_direct() {
    local output
    output=$(compose_exec worker wget -q -O - http://localhost:3002/health 2>/dev/null || true)

    if ! echo "$output" | grep -q '"status":"healthy"'; then
        log_error "Worker health endpoint did not report healthy"
        log_error "Response: $output"
        return 1
    fi
}

assert_browser_auth_smoke() {
    local base_url="$1"

    log_info "Running browser-visible auth smoke through $base_url..."

    API_BASE_URL="$base_url" login_as_upgrade_user true || {
        log_error "Browser-visible login plus 2FA failed"
        return 1
    }

    if [ -z "$CSRF_TOKEN" ]; then
        log_error "Browser-visible login did not provide sanctuary_csrf cookie"
        return 1
    fi

    local me_response
    me_response=$(curl -k -s -b "$COOKIE_JAR" "$base_url/api/v1/auth/me")
    if ! echo "$me_response" | grep -q '"username":"admin"'; then
        log_error "Browser-visible /auth/me failed"
        log_error "Response: $me_response"
        return 1
    fi

    local refresh_response
    refresh_response=$(curl -k -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -H "X-CSRF-Token: $CSRF_TOKEN" \
        -d '{}' \
        "$base_url/api/v1/auth/refresh")
    if ! echo "$refresh_response" | grep -q '"expiresIn"'; then
        log_error "Browser-visible /auth/refresh failed"
        log_error "Response: $refresh_response"
        return 1
    fi

    extract_csrf_token
    if [ -z "$CSRF_TOKEN" ]; then
        log_error "Refresh did not rotate sanctuary_csrf cookie"
        return 1
    fi
}

assert_support_package_generation() {
    local base_url="$1"
    local support_response

    support_response=$(curl -k -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST \
        -H "Content-Type: application/json" \
        -H "X-CSRF-Token: $CSRF_TOKEN" \
        -d '{}' \
        "$base_url/api/v1/admin/support-package")

    if ! echo "$support_response" | grep -q '"version":"1.0.0"'; then
        log_error "Support package generation failed"
        log_error "Response: ${support_response:0:400}"
        return 1
    fi

    if ! echo "$support_response" | grep -q '"succeeded"'; then
        log_error "Support package response did not include collector metadata"
        return 1
    fi
}

assert_post_upgrade_user_smoke() {
    local browser_base_url="$1"

    assert_worker_health_direct || return 1
    assert_browser_auth_smoke "$browser_base_url" || return 1
    assert_support_package_generation "$browser_base_url" || return 1

    log_success "Post-upgrade user-visible smoke assertions passed"
}
