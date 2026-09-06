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

assert_authenticated_websocket_handshake() {
    local base_url="$1"
    local websocket_key
    local ws_headers

    websocket_key="$(openssl rand -base64 16 2>/dev/null || printf 'sanctuary-upgrade-websocket' | base64)"
    ws_headers="$(curl -k -sS --max-time 10 --http1.1 -D - -o /dev/null \
        -H "Connection: Upgrade" \
        -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" \
        -H "Sec-WebSocket-Key: $websocket_key" \
        -H "Origin: $base_url" \
        -b "$COOKIE_JAR" \
        "$base_url/ws" 2>/dev/null || true)"

    if ! echo "$ws_headers" | grep -q '101 Switching Protocols'; then
        log_error "Authenticated WebSocket handshake failed"
        log_error "Headers: $ws_headers"
        return 1
    fi
}

assert_authenticated_me_response() {
    local base_url="$1"
    local response

    response="$(curl -k -f -sS --max-time 10 -b "$COOKIE_JAR" \
        "$base_url/api/v1/auth/me?proxy_recovery=1" 2>/dev/null || true)"
    if ! echo "$response" | grep -q '"username":"admin"'; then
        log_error "Authenticated browser route did not return the expected user"
        log_error "Response: $response"
        return 1
    fi
}

resolve_frontend_backend_network() {
    local frontend_container="$1"
    local backend_container="$2"
    local frontend_networks backend_networks shared_networks

    frontend_networks="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' \
        "$frontend_container" 2>/dev/null)" || return 1
    backend_networks="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' \
        "$backend_container" 2>/dev/null)" || return 1
    shared_networks="$(
        while IFS= read -r network; do
            if [ -n "$network" ] && printf '%s\n' "$backend_networks" | grep -Fxq -- "$network"; then
                printf '%s\n' "$network"
            fi
        done <<< "$frontend_networks"
    )"

    if [ "$(printf '%s\n' "$shared_networks" | grep -c .)" -ne 1 ]; then
        log_error "Expected exactly one shared frontend/backend network"
        return 1
    fi

    printf '%s\n' "$shared_networks"
}

register_coordinated_container() {
    local container_name="$1" expected_id="$2" facts lifecycle policy
    facts="$(docker container inspect "$expected_id")" || return 1
    lifecycle="$(printf '%s' "$facts" | jq -er --arg id "$expected_id" --arg name "/$container_name" \
        --arg project "$SANCTUARY_PROJECT" --arg deployment "$SANCTUARY_DEPLOYMENT_ID" \
        --arg owner "$SANCTUARY_OWNER_ID" --arg created "$SANCTUARY_CLEANUP_CREATED_AT" \
        --arg release "$SANCTUARY_RELEASE" --arg commit "$SANCTUARY_COMMIT" \
        --arg run "$SANCTUARY_OPERATION_RUN_ID" '
        if length == 1 and .[0].Id == $id and .[0].Name == $name and
           .[0].State.Status == "running" and .[0].State.Running == true and
           .[0].Config.Labels["io.sanctuary.project"] == $project and
           .[0].Config.Labels["io.sanctuary.deployment-id"] == $deployment and
           .[0].Config.Labels["io.sanctuary.owner-id"] == $owner and
           .[0].Config.Labels["io.sanctuary.resource-class"] == "compose_container" and
           .[0].Config.Labels["io.sanctuary.created-at"] == $created and
           .[0].Config.Labels["io.sanctuary.created-by-release"] == $release and
           .[0].Config.Labels["io.sanctuary.created-by-commit"] == $commit and
           .[0].Config.Labels["io.sanctuary.creation-run-id"] == $run and
           .[0].Config.Labels["io.sanctuary.cleanup-policy"] == "exact_delete"
        then .[0].Config.Labels["io.sanctuary.lifecycle"] else error("tuple mismatch") end' \
        2>/dev/null)" || return 1
    [[ "$lifecycle" =~ ^[a-z][a-z0-9_-]*$ ]] || return 1
    policy="exact_delete"
    register_owned_resource compose_container "$lifecycle" "$policy" engine_id \
        "$expected_id" "$expected_id" "$SANCTUARY_OPERATION_RUN_ID"
}

remove_coordinated_container() {
    local container_id="$1" remove_status=0
    docker rm -f "$container_id" >/dev/null || remove_status=$?
    install_container_is_absent "$container_id" && return 0
    [ "$remove_status" -eq 0 ] && return 1
    return "$remove_status"
}

assert_frontend_proxy_recovers_after_backend_recreate_inner() {
    local browser_base_url="$1"
    local holder_container="$2"
    local frontend_container backend_container frontend_id backend_id backend_image network old_ip
    local new_backend_container new_backend_id new_ip attempt
    local holder_output holder_create_status=0 holder_resolve_status=0 holder_start_status=0

    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != "1" ]; then
        log_error "Backend replacement requires the signed cleanup coordinator"
        return 1
    fi
    FRONTEND_PROXY_HOLDER_ID=""

    frontend_container="$(get_container_name frontend)"
    backend_container="$(get_container_name backend)"
    frontend_id="$(docker inspect -f '{{.Id}}' "$frontend_container" 2>/dev/null)" || return 1
    backend_id="$(docker inspect -f '{{.Id}}' "$backend_container" 2>/dev/null)" || return 1
    backend_image="$(docker inspect -f '{{.Config.Image}}' "$backend_container" 2>/dev/null)" || return 1
    network="$(resolve_frontend_backend_network "$frontend_container" "$backend_container")" || return 1
    old_ip="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$network\"}}{{.IPAddress}}{{end}}" "$backend_container" 2>/dev/null)" || return 1

    if [ -z "$frontend_id" ] || [ -z "$backend_id" ] || [ -z "$backend_image" ] || [ -z "$network" ] || [ -z "$old_ip" ]; then
        log_error "Could not capture the pre-replacement frontend/backend network identity"
        return 1
    fi

    assert_authenticated_me_response "$browser_base_url" || return 1
    assert_authenticated_websocket_handshake "$browser_base_url" || return 1

    register_coordinated_container "$backend_container" "$backend_id" || return 1
    remove_coordinated_container "$backend_id" || return 1
    ownership_label_args compose_container exact_delete || return 1
    holder_output="$(docker create --rm --name "$holder_container" \
        --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
        "${OWNERSHIP_LABEL_ARGS[@]}" \
        --network "$network" --ip "$old_ip" \
        --entrypoint sh "$backend_image" -c 'sleep 300')" || holder_create_status=$?
    FRONTEND_PROXY_HOLDER_ID="$(resolve_registered_created_container \
        "$holder_container" "$holder_output" "$holder_create_status")" || holder_resolve_status=$?
    if ! [[ "$FRONTEND_PROXY_HOLDER_ID" =~ ^[0-9a-f]{64}$ ]]; then
        log_error "Backend IP holder identity was not proven"
        return 1
    fi
    if [ "$holder_resolve_status" -ne 0 ]; then
        retire_install_container "$FRONTEND_PROXY_HOLDER_ID" stop || true
        return "$holder_resolve_status"
    fi
    start_registered_install_container "$FRONTEND_PROXY_HOLDER_ID" || holder_start_status=$?
    [ "$holder_start_status" -eq 0 ] || return "$holder_start_status"
    # Recreate the container only. The service declares pull_policy: build, so
    # a bare `up` rebuilds the image; BuildKit hands back the registered image
    # from cache, but Podman commits a new image ID on every build and the
    # lane's registered image goes dangling (#1032). start.sh always passes
    # --no-build for the same reason.
    run_project_compose "$PROJECT_ROOT" up -d --no-build --no-deps backend >/dev/null || return 1

    new_backend_container="$(get_container_name backend)"
    wait_for_container_healthy "$new_backend_container" "$HEALTH_CHECK_TIMEOUT" || return 1
    new_backend_id="$(docker inspect -f '{{.Id}}' "$new_backend_container" 2>/dev/null)" || return 1
    new_ip="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$network\"}}{{.IPAddress}}{{end}}" "$new_backend_container" 2>/dev/null)" || return 1

    if [ "$new_backend_id" = "$backend_id" ] || [ -z "$new_ip" ] || [ "$new_ip" = "$old_ip" ]; then
        log_error "Backend replacement did not create a new container at a different address"
        return 1
    fi
    if [ "$(docker inspect -f '{{.Id}}' "$frontend_container" 2>/dev/null)" != "$frontend_id" ]; then
        log_error "Frontend was recreated during backend-only replacement"
        return 1
    fi

    for attempt in $(seq 1 12); do
        if assert_authenticated_me_response "$browser_base_url"; then
            break
        fi
        if [ "$attempt" -eq 12 ]; then
            log_error "Frontend route did not recover within the Docker DNS refresh window"
            return 1
        fi
        sleep 1
    done

    assert_authenticated_websocket_handshake "$browser_base_url" || return 1
    if [ "$(docker inspect -f '{{.Id}}' "$frontend_container" 2>/dev/null)" != "$frontend_id" ]; then
        log_error "Frontend changed while proxy traffic recovered"
        return 1
    fi

    log_success "Unchanged frontend recovered API and WebSocket routes after backend IP replacement"
}

assert_frontend_proxy_recovers_after_backend_recreate() {
    local browser_base_url="$1"
    local holder_container="${COMPOSE_PROJECT_NAME}-backend-ip-holder-${TEST_ID}"
    local status

    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != "1" ]; then
        log_error "Backend replacement requires the signed cleanup coordinator"
        return 1
    fi
    FRONTEND_PROXY_HOLDER_ID=""
    if assert_frontend_proxy_recovers_after_backend_recreate_inner "$browser_base_url" "$holder_container"; then
        status=0
    else
        status=$?
    fi

    if [ -n "$FRONTEND_PROXY_HOLDER_ID" ]; then
        remove_coordinated_container "$FRONTEND_PROXY_HOLDER_ID" >/dev/null 2>&1 || true
    fi
    if ! run_project_compose "$PROJECT_ROOT" up -d --no-build --no-deps backend >/dev/null; then
        log_error "Could not restore the backend after the replacement regression"
        [ "$status" -ne 0 ] && return "$status"
        return 1
    fi
    if ! wait_for_container_healthy "$(get_container_name backend)" "$HEALTH_CHECK_TIMEOUT"; then
        log_error "Backend did not recover after the replacement regression"
        [ "$status" -ne 0 ] && return "$status"
        return 1
    fi

    return "$status"
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
