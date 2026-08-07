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
        -d '{"confirmShareableAggregate":true}' \
        "$base_url/api/v1/admin/support-package")

    if ! echo "$support_response" | grep -q '"version":"2.0.0"' ||
        ! echo "$support_response" | grep -q '"profile":"shareable_aggregate"'; then
        log_error "Support package generation failed"
        log_error "Response: ${support_response:0:400}"
        return 1
    fi

    if ! echo "$support_response" | grep -q '"succeeded"'; then
        log_error "Support package response did not include collector metadata"
        return 1
    fi
}

# Prove the upgrade actually crossed the restart-staleness path, and that the
# worker survived it.
#
# assert_worker_health_direct alone is not enough: it passes whether or not the
# lane ever presented the worker with a stale pre-restart completion, which is
# exactly the gap in #658 -- a gate that only fires when the rebuild happens to
# take the right amount of time reports green either way.
#
# So this checks BOTH halves:
#   1. the worker is healthy (the #657 fix works)
#   2. the completion it booted with was genuinely older than maxAgeMs (the
#      branch was entered at all)
#
# Failing (2) means the lane did not test what it claims to. That is a failure,
# not a pass -- silent non-coverage is the defect this assertion exists to stop.
#
# (2) is established from the timestamp we planted versus worker.startedAt, NOT
# by re-reading the completion. Ageing the record makes the schedule due, so the
# worker re-runs it seconds after boot and overwrites the evidence -- run 9136
# refreshed both schedules within 26s and 37s. Comparing against boot time is
# immune to that, because both operands are fixed once the worker starts.
assert_recurring_staleness_path_exercised() {
    local metrics
    metrics=$(compose_exec worker wget -q -O - http://localhost:3002/metrics 2>/dev/null || true)

    if [ -z "$metrics" ]; then
        log_error "Worker /metrics returned nothing; cannot confirm the staleness path was exercised"
        return 1
    fi

    local state='' state_file
    state_file="$(staleness_state_file)"
    if [ -f "$state_file" ]; then
        state="$(cat "$state_file")"
    fi

    # node is the established JSON idiom here; the worker image (node:24-alpine
    # plus dumb-init/openssl) has no jq, python or curl.
    local verdict
    verdict="$(evaluate_staleness_verdict "$state" "$metrics")"

    case "$verdict" in
        OK*)
            log_success "Restart-staleness path exercised and survived: ${verdict#OK }"
            return 0
            ;;
        FAIL*)
            log_error "Restart-staleness assertion failed: ${verdict#FAIL }"
            log_error "The upgrade lane did not demonstrate the #657 path. Either the completion"
            log_error "was not aged before the stop, or the worker rejected the aged record."
            log_error "State file: $state_file"
            return 1
            ;;
        *)
            log_error "Unrecognised staleness verdict: $verdict"
            return 1
            ;;
    esac
}

assert_post_upgrade_user_smoke() {
    local browser_base_url="$1"

    assert_worker_health_direct || return 1
    assert_recurring_staleness_path_exercised || return 1
    assert_browser_auth_smoke "$browser_base_url" || return 1
    assert_support_package_generation "$browser_base_url" || return 1

    log_success "Post-upgrade user-visible smoke assertions passed"
}
