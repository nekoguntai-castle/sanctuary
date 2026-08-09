#!/bin/bash

set -euo pipefail

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 PROJECT_DIR COMPOSE_ARGS..." >&2
    exit 2
fi

project_dir="$1"
shift
compose_args=("$@")
export SANCTUARY_PROJECT_DIR="$project_dir"

readonly migration_script_sha256="499bcae312b11e1d66fbff0ca02ef02ce299505cbe93370de66aeda380115429"
readonly canonical_lock_root="/tmp/sanctuary-grafana-quiescence-locks"
resolved_project=""
resolved_data_volume=""
resolved_control_volume=""
resolved_image="sanctuary-grafana-migration:${SANCTUARY_IMAGE_TAG:-local}"
migration_image_id=""
migration_container=""
control_helper=""

fail() {
    echo "Grafana credential migration refused: $1" >&2
    return 1
}

compose_output() {
    docker compose "${compose_args[@]}" "$@"
}

resolve_project_name() {
    printf '%s\n' "$1" \
        | sed -n 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)"[,]*[[:space:]]*$/\1/p' \
        | head -n 1
}

resolve_volume_name() {
    local rendered="$1" logical_name="$2"
    printf '%s\n' "$rendered" | awk -v logical="$logical_name" '
      /^  "volumes": \{/ { in_volumes = 1; next }
      in_volumes && $0 ~ "^    \"" logical "\": \\{" { in_target = 1; next }
      in_target && /"name"[[:space:]]*:/ {
        line = $0
        sub(/^[^:]*:[[:space:]]*"/, "", line)
        sub(/"[,]?[[:space:]]*$/, "", line)
        print line
        exit
      }
    '
}

require_resource_identity() {
    case "$1" in
        ''|*[!A-Za-z0-9_.:-]*) fail "$2 identity is invalid." ;;
    esac
}

resolve_compose_identity() {
    local rendered images
    rendered="$(compose_output config --format json)" \
        || fail "Compose project inspection failed."
    resolved_project="$(resolve_project_name "$rendered")"
    resolved_data_volume="$(resolve_volume_name "$rendered" grafana_data)"
    resolved_control_volume="$(resolve_volume_name "$rendered" grafana_quiescence)"
    require_resource_identity "$resolved_project" "Compose project"
    require_resource_identity "$resolved_data_volume" "Grafana data volume"
    require_resource_identity "$resolved_control_volume" "Grafana control volume"
    images="$(compose_output config --images)" || fail "Compose image inspection failed."
    printf '%s\n' "$images" | grep -Fxq "$resolved_image" \
        || fail "the packaged Grafana migration image is not in the Compose project."
    migration_container="${resolved_project}-sanctuary-grafana-password-migration"
    control_helper="${resolved_project}-sanctuary-grafana-control-helper"
}

resolve_migration_image() {
    local identity image_id image_digest
    identity="$(docker image inspect --format \
        '{{.Id}}|{{index .Config.Labels "org.sanctuary.grafana-migration.script-sha256"}}' \
        "$resolved_image")" || fail "the packaged Grafana migration image is unavailable."
    IFS='|' read -r image_id image_digest <<< "$identity"
    [ -n "$image_id" ] && [ "$image_digest" = "$migration_script_sha256" ] \
        || fail "the packaged Grafana migration artifact digest is invalid."
    migration_image_id="$image_id"
}

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

inspect_control_helper() {
    docker container inspect --format \
        '{{.Id}}|{{.State.Status}}|{{.State.ExitCode}}|{{.Image}}|{{index .Config.Labels "sanctuary.grafana.role"}}|{{index .Config.Labels "sanctuary.grafana.project"}}|{{index .Config.Labels "sanctuary.grafana.data-volume"}}|{{index .Config.Labels "sanctuary.grafana.control-volume"}}' \
        "$control_helper"
}

reconcile_control_helper() {
    local identity id state exit_code image role project data_volume control_volume
    container_is_absent "$control_helper" && return 0
    identity="$(inspect_control_helper)" || fail "Grafana control helper identity is unavailable."
    IFS='|' read -r id state exit_code image role project data_volume control_volume <<< "$identity"
    [ "$image" = "$migration_image_id" ] && [ "$role" = "control-helper" ] \
        && [ "$project" = "$resolved_project" ] \
        && [ "$data_volume" = "$resolved_data_volume" ] \
        && [ "$control_volume" = "$resolved_control_volume" ] \
        || fail "the reserved Grafana control helper has an unexpected identity."
    case "$state" in
        exited|dead|created) ;;
        *) fail "a Grafana control helper is still active or indeterminate." ;;
    esac
    docker container rm "$id" >/dev/null \
        || fail "the terminal Grafana control helper could not be removed."
    container_is_absent "$control_helper" \
        || fail "Grafana control helper removal could not be verified."
}

run_control_helper() {
    local command="$1"
    shift
    local id identity state exit_code image role project data_volume control_volume status output
    reconcile_control_helper
    id="$(docker container create --pull never --name "$control_helper" \
        --label sanctuary.grafana.role=control-helper \
        --label "sanctuary.grafana.project=$resolved_project" \
        --label "sanctuary.grafana.data-volume=$resolved_data_volume" \
        --label "sanctuary.grafana.control-volume=$resolved_control_volume" \
        --user 0 --entrypoint /bin/sh \
        --mount "type=volume,src=$resolved_control_volume,dst=/control" \
        "$@" "$migration_image_id" -c "$command")" \
        || fail "Grafana control helper creation failed."
    identity="$(inspect_control_helper)" || fail "created Grafana control helper identity is unavailable."
    IFS='|' read -r _ state exit_code image role project data_volume control_volume <<< "$identity"
    [ "$image" = "$migration_image_id" ] && [ "$role" = "control-helper" ] \
        && [ "$project" = "$resolved_project" ] \
        && [ "$data_volume" = "$resolved_data_volume" ] \
        && [ "$control_volume" = "$resolved_control_volume" ] \
        || fail "created Grafana control helper identity is invalid."
    set +e
    output="$(docker container start -a "$id")"
    status=$?
    set -e
    identity="$(inspect_control_helper)" || fail "completed Grafana control helper identity is unavailable."
    IFS='|' read -r _ state exit_code _ <<< "$identity"
    [ "$state" = "exited" ] && [ "$exit_code" = "$status" ] \
        || fail "Grafana control helper terminal state is inconsistent."
    docker container rm "$id" >/dev/null \
        || fail "completed Grafana control helper could not be removed."
    [ "$status" -eq 0 ] || fail "Grafana control helper failed with exit code $status."
    CONTROL_HELPER_OUTPUT="$output"
}

ensure_compose_volume() {
    local volume="$1" logical_name="$2" identity
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
        docker volume create \
            --label "com.docker.compose.project=$resolved_project" \
            --label "com.docker.compose.volume=$logical_name" \
            "$volume" >/dev/null \
            || fail "Grafana $logical_name volume creation failed."
    fi
    identity="$(docker volume inspect --format \
        '{{.Name}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}' \
        "$volume")" || fail "Grafana $logical_name volume identity is unavailable."
    [ "$identity" = "$volume|$resolved_project|$logical_name" ] \
        || fail "Grafana $logical_name volume has an unexpected identity."
}

ensure_control_volume() {
    run_control_helper \
        'set -eu; mkdir -p /control/leases /control/claims /control/outcomes; chown -R 472:472 /control; chmod 0700 /control /control/leases /control/claims /control/outcomes'
}

write_lease() {
    local token="$1" container_id="$2" generation="$3" expires_at="$4"
    run_control_helper \
        'set -eu; umask 077; tmp="/control/leases/lease-$TOKEN.tmp.$$"; { printf "version=2\n"; printf "token=%s\n" "$TOKEN"; printf "project=%s\n" "$PROJECT"; printf "data_volume=%s\n" "$DATA_VOLUME"; printf "control_volume=%s\n" "$CONTROL_VOLUME"; printf "container_id=%s\n" "$CONTAINER_ID"; printf "generation=%s\n" "$GENERATION"; printf "expires_at=%s\n" "$EXPIRES_AT"; } > "$tmp"; chown 472:472 "$tmp"; mv "$tmp" "/control/leases/lease-$TOKEN"' \
        -e "TOKEN=$token" -e "PROJECT=$resolved_project" \
        -e "DATA_VOLUME=$resolved_data_volume" -e "CONTROL_VOLUME=$resolved_control_volume" \
        -e "CONTAINER_ID=$container_id" -e "GENERATION=$generation" \
        -e "EXPIRES_AT=$expires_at"
}

read_outcome() {
    local token="$1"
    run_control_helper 'cat "/control/outcomes/outcome-$TOKEN"' -e "TOKEN=$token"
    printf '%s\n' "$CONTROL_HELPER_OUTPUT"
}

cleanup_control_artifacts() {
    local token="$1"
    run_control_helper \
        'rm -f "/control/leases/lease-$TOKEN" "/control/outcomes/outcome-$TOKEN"; rmdir "/control/claims/$TOKEN" 2>/dev/null || true' \
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

inspect_migration_container() {
    docker container inspect --format \
        '{{.Id}}|{{.State.Status}}|{{.State.ExitCode}}|{{.Image}}|{{index .Config.Labels "sanctuary.grafana.project"}}|{{index .Config.Labels "sanctuary.grafana.data-volume"}}|{{index .Config.Labels "sanctuary.grafana.control-volume"}}|{{index .Config.Labels "sanctuary.grafana.token"}}|{{index .Config.Labels "sanctuary.grafana.container-id"}}|{{index .Config.Labels "sanctuary.grafana.generation"}}' \
        "$migration_container"
}

remove_terminal_migration_container() {
    local identity="$1"
    local id state exit_code image project data_volume control_volume token container_id generation outcome_status
    IFS='|' read -r id state exit_code image project data_volume control_volume token container_id generation <<< "$identity"
    [ "$image" = "$migration_image_id" ] && [ "$project" = "$resolved_project" ] \
        && [ "$data_volume" = "$resolved_data_volume" ] \
        && [ "$control_volume" = "$resolved_control_volume" ] \
        || fail "the reserved migration container has an unexpected identity."
    [ "$state" = "exited" ] || fail "a prior Grafana credential migration is still active or indeterminate."
    outcome_status=success
    [ "$exit_code" = "0" ] || outcome_status=rolled-back
    validate_outcome "$token" "$outcome_status" "$container_id" "$generation" \
        || fail "a prior Grafana credential migration has no valid daemon-visible outcome."
    docker container rm "$id" >/dev/null \
        || fail "the terminal migration container could not be removed."
    cleanup_control_artifacts "$token"
    container_is_absent "$migration_container" \
        || fail "migration container removal could not be verified."
}

reconcile_migration_container() {
    local identity
    container_is_absent "$migration_container" && return 0
    identity="$(inspect_migration_container)" \
        || fail "migration container identity is unavailable."
    remove_terminal_migration_container "$identity"
}

inspect_generation() {
    docker inspect --format '{{.Id}}|{{.Created}}|{{index .Config.Labels "com.docker.compose.project"}}' "$1"
}

assert_stopped_identity() {
    local expected_id="$1" current_id running
    running="$(compose_output ps -q --status running grafana)" \
        || fail "Grafana running-state inspection failed."
    [ -z "$running" ] || fail "Grafana is still running after stop."
    current_id="$(compose_output ps -aq grafana)" \
        || fail "Grafana container identity inspection failed."
    [ "$current_id" = "$expected_id" ] \
        || fail "Grafana container identity changed during quiescence."
    if [ -n "$expected_id" ]; then
        [ "$(docker inspect --format '{{.State.Running}}' "$expected_id")" = "false" ] \
            || fail "Grafana stopped-state inspection failed."
    fi
}

create_migration_container() {
    local token="$1" grafana_container_id="$2" generation="$3"
    docker container create --pull never --name "$migration_container" \
        --label sanctuary.grafana.role=password-migration \
        --label "sanctuary.grafana.project=$resolved_project" \
        --label "sanctuary.grafana.data-volume=$resolved_data_volume" \
        --label "sanctuary.grafana.control-volume=$resolved_control_volume" \
        --label "sanctuary.grafana.token=$token" \
        --label "sanctuary.grafana.container-id=$grafana_container_id" \
        --label "sanctuary.grafana.generation=$generation" \
        -e "GRAFANA_PASSWORD=$GRAFANA_PASSWORD" \
        -e SANCTUARY_GRAFANA_CONTROL_DIR=/var/lib/sanctuary-grafana-control \
        -e "SANCTUARY_GRAFANA_QUIESCENCE_TOKEN=$token" \
        -e "SANCTUARY_GRAFANA_QUIESCENCE_PROJECT=$resolved_project" \
        -e "SANCTUARY_GRAFANA_DATA_VOLUME=$resolved_data_volume" \
        -e "SANCTUARY_GRAFANA_CONTROL_VOLUME=$resolved_control_volume" \
        -e "SANCTUARY_GRAFANA_QUIESCENCE_CONTAINER_ID=$grafana_container_id" \
        -e "SANCTUARY_GRAFANA_QUIESCENCE_GENERATION=$generation" \
        --mount "type=volume,src=$resolved_data_volume,dst=/var/lib/grafana" \
        --mount "type=volume,src=$resolved_control_volume,dst=/var/lib/sanctuary-grafana-control" \
        "$migration_image_id"
}

run_migration() {
    local token="$1" grafana_container_id="$2" generation="$3"
    local id identity inspected_id state exit_code image project data_volume control_volume inspected_token inspected_container inspected_generation wait_code
    id="$(create_migration_container "$token" "$grafana_container_id" "$generation")" \
        || fail "migration container launch failed; reserved state requires reconciliation."
    identity="$(inspect_migration_container)" \
        || fail "launched migration container identity is unavailable."
    IFS='|' read -r inspected_id state exit_code image project data_volume control_volume inspected_token inspected_container inspected_generation <<< "$identity"
    [ "$inspected_id" = "$id" ] && [ "$state" = "created" ] \
        && [ "$image" = "$migration_image_id" ] && [ "$project" = "$resolved_project" ] \
        && [ "$data_volume" = "$resolved_data_volume" ] \
        && [ "$control_volume" = "$resolved_control_volume" ] \
        && [ "$inspected_token" = "$token" ] \
        && [ "$inspected_container" = "$grafana_container_id" ] \
        && [ "$inspected_generation" = "$generation" ] \
        || fail "launched migration container identity does not match its lease."
    docker container start "$id" >/dev/null \
        || fail "migration container start failed; reserved state requires reconciliation."
    wait_code="$(docker wait "$id")" \
        || fail "migration container completion is unavailable."
    identity="$(inspect_migration_container)" \
        || fail "completed migration container identity is unavailable."
    IFS='|' read -r _ state exit_code _ <<< "$identity"
    [ "$state" = "exited" ] && [ "$exit_code" = "$wait_code" ] \
        || fail "migration container terminal state is inconsistent."
    if [ "$exit_code" = "0" ]; then
        validate_outcome "$token" success "$grafana_container_id" "$generation" \
            || fail "Grafana credential migration did not publish a valid success outcome."
    else
        validate_outcome "$token" rolled-back "$grafana_container_id" "$generation" \
            || fail "Grafana credential migration failed without a valid rollback outcome."
        fail "Grafana credential migration failed with exit code $exit_code."
    fi
    docker container rm "$id" >/dev/null \
        || fail "completed migration container could not be removed."
    cleanup_control_artifacts "$token"
    container_is_absent "$migration_container" \
        || fail "completed migration container removal could not be verified."
}

run_locked_workflow() {
    local container_id identity inspected_id generation inspected_project token expires_at
    reconcile_control_helper
    ensure_compose_volume "$resolved_data_volume" grafana_data
    ensure_compose_volume "$resolved_control_volume" grafana_quiescence
    ensure_control_volume
    reconcile_migration_container
    container_id="$(compose_output ps -aq grafana)" \
        || fail "Grafana container identity inspection failed."
    generation=absent
    if [ -n "$container_id" ]; then
        identity="$(inspect_generation "$container_id")" \
            || fail "Grafana container generation inspection failed."
        IFS='|' read -r inspected_id generation inspected_project <<< "$identity"
        [ "$inspected_id" = "$container_id" ] && [ "$inspected_project" = "$resolved_project" ] \
            || fail "Grafana container identity does not belong to this Compose project."
    else
        container_id=absent
    fi
    compose_output stop grafana || fail "Grafana stop failed."
    assert_stopped_identity "$([ "$container_id" = absent ] && printf '' || printf '%s' "$container_id")"
    token="$(openssl rand -hex 32)"
    expires_at="$(( $(date +%s) + 300 ))"
    write_lease "$token" "$container_id" "$generation" "$expires_at"
    run_migration "$token" "$container_id" "$generation"
}

run_with_optional_flock() {
    local lock_file
    if ! command -v flock >/dev/null 2>&1; then
        run_locked_workflow
        return
    fi
    [ ! -L "$canonical_lock_root" ] \
        || fail "canonical quiescence lock path must not be a symlink."
    mkdir -p "$canonical_lock_root"
    chmod 1777 "$canonical_lock_root" 2>/dev/null || true
    lock_file="$canonical_lock_root/$resolved_project--$resolved_data_volume--$resolved_control_volume.lock"
    [ ! -L "$lock_file" ] || fail "canonical quiescence lock file must not be a symlink."
    umask 000
    : >> "$lock_file" || fail "canonical quiescence lock file is unavailable."
    chmod 666 "$lock_file" 2>/dev/null || true
    exec 9<>"$lock_file" || fail "canonical quiescence lock could not be opened."
    flock -n 9 || fail "another Grafana start or migration owns the quiescence lock."
    run_locked_workflow
}

resolve_compose_identity
resolve_migration_image
run_with_optional_flock
