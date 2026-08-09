#!/bin/bash

set -euo pipefail

lock_owner=false
if [ "${1:-}" = "--lock-owner" ]; then
    lock_owner=true
    shift
fi

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 PROJECT_DIR COMPOSE_ARGS..." >&2
    exit 2
fi

project_dir="$1"
shift
compose_args=("$@")
export SANCTUARY_PROJECT_DIR="$project_dir"
lease_root="${SANCTUARY_GRAFANA_QUIESCENCE_DIR:-${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}/grafana-quiescence}"
canonical_lock_root="/tmp/sanctuary-grafana-quiescence-locks"
outcome_root="$canonical_lock_root/outcomes"
lock_file=""
lease_file=""
claim_dir=""
resolved_project="${SANCTUARY_GRAFANA_RESOLVED_PROJECT:-}"
resolved_volume="${SANCTUARY_GRAFANA_RESOLVED_VOLUME:-}"
migration_container=""

cleanup_quiescence() {
    status=$?
    trap - EXIT HUP INT TERM
    [ -z "$claim_dir" ] || rmdir "$claim_dir" 2>/dev/null || true
    [ -z "$lease_file" ] || rm -f "$lease_file"
    rm -f "$lease_root/owner"
    exit "$status"
}

container_listing() {
    docker container ls -a --filter "name=^/${migration_container}$" --format '{{.ID}}'
}

container_is_absent() {
    local listed
    if docker container inspect "$migration_container" >/dev/null 2>&1; then
        return 1
    fi
    listed="$(container_listing)" || fail "migration container status is unavailable."
    [ -z "$listed" ]
}

inspect_migration_container() {
    docker container inspect --format \
        '{{.Id}}|{{.State.Status}}|{{.State.ExitCode}}|{{index .Config.Labels "sanctuary.grafana.project"}}|{{index .Config.Labels "sanctuary.grafana.volume"}}|{{index .Config.Labels "sanctuary.grafana.token"}}' \
        "$migration_container"
}

remove_terminal_migration_container() {
    local identity="$1"
    local container_id state exit_code label_project label_volume label_token outcome=""
    IFS='|' read -r container_id state exit_code label_project label_volume label_token <<< "$identity"
    [ "$label_project" = "$resolved_project" ] && [ "$label_volume" = "$resolved_volume" ] \
        || fail "the reserved migration container has an unexpected identity."
    [ "$state" = "exited" ] || fail "a prior Grafana credential migration is still active or indeterminate."
    if [ -n "$label_token" ] && [ -f "$outcome_root/outcome-$label_token" ]; then
        outcome="$(sed -n '1p' "$outcome_root/outcome-$label_token")"
    fi
    [ "$exit_code" = "0" ] || [ "$outcome" = "rolled-back" ] || [ "$outcome" = "success" ] \
        || fail "a prior Grafana credential migration did not prove rollback."
    docker container rm "$container_id" >/dev/null \
        || fail "the terminal migration container could not be removed."
    [ -z "$label_token" ] || rm -f "$outcome_root/outcome-$label_token"
    container_is_absent || fail "migration container removal could not be verified."
}

reconcile_migration_container() {
    local identity
    if container_is_absent; then
        return 0
    fi
    identity="$(inspect_migration_container)" \
        || fail "migration container identity is unavailable."
    remove_terminal_migration_container "$identity"
}

fail() {
    echo "Grafana credential migration refused: $1" >&2
    return 1
}

compose_output() {
    docker compose "${compose_args[@]}" "$@"
}

resolve_project_name() {
    local rendered="$1"
    printf '%s\n' "$rendered" \
        | sed -n 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)"[,]*[[:space:]]*$/\1/p' \
        | head -n 1
}

resolve_grafana_volume_name() {
    local rendered="$1"
    printf '%s\n' "$rendered" | awk '
      /^  "volumes": \{/ { in_volumes = 1; next }
      in_volumes && /^    "grafana_data": \{/ { in_grafana = 1; next }
      in_grafana && /"name"[[:space:]]*:/ {
        line = $0
        sub(/^[^:]*:[[:space:]]*"/, "", line)
        sub(/"[,]?[[:space:]]*$/, "", line)
        print line
        exit
      }
    '
}

resolve_compose_identity() {
    local rendered
    rendered="$(compose_output config --format json)" || fail "Compose project inspection failed."
    resolved_project="$(resolve_project_name "$rendered")"
    resolved_volume="$(resolve_grafana_volume_name "$rendered")"
    [ -n "$resolved_project" ] && [ -n "$resolved_volume" ] \
        || fail "Compose Grafana project or volume identity is unavailable."
    case "$resolved_project:$resolved_volume" in
        *[!A-Za-z0-9_.:-]*) fail "Compose Grafana resource identity is invalid." ;;
    esac
}

inspect_generation() {
    local container_id="$1"
    docker inspect --format '{{.Id}}|{{.Created}}|{{index .Config.Labels "com.docker.compose.project"}}' "$container_id"
}

assert_stopped_identity() {
    local expected_id="$1"
    local current_id running
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

write_lease() {
    local token="$1" project="$2" container_id="$3" generation="$4" expires_at="$5"
    local owner_pid="$6" owner_start_time="$7"
    lease_file="$lease_root/lease-$token"
    claim_dir="$lease_root/claims/$token"
    umask 077
    {
        printf 'version=1\n'
        printf 'token=%s\n' "$token"
        printf 'project=%s\n' "$project"
        printf 'container_id=%s\n' "$container_id"
        printf 'generation=%s\n' "$generation"
        printf 'owner_pid=%s\n' "$owner_pid"
        printf 'owner_start_time=%s\n' "$owner_start_time"
        printf 'expires_at=%s\n' "$expires_at"
    } > "$lease_file"
    chmod 644 "$lease_file"
}

run_migration() {
    local token="$1" project="$2" container_id="$3" generation="$4"
    local owner_pid="$5" owner_start_time="$6"
    local run_args=(run -d --no-deps --name "$migration_container")
    local identity state exit_code wait_code
    local inspected_id inspected_project inspected_volume inspected_token
    export SANCTUARY_GRAFANA_QUIESCENCE_DIR="$lease_root"
    export SANCTUARY_GRAFANA_QUIESCENCE_TOKEN="$token"
    export SANCTUARY_GRAFANA_QUIESCENCE_PROJECT="$project"
    export SANCTUARY_GRAFANA_QUIESCENCE_CONTAINER_ID="$container_id"
    export SANCTUARY_GRAFANA_QUIESCENCE_GENERATION="$generation"
    export SANCTUARY_GRAFANA_QUIESCENCE_OWNER_PID="$owner_pid"
    export SANCTUARY_GRAFANA_QUIESCENCE_OWNER_START_TIME="$owner_start_time"
    export SANCTUARY_GRAFANA_QUIESCENCE_OWNER_PROC="/proc/$owner_pid"
    run_args+=(--label "sanctuary.grafana.project=$project")
    run_args+=(--label "sanctuary.grafana.volume=$resolved_volume")
    run_args+=(--label "sanctuary.grafana.token=$token")
    if [ "${SANCTUARY_INSTALL_MODE:-}" = "offline" ] \
        || [ "${SANCTUARY_OFFLINE_MODE:-false}" = "true" ] \
        || [ "${SANCTUARY_GRAFANA_OFFLINE:-false}" = "true" ]; then
        run_args+=(--pull never)
    fi
    container_id="$(compose_output "${run_args[@]}" grafana-password-migration)" \
        || fail "migration container launch failed; reserved state requires reconciliation."
    identity="$(inspect_migration_container)" \
        || fail "launched migration container identity is unavailable."
    IFS='|' read -r inspected_id state exit_code inspected_project inspected_volume inspected_token <<< "$identity"
    [ "$inspected_id" = "$container_id" ] \
        && [ "$inspected_project" = "$project" ] \
        && [ "$inspected_volume" = "$resolved_volume" ] \
        && [ "$inspected_token" = "$token" ] \
        || fail "launched migration container identity does not match its lease."
    wait_code="$(docker wait "$container_id")" \
        || fail "migration container completion is unavailable."
    identity="$(inspect_migration_container)" \
        || fail "completed migration container identity is unavailable."
    IFS='|' read -r inspected_id state exit_code inspected_project inspected_volume inspected_token <<< "$identity"
    [ "$state" = "exited" ] && [ "$exit_code" = "$wait_code" ] \
        || fail "migration container terminal state is inconsistent."
    [ "$exit_code" = "0" ] || fail "Grafana credential migration failed with exit code $exit_code."
    docker container rm "$container_id" >/dev/null \
        || fail "completed migration container could not be removed."
    rm -f "$outcome_root/outcome-$token"
    container_is_absent || fail "completed migration container removal could not be verified."
}

read_process_start_time() {
    sed 's/.*) //' "/proc/$1/stat" | awk '{print $20}'
}

acquire_kernel_lock() {
    local status
    resolve_compose_identity
    [ ! -L "$canonical_lock_root" ] || fail "canonical quiescence lock path must not be a symlink."
    mkdir -p "$canonical_lock_root"
    chmod 1777 "$canonical_lock_root" 2>/dev/null || true
    [ ! -L "$outcome_root" ] || fail "canonical migration outcome path must not be a symlink."
    mkdir -p "$outcome_root"
    chmod 777 "$outcome_root" 2>/dev/null || true
    lock_file="$canonical_lock_root/$resolved_project--$resolved_volume.lock"
    [ ! -L "$lock_file" ] || fail "canonical quiescence lock file must not be a symlink."
    umask 000
    : >> "$lock_file"
    chmod 666 "$lock_file" 2>/dev/null || true
    export SANCTUARY_GRAFANA_RESOLVED_PROJECT="$resolved_project"
    export SANCTUARY_GRAFANA_RESOLVED_VOLUME="$resolved_volume"
    set +e
    # Descendants intentionally inherit the locked descriptor. If the wrapper
    # is killed while Compose is still supervising the migration, the kernel
    # exclusion remains held until that client exits.
    flock -E 75 -n "$lock_file" "$0" --lock-owner "$project_dir" "${compose_args[@]}"
    status=$?
    set -e
    if [ "$status" -eq 75 ]; then
        fail "another Grafana start or migration owns the quiescence lock."
    fi
    return "$status"
}

main() {
    local project container_id identity inspected_id generation inspected_project token expires_at
    local owner_pid owner_start_time
    mkdir -p "$lease_root/claims"
    chmod 755 "$lease_root" 2>/dev/null || true
    chmod 777 "$lease_root/claims" 2>/dev/null || true
    trap cleanup_quiescence EXIT
    trap 'exit 1' HUP INT TERM
    owner_pid="$$"
    owner_start_time="$(read_process_start_time "$owner_pid")"
    [ -n "$owner_start_time" ] || fail "quiescence owner liveness is unavailable."
    token="$(openssl rand -hex 32)"
    printf 'pid=%s\nstart_time=%s\ntoken=%s\n' \
        "$owner_pid" "$owner_start_time" "$token" > "$lease_root/owner"
    chmod 644 "$lease_root/owner"

    project="$resolved_project"
    [ -n "$project" ] && [ -n "$resolved_volume" ] \
        || fail "resolved Compose identity was not carried into the lock owner."
    migration_container="${project}-sanctuary-grafana-password-migration"
    reconcile_migration_container
    container_id="$(compose_output ps -aq grafana)" \
        || fail "Grafana container identity inspection failed."
    generation="absent"
    if [ -n "$container_id" ]; then
        identity="$(inspect_generation "$container_id")" \
            || fail "Grafana container generation inspection failed."
        IFS='|' read -r inspected_id generation inspected_project <<< "$identity"
        [ "$inspected_id" = "$container_id" ] && [ "$inspected_project" = "$project" ] \
            || fail "Grafana container identity does not belong to this Compose project."
    else
        container_id="absent"
    fi

    compose_output stop grafana || fail "Grafana stop failed."
    assert_stopped_identity "$([ "$container_id" = "absent" ] && printf '' || printf '%s' "$container_id")"

    expires_at="$(( $(date +%s) + 300 ))"
    write_lease "$token" "$project" "$container_id" "$generation" "$expires_at" \
        "$owner_pid" "$owner_start_time"
    run_migration "$token" "$project" "$container_id" "$generation" \
        "$owner_pid" "$owner_start_time"
}

if [ "$lock_owner" = "true" ]; then
    main "$@"
else
    acquire_kernel_lock
fi
