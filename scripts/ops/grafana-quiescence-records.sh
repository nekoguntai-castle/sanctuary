#!/bin/bash

# Scoped daemon-volume records used by the Grafana quiescence coordinator.
# The sourcing wrapper provides run_control_helper and the resolved identities.

container_listing() {
    docker container ls -a --filter "name=^/$1$" --format '{{.ID}}'
}

container_is_absent() {
    local name="$1" listed
    if docker container inspect "$name" >/dev/null 2>&1; then
        return 1
    fi
    listed="$(container_listing "$name")" || fail "container status is unavailable for $name."
    [ -z "$listed" ]
}

container_id_is_absent() {
    local container_id="$1" listed
    if docker container inspect "$container_id" >/dev/null 2>&1; then
        return 1
    fi
    listed="$(docker container ls -a --no-trunc \
        --filter "id=$container_id" --format '{{.ID}}')" \
        || return 2
    [ -z "$listed" ]
}

record_registered_transient_retirement() {
    printf 'registered-transient resource_class=compose_container immutable_id=%s postcondition=absent\n' "$1" >&2
}

register_transient_container() {
    local container_id="$1"
    register_owned_resource compose_container obsolete exact_delete engine_id \
        "$container_id" "$container_id" "$SANCTUARY_OPERATION_RUN_ID"
}

inspect_control_helper() {
    local helper_id="$1"
    docker container inspect --format \
        '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.ExitCode}}|{{.Image}}|{{.Created}}|{{index .Config.Labels "sanctuary.grafana.role"}}|{{index .Config.Labels "sanctuary.grafana.project"}}|{{index .Config.Labels "sanctuary.grafana.data-volume"}}|{{index .Config.Labels "sanctuary.grafana.control-volume"}}|{{index .Config.Labels "sanctuary.grafana.owner"}}|{{index .Config.Labels "sanctuary.grafana.operation"}}|{{index .Config.Labels "sanctuary.grafana.nonce"}}' \
        "$helper_id"
}

validate_control_helper_identity() {
    local identity="$1" expected_id="$2" expected_owner="$3" expected_operation="$4" expected_nonce="$5"
    local id name state exit_code image created role project data_volume control_volume owner operation nonce
    IFS='|' read -r id name state exit_code image created role project data_volume control_volume owner operation nonce <<< "$identity"
    [ "$id" = "$expected_id" ] \
        && [ "$name" = "/${resolved_project}-sanctuary-grafana-control-${nonce}" ] \
        && [ "$image" = "$migration_image_id" ] \
        && [ "$role" = "control-helper" ] && [ "$project" = "$resolved_project" ] \
        && [ "$data_volume" = "$resolved_data_volume" ] \
        && [ "$control_volume" = "$resolved_control_volume" ] \
        && [ "$owner" = "$expected_owner" ] \
        && [ "$operation" = "$expected_operation" ] \
        && [ "$nonce" = "$expected_nonce" ]
}

retire_control_helper() {
    local helper_id="$1" expected_owner="$2" expected_operation="$3" expected_nonce="$4"
    local identity remove_status=0
    identity="$(inspect_control_helper "$helper_id")" || return 1
    validate_control_helper_identity \
        "$identity" "$helper_id" "$expected_owner" "$expected_operation" "$expected_nonce" \
        || return 1
    docker container rm "$helper_id" >/dev/null || remove_status=$?
    if ! container_id_is_absent "$helper_id"; then
        [ "$remove_status" -ne 0 ] && return "$remove_status"
        return 1
    fi
    record_registered_transient_retirement "$helper_id"
}

last_observed_control_helper_state=""
last_observed_control_helper_exit_code=""

await_terminal_control_helper_identity() {
    local helper_id="$1" expected_owner="$2" expected_operation="$3" expected_nonce="$4" wait_code="$5"
    local attempt=1 identity state exit_code

    while :; do
        identity="$(inspect_control_helper "$helper_id")" || return 2
        validate_control_helper_identity \
            "$identity" "$helper_id" "$expected_owner" "$expected_operation" "$expected_nonce" \
            || return 3
        IFS='|' read -r _ _ state exit_code _ <<< "$identity"
        last_observed_control_helper_state="$state"
        last_observed_control_helper_exit_code="$exit_code"
        if [ "$state" = "exited" ] && [ "$exit_code" = "$wait_code" ]; then
            return 0
        fi
        [ "$attempt" -lt "$control_helper_terminal_settle_attempts" ] || return 1
        attempt=$((attempt + 1))
        sleep "$control_helper_terminal_settle_delay"
    done
}

complete_control_helper() {
    local helper_id="$1" operation="$2" nonce="$3"
    local status output wait_output settle_status

    docker container start "$helper_id" >/dev/null \
        || fail "Grafana control helper start failed."
    wait_output="$(docker wait "$helper_id")" \
        || fail "Grafana control helper completion is unavailable."
    case "$wait_output" in
        ''|*[!0-9]*) fail "Grafana control helper exit status is invalid." ;;
    esac
    status="$wait_output"
    output="$(docker logs "$helper_id")" \
        || fail "Grafana control helper output is unavailable."
    settle_status=0
    await_terminal_control_helper_identity \
        "$helper_id" "$wrapper_owner_token" "$operation" "$nonce" "$status" \
        || settle_status=$?
    [ "$settle_status" != "2" ] \
        || fail "completed Grafana control helper identity is unavailable."
    [ "$settle_status" != "3" ] \
        || fail "completed Grafana control helper identity is invalid."
    [ "$settle_status" = "0" ] \
        || fail "Grafana control helper terminal state is inconsistent (state=$last_observed_control_helper_state exit_code=$last_observed_control_helper_exit_code wait_code=$status)."
    retire_control_helper "$helper_id" "$wrapper_owner_token" "$operation" "$nonce" \
        || fail "completed Grafana control helper could not be removed."
    [ "$status" -eq 0 ] || fail "Grafana control helper failed with exit code $status."
    CONTROL_HELPER_OUTPUT="$output"
}

run_control_helper() {
    local operation="$1" command="$2"
    shift 2
    local nonce helper_name id create_output identity state create_status=0 output_status=0
    local SANCTUARY_RESOURCE_LIFECYCLE=obsolete
    ownership_label_args compose_container exact_delete
    nonce="$(openssl rand -hex 16)"
    helper_name="${resolved_project}-sanctuary-grafana-control-${nonce}"
    create_output="$(docker container create --pull never --name "$helper_name" \
        "${OWNERSHIP_LABEL_ARGS[@]}" \
        --label sanctuary.grafana.role=control-helper \
        --label "sanctuary.grafana.project=$resolved_project" \
        --label "sanctuary.grafana.data-volume=$resolved_data_volume" \
        --label "sanctuary.grafana.control-volume=$resolved_control_volume" \
        --label "sanctuary.grafana.owner=$wrapper_owner_token" \
        --label "sanctuary.grafana.operation=$operation" \
        --label "sanctuary.grafana.nonce=$nonce" \
        --user 0 --entrypoint /bin/sh \
        --mount "type=volume,src=$resolved_control_volume,dst=/control" \
        "$@" "$migration_image_id" -c "$command")" || create_status=$?
    id="$(recover_exact_created_container "$helper_name")" || {
        [ "$create_status" -ne 0 ] && return "$create_status"
        return 1
    }
    [ "$create_status" -ne 0 ] || [ "$create_output" = "$id" ] || output_status=1
    identity="$(inspect_control_helper "$id")" \
        || fail "created Grafana control helper identity is unavailable."
    validate_control_helper_identity "$identity" "$id" "$wrapper_owner_token" "$operation" "$nonce" \
        || fail "created Grafana control helper identity is invalid."
    register_transient_container "$id" \
        || fail "created Grafana control helper registration failed."
    IFS='|' read -r _ _ state _ <<< "$identity"
    [ "$state" = "created" ] || fail "created Grafana control helper is not startable."
    if [ "$create_status" -ne 0 ] || [ "$output_status" -ne 0 ]; then
        retire_control_helper "$id" "$wrapper_owner_token" "$operation" "$nonce" \
            || fail "recovered Grafana control helper could not be removed."
        [ "$create_status" -ne 0 ] && return "$create_status"
        return "$output_status"
    fi
    complete_control_helper "$id" "$operation" "$nonce"
}

daemon_epoch() {
    run_control_helper daemon-time 'date +%s'
    case "$CONTROL_HELPER_OUTPUT" in
        ''|*[!0-9]*) fail "Docker daemon time is unavailable." ;;
    esac
    printf '%s\n' "$CONTROL_HELPER_OUTPUT"
}

control_helper_ids() {
    docker container ls -a \
        --filter 'label=sanctuary.grafana.role=control-helper' \
        --filter "label=sanctuary.grafana.project=$resolved_project" \
        --filter "label=sanctuary.grafana.data-volume=$resolved_data_volume" \
        --filter "label=sanctuary.grafana.control-volume=$resolved_control_volume" \
        --format '{{.ID}}'
}

reconcile_abandoned_control_helpers() {
    local now identity id name state exit_code image created role project data_volume control_volume owner operation nonce created_epoch
    now="$(daemon_epoch)"
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        identity="$(inspect_control_helper "$id")" \
            || fail "Grafana control helper identity is unavailable."
        IFS='|' read -r _ name state exit_code image created role project data_volume control_volume owner operation nonce <<< "$identity"
        case "$owner:$nonce" in
            *[!0-9a-f:]*) fail "an abandoned Grafana control helper has invalid ownership labels." ;;
        esac
        [ "${#owner}" -eq 64 ] && [ "${#nonce}" -eq 32 ] \
            || fail "an abandoned Grafana control helper has incomplete ownership labels."
        case "$operation" in
            daemon-time|created-time|control-init|lease-write|outcome-read|lease-read|abandonment-read|reclamation-read|reclamation-claim|record-cleanup|abandonment-write) ;;
            *) fail "an abandoned Grafana control helper has an unknown operation label." ;;
        esac
        validate_control_helper_identity "$identity" "$id" "$owner" "$operation" "$nonce" \
            || fail "an abandoned Grafana control helper has an unexpected identity."
        case "$state" in
            exited|dead|created) ;;
            *) continue ;;
        esac
        run_control_helper created-time \
            'value="${CREATED%%.*}"; value="${value%Z}"; value="${value/T/ }"; date -u -d "$value" +%s' \
            -e "CREATED=$created"
        created_epoch="$CONTROL_HELPER_OUTPUT"
        case "$created_epoch" in
            ''|*[!0-9]*) fail "Grafana control helper creation time is invalid." ;;
        esac
        [ "$((now - created_epoch))" -ge "$helper_stale_after_seconds" ] || continue
        retire_control_helper "$id" "$owner" "$operation" "$nonce" \
            || fail "an abandoned Grafana control helper could not be removed."
    done < <(control_helper_ids)
}

write_lease() {
    local token="$1" container_id="$2" generation="$3" expires_at="$4"
    run_control_helper lease-write \
        'set -eu; umask 077; tmp="/control/leases/lease-$TOKEN.tmp.$$"; { printf "version=2\n"; printf "token=%s\n" "$TOKEN"; printf "project=%s\n" "$PROJECT"; printf "data_volume=%s\n" "$DATA_VOLUME"; printf "control_volume=%s\n" "$CONTROL_VOLUME"; printf "container_id=%s\n" "$CONTAINER_ID"; printf "generation=%s\n" "$GENERATION"; printf "expires_at=%s\n" "$EXPIRES_AT"; } > "$tmp"; chown 472:472 "$tmp"; mv "$tmp" "/control/leases/lease-$TOKEN"' \
        -e "TOKEN=$token" -e "PROJECT=$resolved_project" \
        -e "DATA_VOLUME=$resolved_data_volume" -e "CONTROL_VOLUME=$resolved_control_volume" \
        -e "CONTAINER_ID=$container_id" -e "GENERATION=$generation" \
        -e "EXPIRES_AT=$expires_at"
}

read_outcome() {
    local token="$1"
    run_control_helper outcome-read 'cat "/control/outcomes/outcome-$TOKEN"' -e "TOKEN=$token"
    printf '%s\n' "$CONTROL_HELPER_OUTPUT"
}

read_lease() {
    local token="$1"
    run_control_helper lease-read 'cat "/control/leases/lease-$TOKEN"' -e "TOKEN=$token"
    printf '%s\n' "$CONTROL_HELPER_OUTPUT"
}

read_abandonment() {
    local token="$1"
    run_control_helper abandonment-read 'cat "/control/abandonments/abandonment-$TOKEN"' -e "TOKEN=$token"
    printf '%s\n' "$CONTROL_HELPER_OUTPUT"
}

read_reclamation_claim() {
    local token="$1"
    run_control_helper reclamation-read 'cat "/control/claims/$TOKEN"' -e "TOKEN=$token"
    printf '%s\n' "$CONTROL_HELPER_OUTPUT"
}

write_reclamation_claim() {
    local token="$1" migration_id="$2" container_id="$3" generation="$4"
    run_control_helper reclamation-claim \
        'set -eu; umask 077; tmp="/control/claims/reclaim-$TOKEN.$$.tmp"; { printf "version=1\n"; printf "status=reclaiming-before-start\n"; printf "token=%s\n" "$TOKEN"; printf "project=%s\n" "$PROJECT"; printf "data_volume=%s\n" "$DATA_VOLUME"; printf "control_volume=%s\n" "$CONTROL_VOLUME"; printf "migration_id=%s\n" "$MIGRATION_ID"; printf "container_id=%s\n" "$CONTAINER_ID"; printf "generation=%s\n" "$GENERATION"; } > "$tmp"; chown 472:472 "$tmp"; if ln -T "$tmp" "/control/claims/$TOKEN" 2>/dev/null; then result=claimed; else result=exists; fi; rm -f "$tmp"; printf "%s\n" "$result"' \
        -e "TOKEN=$token" -e "PROJECT=$resolved_project" \
        -e "DATA_VOLUME=$resolved_data_volume" -e "CONTROL_VOLUME=$resolved_control_volume" \
        -e "MIGRATION_ID=$migration_id" -e "CONTAINER_ID=$container_id" \
        -e "GENERATION=$generation"
    [ "$CONTROL_HELPER_OUTPUT" = claimed ]
}

cleanup_control_artifacts() {
    local token="$1"
    run_control_helper record-cleanup \
        'rm -f "/control/leases/lease-$TOKEN" "/control/outcomes/outcome-$TOKEN" "/control/abandonments/abandonment-$TOKEN"; if [ -f "/control/claims/$TOKEN" ]; then rm -f "/control/claims/$TOKEN"; else rmdir "/control/claims/$TOKEN" 2>/dev/null || true; fi' \
        -e "TOKEN=$token"
}

record_value() {
    local record="$1" key="$2"
    printf '%s\n' "$record" | sed -n "s/^${key}=//p"
}

validate_outcome() {
    local token="$1" expected_status="$2" expected_container="$3" expected_generation="$4"
    local outcome status
    outcome="$(read_outcome "$token")" || return 1
    status="$(record_value "$outcome" status)"
    [ "$(record_value "$outcome" version)" = "1" ] \
        && [ "$status" = "$expected_status" ] \
        && [ "$(record_value "$outcome" token)" = "$token" ] \
        && [ "$(record_value "$outcome" project)" = "$resolved_project" ] \
        && [ "$(record_value "$outcome" data_volume)" = "$resolved_data_volume" ] \
        && [ "$(record_value "$outcome" control_volume)" = "$resolved_control_volume" ] \
        && [ "$(record_value "$outcome" container_id)" = "$expected_container" ] \
        && [ "$(record_value "$outcome" generation)" = "$expected_generation" ]
}

validate_lease() {
    local token="$1" expected_container="$2" expected_generation="$3"
    local lease
    lease="$(read_lease "$token")" || return 1
    [ "$(record_value "$lease" version)" = "2" ] \
        && [ "$(record_value "$lease" token)" = "$token" ] \
        && [ "$(record_value "$lease" project)" = "$resolved_project" ] \
        && [ "$(record_value "$lease" data_volume)" = "$resolved_data_volume" ] \
        && [ "$(record_value "$lease" control_volume)" = "$resolved_control_volume" ] \
        && [ "$(record_value "$lease" container_id)" = "$expected_container" ] \
        && [ "$(record_value "$lease" generation)" = "$expected_generation" ]
}

lease_expiry() {
    local token="$1" lease
    lease="$(read_lease "$token")" || return 1
    record_value "$lease" expires_at
}

write_abandonment() {
    local token="$1" migration_id="$2" container_id="$3" generation="$4"
    run_control_helper abandonment-write \
        'set -eu; umask 077; tmp="/control/abandonments/abandonment-$TOKEN.tmp.$$"; { printf "version=1\n"; printf "status=abandoned-before-start\n"; printf "token=%s\n" "$TOKEN"; printf "project=%s\n" "$PROJECT"; printf "data_volume=%s\n" "$DATA_VOLUME"; printf "control_volume=%s\n" "$CONTROL_VOLUME"; printf "migration_id=%s\n" "$MIGRATION_ID"; printf "container_id=%s\n" "$CONTAINER_ID"; printf "generation=%s\n" "$GENERATION"; } > "$tmp"; chown 472:472 "$tmp"; mv "$tmp" "/control/abandonments/abandonment-$TOKEN"' \
        -e "TOKEN=$token" -e "PROJECT=$resolved_project" \
        -e "DATA_VOLUME=$resolved_data_volume" -e "CONTROL_VOLUME=$resolved_control_volume" \
        -e "MIGRATION_ID=$migration_id" -e "CONTAINER_ID=$container_id" \
        -e "GENERATION=$generation"
}

validate_abandonment() {
    local token="$1" migration_id="$2" container_id="$3" generation="$4"
    local record
    record="$(read_abandonment "$token")" || return 1
    [ "$(record_value "$record" version)" = "1" ] \
        && [ "$(record_value "$record" status)" = "abandoned-before-start" ] \
        && [ "$(record_value "$record" token)" = "$token" ] \
        && [ "$(record_value "$record" project)" = "$resolved_project" ] \
        && [ "$(record_value "$record" data_volume)" = "$resolved_data_volume" ] \
        && [ "$(record_value "$record" control_volume)" = "$resolved_control_volume" ] \
        && [ "$(record_value "$record" migration_id)" = "$migration_id" ] \
        && [ "$(record_value "$record" container_id)" = "$container_id" ] \
        && [ "$(record_value "$record" generation)" = "$generation" ]
}

validate_reclamation_claim() {
    local token="$1" migration_id="$2" container_id="$3" generation="$4"
    local record
    record="$(read_reclamation_claim "$token")" || return 1
    [ "$(record_value "$record" version)" = "1" ] \
        && [ "$(record_value "$record" status)" = "reclaiming-before-start" ] \
        && [ "$(record_value "$record" token)" = "$token" ] \
        && [ "$(record_value "$record" project)" = "$resolved_project" ] \
        && [ "$(record_value "$record" data_volume)" = "$resolved_data_volume" ] \
        && [ "$(record_value "$record" control_volume)" = "$resolved_control_volume" ] \
        && [ "$(record_value "$record" migration_id)" = "$migration_id" ] \
        && [ "$(record_value "$record" container_id)" = "$container_id" ] \
        && [ "$(record_value "$record" generation)" = "$generation" ]
}

claim_reclamation() {
    local token="$1" migration_id="$2" container_id="$3" generation="$4"
    write_reclamation_claim "$token" "$migration_id" "$container_id" "$generation" \
        || validate_reclamation_claim "$token" "$migration_id" "$container_id" "$generation"
    validate_reclamation_claim "$token" "$migration_id" "$container_id" "$generation"
}

assert_reclamation_identity() {
    local identity="$1" expected_id="$2" token="$3" container_id="$4" generation="$5"
    local id state exit_code image role project data_volume control_volume inspected_token inspected_container inspected_generation
    validate_migration_identity "$identity" || return 1
    IFS='|' read -r id state exit_code image role project data_volume control_volume inspected_token inspected_container inspected_generation <<< "$identity"
    [ "$id" = "$expected_id" ] && [ "$inspected_token" = "$token" ] \
        && [ "$inspected_container" = "$container_id" ] \
        && [ "$inspected_generation" = "$generation" ]
}

retire_migration_container() {
    local expected_id="$1" token="$2" container_id="$3" generation="$4"
    local identity remove_status=0
    identity="$(inspect_migration_container "$expected_id")" || return 1
    assert_reclamation_identity "$identity" "$expected_id" "$token" "$container_id" "$generation" \
        || return 1
    docker container rm "$expected_id" >/dev/null || remove_status=$?
    if ! container_id_is_absent "$expected_id"; then
        [ "$remove_status" -ne 0 ] && return "$remove_status"
        return 1
    fi
    record_registered_transient_retirement "$expected_id"
}

wait_and_remove_reclaimed_migration() {
    local expected_id="$1" token="$2" container_id="$3" generation="$4"
    local identity id state exit_code wait_code settle_status
    wait_code="$(docker wait "$expected_id")" \
        || fail "the reclaimed migration container did not stop."
    # Same podman cleanup-window race as run_migration; this is the path that
    # recovers from that very failure, so it must not be racy itself.
    settle_status=0
    identity="$(await_terminal_migration_identity "$wait_code")" || settle_status=$?
    [ "$settle_status" != "2" ] \
        || fail "the reclaimed migration terminal identity is unavailable."
    [ "$settle_status" = "0" ] \
        || fail "the reclaimed migration terminal state is inconsistent (state=$last_observed_migration_state exit_code=$last_observed_migration_exit_code wait_code=$wait_code)."
    assert_reclamation_identity "$identity" "$expected_id" "$token" "$container_id" "$generation" \
        || fail "the reclaimed migration terminal identity changed."
    IFS='|' read -r id state exit_code _ <<< "$identity"
    retire_migration_container "$id" "$token" "$container_id" "$generation" \
        || fail "the reclaimed migration container could not be removed."
}

recover_reclaimed_removal_failure() {
    local expected_id="$1" token="$2" container_id="$3" generation="$4"
    local identity id state exit_code
    identity="$(inspect_migration_container)" \
        || fail "the reclaiming migration state is unavailable after removal failure."
    assert_reclamation_identity "$identity" "$expected_id" "$token" "$container_id" "$generation" \
        || fail "the reclaiming migration identity changed after removal failure."
    IFS='|' read -r id state exit_code _ <<< "$identity"
    case "$state" in
        running) wait_and_remove_reclaimed_migration "$expected_id" "$token" "$container_id" "$generation" ;;
        exited|stopped) retire_migration_container "$id" "$token" "$container_id" "$generation" \
            || fail "the exited reclaimed migration container could not be removed." ;;
        *) fail "the reclaimed migration container could not be removed safely." ;;
    esac
}
