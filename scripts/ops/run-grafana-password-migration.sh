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
ownership_registration_enabled=false
[ -z "${SANCTUARY_OWNERSHIP_ROOT:-}" ] || ownership_registration_enabled=true

readonly migration_script_sha256="499bcae312b11e1d66fbff0ca02ef02ce299505cbe93370de66aeda380115429"
readonly canonical_lock_root="/tmp/sanctuary-grafana-quiescence-locks"
resolved_project=""
resolved_data_volume=""
resolved_control_volume=""
resolved_image="sanctuary-grafana-migration:${SANCTUARY_IMAGE_TAG:-local}"
migration_image_id=""
migration_container=""
readonly helper_stale_after_seconds=300
readonly control_helper_terminal_settle_attempts="${SANCTUARY_GRAFANA_TERMINAL_SETTLE_ATTEMPTS:-20}"
readonly control_helper_terminal_settle_delay="${SANCTUARY_GRAFANA_TERMINAL_SETTLE_DELAY:-1}"
readonly wrapper_owner_token="$(openssl rand -hex 32)"
# shellcheck source=scripts/ops/grafana-quiescence-records.sh
script_path="${BASH_SOURCE[0]}"
script_dir="${script_path%/*}"
[ "$script_dir" != "$script_path" ] || script_dir="."
# shellcheck source=scripts/ownership/producer-hooks.sh
source "$script_dir/../ownership/producer-hooks.sh"
source "$script_dir/grafana-quiescence-records.sh"

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
    run_control_helper control-init \
        'set -eu; mkdir -p /control/leases /control/claims /control/outcomes /control/abandonments; chown -R 472:472 /control; chmod 0700 /control /control/leases /control/claims /control/outcomes /control/abandonments'
    reconcile_abandoned_control_helpers
}

inspect_migration_container() {
    docker container inspect --format \
        '{{.Id}}|{{.State.Status}}|{{.State.ExitCode}}|{{.Image}}|{{index .Config.Labels "sanctuary.grafana.role"}}|{{index .Config.Labels "sanctuary.grafana.project"}}|{{index .Config.Labels "sanctuary.grafana.data-volume"}}|{{index .Config.Labels "sanctuary.grafana.control-volume"}}|{{index .Config.Labels "sanctuary.grafana.token"}}|{{index .Config.Labels "sanctuary.grafana.container-id"}}|{{index .Config.Labels "sanctuary.grafana.generation"}}' \
        "$migration_container"
}

validate_migration_identity() {
    local identity="$1"
    local id state exit_code image role project data_volume control_volume token container_id generation
    IFS='|' read -r id state exit_code image role project data_volume control_volume token container_id generation <<< "$identity"
    [ "$image" = "$migration_image_id" ] && [ "$role" = "password-migration" ] \
        && [ "$project" = "$resolved_project" ] \
        && [ "$data_volume" = "$resolved_data_volume" ] \
        && [ "$control_volume" = "$resolved_control_volume" ] \
        && [ -n "$token" ] && [ -n "$container_id" ] && [ -n "$generation" ]
}

remove_terminal_migration_container() {
    local identity="$1"
    local id state exit_code image role project data_volume control_volume token container_id generation outcome_status
    IFS='|' read -r id state exit_code image role project data_volume control_volume token container_id generation <<< "$identity"
    validate_migration_identity "$identity" \
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

acquire_created_reclamation() {
    local id="$1" token="$2" container_id="$3" generation="$4"
    local expires_at now
    validate_lease "$token" "$container_id" "$generation" \
        || fail "the created migration container has no valid lease."
    if ! validate_abandonment "$token" "$id" "$container_id" "$generation"; then
        expires_at="$(lease_expiry "$token")" \
            || fail "the created migration container lease expiry is unavailable."
        case "$expires_at" in
            ''|*[!0-9]*) fail "the created migration container lease expiry is invalid." ;;
        esac
        now="$(daemon_epoch)"
        [ "$now" -ge "$expires_at" ] \
            || fail "a prior Grafana credential migration owner is still active."
    fi
    claim_reclamation "$token" "$id" "$container_id" "$generation" \
        || fail "the created migration container is already claimed by its entrypoint."
    write_abandonment "$token" "$id" "$container_id" "$generation"
    validate_abandonment "$token" "$id" "$container_id" "$generation" \
        || fail "the created migration abandonment record is invalid."
}

remove_reclaimed_migration() {
    local expected_id="$1" token="$2" container_id="$3" generation="$4"
    local identity id state exit_code image role project data_volume control_volume inspected_token inspected_container inspected_generation
    identity="$(inspect_migration_container)" \
        || fail "the reclaiming migration container identity is unavailable."
    assert_reclamation_identity "$identity" "$expected_id" "$token" "$container_id" "$generation" \
        || fail "the reclaiming migration container identity changed."
    IFS='|' read -r id state exit_code image role project data_volume control_volume inspected_token inspected_container inspected_generation <<< "$identity"
    case "$state" in
        created|exited)
            docker container rm "$id" >/dev/null \
                || recover_reclaimed_removal_failure "$expected_id" "$token" "$container_id" "$generation"
            ;;
        running) wait_and_remove_reclaimed_migration "$expected_id" "$token" "$container_id" "$generation" ;;
        *) fail "the reclaimed migration container entered an unsafe state." ;;
    esac
    cleanup_control_artifacts "$token"
    container_is_absent "$migration_container" \
        || fail "created migration container removal could not be verified."
}

remove_created_migration_container() {
    local identity="$1"
    local id state exit_code image role project data_volume control_volume token container_id generation
    IFS='|' read -r id state exit_code image role project data_volume control_volume token container_id generation <<< "$identity"
    validate_migration_identity "$identity" \
        || fail "the created migration container has an unexpected identity."
    [ "$state" = "created" ] || fail "the migration container is not safely reclaimable."
    acquire_created_reclamation "$id" "$token" "$container_id" "$generation"
    remove_reclaimed_migration "$id" "$token" "$container_id" "$generation"
}

reconcile_migration_container() {
    local identity state
    container_is_absent "$migration_container" && return 0
    identity="$(inspect_migration_container)" \
        || fail "migration container identity is unavailable."
    validate_migration_identity "$identity" \
        || fail "the reserved migration container has an unexpected identity."
    IFS='|' read -r _ state _ <<< "$identity"
    case "$state" in
        created) remove_created_migration_container "$identity" ;;
        exited) remove_terminal_migration_container "$identity" ;;
        *) fail "a prior Grafana credential migration is still active or indeterminate." ;;
    esac
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
    ownership_label_args collector_process exact_delete
    docker container create --pull never --name "$migration_container" \
        "${OWNERSHIP_LABEL_ARGS[@]}" \
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

assert_launched_migration() {
    local identity="$1" expected_id="$2" token="$3" grafana_container_id="$4" generation="$5"
    local inspected_id state exit_code image role project data_volume control_volume inspected_token inspected_container inspected_generation
    IFS='|' read -r inspected_id state exit_code image role project data_volume control_volume inspected_token inspected_container inspected_generation <<< "$identity"
    [ "$inspected_id" = "$expected_id" ] && [ "$state" = "created" ] \
        && [ "$image" = "$migration_image_id" ] && [ "$role" = "password-migration" ] \
        && [ "$project" = "$resolved_project" ] \
        && [ "$data_volume" = "$resolved_data_volume" ] \
        && [ "$control_volume" = "$resolved_control_volume" ] \
        && [ "$inspected_token" = "$token" ] \
        && [ "$inspected_container" = "$grafana_container_id" ] \
        && [ "$inspected_generation" = "$generation" ]
}

record_abandoned_start() {
    local id="$1" token="$2" grafana_container_id="$3" generation="$4"
    local identity confirmed_identity inspected_id state inspected_token inspected_container inspected_generation
    identity="$(inspect_migration_container)" \
        || fail "migration container start failed and state is unavailable."
    confirmed_identity="$(inspect_migration_container)" \
        || fail "migration container start failed and confirmation is unavailable."
    [ "$identity" = "$confirmed_identity" ] || return 0
    IFS='|' read -r inspected_id state _ _ _ _ _ _ inspected_token inspected_container inspected_generation <<< "$identity"
    [ "$inspected_id" = "$id" ] && [ "$state" = "created" ] \
        && [ "$inspected_token" = "$token" ] \
        && [ "$inspected_container" = "$grafana_container_id" ] \
        && [ "$inspected_generation" = "$generation" ] \
        && validate_migration_identity "$identity" \
        || return 0
    write_abandonment "$token" "$id" "$grafana_container_id" "$generation"
}

validate_migration_outcome() {
    local token="$1" exit_code="$2" grafana_container_id="$3" generation="$4"
    if [ "$exit_code" = "0" ]; then
        validate_outcome "$token" success "$grafana_container_id" "$generation" \
            || fail "Grafana credential migration did not publish a valid success outcome."
        return 0
    fi
    validate_outcome "$token" rolled-back "$grafana_container_id" "$generation" \
        || fail "Grafana credential migration failed without a valid rollback outcome."
    fail "Grafana credential migration failed with exit code $exit_code."
}

# `docker wait` returns as soon as the container's process ends, but the daemon
# finalises State.Status and State.ExitCode asynchronously. Podman's docker-compat
# layer -- what CI runs on -- updates its state database from conmon after wait has
# already returned, so an immediate inspect can still report a non-terminal status.
#
# Sampling once and refusing on the first disagreement turned that lag into a hard
# install failure ("migration container terminal state is inconsistent") and took
# down the release-blocking latest-stable/optional-profiles upgrade lane on
# v0.8.64-rc1 and rc2 -- in a different phase each run, the signature of a race.
#
# Poll for convergence instead. The invariant is unchanged: the state must still
# become exactly "exited" with an exit code matching `docker wait`. Only a lagging
# observation is tolerated, never a different outcome.
#
# Sound here and deliberately nowhere else in this script: run_migration has already
# waited on this container, so a non-terminal read cannot mean "still running".
# reconcile_migration_container and remove_terminal_migration_container inspect
# containers they never waited on, where a non-terminal state is a real signal and
# must keep failing closed.
migration_terminal_settle_attempts="${SANCTUARY_GRAFANA_TERMINAL_SETTLE_ATTEMPTS:-20}"
migration_terminal_settle_delay="${SANCTUARY_GRAFANA_TERMINAL_SETTLE_DELAY:-1}"

# Set by await_terminal_migration_identity so a refusal can name what it saw.
# Diagnosing the original failure needed a full reproduction purely because the
# message carried no values.
last_observed_migration_state=""
last_observed_migration_exit_code=""

await_terminal_migration_identity() {
    local wait_code="$1" attempt=1 identity state exit_code
    while :; do
        identity="$(inspect_migration_container)" || return 2
        IFS='|' read -r _ state exit_code _ <<< "$identity"
        last_observed_migration_state="$state"
        last_observed_migration_exit_code="$exit_code"
        if [ "$state" = "exited" ] && [ "$exit_code" = "$wait_code" ]; then
            printf '%s\n' "$identity"
            return 0
        fi
        [ "$attempt" -lt "$migration_terminal_settle_attempts" ] || return 1
        attempt=$((attempt + 1))
        sleep "$migration_terminal_settle_delay"
    done
}

run_migration() {
    local token="$1" grafana_container_id="$2" generation="$3"
    local id identity state exit_code wait_code settle_status
    id="$(create_migration_container "$token" "$grafana_container_id" "$generation")" \
        || fail "migration container launch failed; reserved state requires reconciliation."
    identity="$(inspect_migration_container)" \
        || fail "launched migration container identity is unavailable."
    assert_launched_migration "$identity" "$id" "$token" "$grafana_container_id" "$generation" \
        || fail "launched migration container identity does not match its lease."
    if [ "$ownership_registration_enabled" = true ]; then
        register_owned_resource collector_process active exact_delete name "$migration_container" "$id" "$SANCTUARY_OPERATION_RUN_ID"
    fi
    if ! docker container start "$id" >/dev/null; then
        record_abandoned_start "$id" "$token" "$grafana_container_id" "$generation"
        fail "migration container start failed; reserved state requires reconciliation."
    fi
    wait_code="$(docker wait "$id")" \
        || fail "migration container completion is unavailable."
    settle_status=0
    identity="$(await_terminal_migration_identity "$wait_code")" || settle_status=$?
    [ "$settle_status" != "2" ] \
        || fail "completed migration container identity is unavailable."
    [ "$settle_status" = "0" ] \
        || fail "migration container terminal state is inconsistent (state=$last_observed_migration_state exit_code=$last_observed_migration_exit_code wait_code=$wait_code)."
    IFS='|' read -r _ state exit_code _ <<< "$identity"
    validate_migration_outcome "$token" "$exit_code" "$grafana_container_id" "$generation"
    docker container rm "$id" >/dev/null \
        || fail "completed migration container could not be removed."
    cleanup_control_artifacts "$token"
    container_is_absent "$migration_container" \
        || fail "completed migration container removal could not be verified."
}

run_locked_workflow() {
    local container_id identity inspected_id generation inspected_project token expires_at
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
    expires_at="$(( $(daemon_epoch) + 300 ))"
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
