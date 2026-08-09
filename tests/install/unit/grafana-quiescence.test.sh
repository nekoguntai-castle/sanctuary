#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HELPER="$PROJECT_ROOT/scripts/ops/run-grafana-password-migration.sh"
TEST_ROOT="$(mktemp -d)"
TEST_PROJECT="grafana-quiescence-test-$$"
TEST_DATA_VOLUME="${TEST_PROJECT}_grafana_data"
TEST_CONTROL_VOLUME="${TEST_PROJECT}_grafana_quiescence"
MIGRATION_NAME="${TEST_PROJECT}-sanctuary-grafana-password-migration"
CONTROL_NAME="${TEST_PROJECT}-sanctuary-grafana-control-helper"
SCRIPT_DIGEST="$(sha256sum "$PROJECT_ROOT/scripts/ops/migrate-grafana-password.sh" | awk '{print $1}')"

cleanup() {
    find "$TEST_ROOT" -type f -delete
    find "$TEST_ROOT" -type l -delete
    find "$TEST_ROOT" -depth -type d -empty -delete
}
trap cleanup EXIT

make_fake_docker() {
    local bin_dir="$1"
    mkdir -p "$bin_dir"
    cat > "$bin_dir/docker" <<'SCRIPT'
#!/bin/bash
set -eu
log="${FAKE_DOCKER_LOG:?}"
migration_state="${FAKE_MIGRATION_STATE:?}"
helper_state="${FAKE_HELPER_STATE:?}"
data_volume_state="${FAKE_DATA_VOLUME_STATE:?}"
control="${FAKE_CONTROL_DIR:?}"
grafana_data="${FAKE_GRAFANA_DATA_DIR:?}"
event_log="${FAKE_EVENT_LOG:?}"
started_signal="${FAKE_MIGRATION_STARTED_SIGNAL:?}"
release_signal="${FAKE_MIGRATION_RELEASE_SIGNAL:?}"
printf '%s\n' "$*" >> "$log"
mkdir -p "$control/leases" "$control/claims" "$control/outcomes"
mkdir -p "$grafana_data"

read_migration() {
    IFS='|' read -r state exit_code token container generation < "$migration_state"
}

write_outcome() {
    local status="$1"
    cat > "$control/outcomes/outcome-$token" <<EOF
version=1
status=$status
token=$token
project=${FAKE_PROJECT_NAME:?}
data_volume=${FAKE_DATA_VOLUME:?}
control_volume=${FAKE_CONTROL_VOLUME:?}
container_id=$container
generation=$generation
EOF
}

env_arg() {
    local wanted="$1" previous="" argument
    for argument in "$@"; do
        if [ "$previous" = "-e" ]; then
            case "$argument" in
                "$wanted="*) printf '%s\n' "${argument#*=}"; return ;;
            esac
        fi
        previous="$argument"
    done
}

if [ "${1:-}" = image ] && [ "${2:-}" = inspect ]; then
    printf 'sha256:migration-image|%s\n' "${FAKE_SCRIPT_DIGEST:?}"
    exit 0
fi

if [ "${1:-}" = volume ] && [ "${2:-}" = inspect ]; then
    volume="${@: -1}"
    if [ "$volume" = "${FAKE_DATA_VOLUME:?}" ] \
        && [ "${FAKE_DOCKER_MODE:-success}" = fresh-volume ] \
        && [ ! -f "$data_volume_state" ]; then
        exit 1
    fi
    logical=grafana_data
    [ "$volume" != "${FAKE_CONTROL_VOLUME:?}" ] || logical=grafana_quiescence
    printf '%s|%s|%s\n' "$volume" "${FAKE_PROJECT_NAME:?}" "$logical"
    exit 0
fi

if [ "${1:-}" = inspect ]; then
    if [[ "$*" == *'{{.State.Running}}'* ]]; then
        printf 'false\n'
    else
        printf 'grafana-id|2026-08-09T00:00:00Z|%s\n' "${FAKE_PROJECT_NAME:?}"
    fi
    exit 0
fi

if [ "${1:-}" = container ] && [ "${2:-}" = inspect ]; then
    name="${@: -1}"
    if [ "$name" = "${FAKE_CONTROL_NAME:?}" ]; then
        [ -f "$helper_state" ] || exit 1
        IFS='|' read -r action state exit_code _token _container _generation < "$helper_state"
        if [[ "$*" == *'--format'* ]]; then
            printf 'helper-id|%s|%s|sha256:migration-image|control-helper|%s|%s|%s\n' \
                "$state" "$exit_code" "${FAKE_PROJECT_NAME:?}" \
                "${FAKE_DATA_VOLUME:?}" "${FAKE_CONTROL_VOLUME:?}"
        else
            printf '{}\n'
        fi
        exit 0
    fi
    if [ "$name" = "${FAKE_MIGRATION_NAME:?}" ]; then
        [ -f "$migration_state" ] || exit 1
        read_migration
        if [[ "$*" == *'--format'* ]]; then
            printf 'migration-id|%s|%s|sha256:migration-image|%s|%s|%s|%s|%s|%s\n' \
                "$state" "$exit_code" "${FAKE_PROJECT_NAME:?}" \
                "${FAKE_DATA_VOLUME:?}" "${FAKE_CONTROL_VOLUME:?}" \
                "$token" "$container" "$generation"
        else
            printf '{}\n'
        fi
        exit 0
    fi
    exit 1
fi

case "$*" in
    'volume create '*'com.docker.compose.volume=grafana_data'*)
        : > "$data_volume_state"
        printf '%s\n' "${FAKE_DATA_VOLUME:?}"
        ;;
    *'config --format json')
        printf '{\n  "name": "%s",\n  "services": {},\n  "volumes": {\n    "grafana_data": {\n      "name": "%s"\n    },\n    "grafana_quiescence": {\n      "name": "%s"\n    }\n  }\n}\n' \
            "${FAKE_PROJECT_NAME:?}" "${FAKE_DATA_VOLUME:?}" "${FAKE_CONTROL_VOLUME:?}"
        ;;
    *'config --images') printf 'sanctuary-grafana-migration:local\n' ;;
    'container ls -a '*'--format {{.ID}}')
        case "$*" in
            *"${FAKE_CONTROL_NAME:?}"*) [ ! -f "$helper_state" ] || printf 'helper-id\n' ;;
            *"${FAKE_MIGRATION_NAME:?}"*) [ ! -f "$migration_state" ] || printf 'migration-id\n' ;;
        esac
        ;;
    'container create '*'sanctuary.grafana.role=control-helper'*)
        token="$(env_arg TOKEN "$@")"
        container="$(env_arg CONTAINER_ID "$@")"
        generation="$(env_arg GENERATION "$@")"
        command="${@: -1}"
        action=bootstrap
        [[ "$command" != *'/control/leases/lease-'* ]] || action=lease
        [[ "$command" != cat* ]] || action=read
        [[ "$command" != rm\ -f* ]] || action=cleanup
        printf '%s|created|0|%s|%s|%s\n' "$action" "$token" "$container" "$generation" > "$helper_state"
        printf 'helper-id\n'
        ;;
    'container create '*'sanctuary.grafana.role=password-migration'*)
        [ "${FAKE_DOCKER_MODE:-success}" != create-failure ] || exit 12
        token="$(env_arg SANCTUARY_GRAFANA_QUIESCENCE_TOKEN "$@")"
        container="$(env_arg SANCTUARY_GRAFANA_QUIESCENCE_CONTAINER_ID "$@")"
        generation="$(env_arg SANCTUARY_GRAFANA_QUIESCENCE_GENERATION "$@")"
        printf 'created|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
        printf 'migration-id\n'
        ;;
    'container start -a helper-id')
        IFS='|' read -r action _state _exit token container generation < "$helper_state"
        if [ "${FAKE_DOCKER_MODE:-success}" = helper-failure ]; then
            sed -i 's/|created|0|/|exited|13|/' "$helper_state"
            exit 13
        fi
        case "$action" in
            lease)
                cat > "$control/leases/lease-$token" <<EOF
version=2
token=$token
project=${FAKE_PROJECT_NAME:?}
data_volume=${FAKE_DATA_VOLUME:?}
control_volume=${FAKE_CONTROL_VOLUME:?}
container_id=$container
generation=$generation
expires_at=$(( $(date +%s) + 300 ))
EOF
                ;;
            read) cat "$control/outcomes/outcome-$token" ;;
            cleanup)
                rm -f "$control/leases/lease-$token" "$control/outcomes/outcome-$token"
                rmdir "$control/claims/$token" 2>/dev/null || true
                ;;
        esac
        sed -i 's/|created|/|exited|/' "$helper_state"
        ;;
    'container start migration-id')
        read_migration
        if [ "${FAKE_DOCKER_MODE:-success}" = concurrent-hold ]; then
            printf 'running|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            : > "$started_signal"
            while [ ! -f "$release_signal" ]; do sleep 0.01; done
            write_outcome success
            printf 'exited|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            printf 'migration-id\n'
            exit 0
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = disconnect-fresh-terminal ]; then
            : > "$grafana_data/.sanctuary-independent-password-v1"
            printf 'marker\n' >> "$event_log"
            write_outcome success
            printf 'outcome\n' >> "$event_log"
            printf 'exited|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            exit 10
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = disconnect-marked-terminal ]; then
            [ -f "$grafana_data/.sanctuary-independent-password-v1" ] || exit 14
            printf 'marker-observed\n' >> "$event_log"
            write_outcome success
            printf 'outcome\n' >> "$event_log"
            printf 'exited|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            exit 10
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = client-disconnect ]; then
            printf 'running|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            exit 10
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = migration-failure ] \
            || [ "${FAKE_DOCKER_MODE:-success}" = pre-snapshot-failure ]; then
            write_outcome rolled-back
            printf 'exited|1|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
        else
            write_outcome success
            printf 'exited|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
        fi
        printf 'migration-id\n'
        ;;
    'wait migration-id') read_migration; printf '%s\n' "$exit_code" ;;
    'container rm helper-id') rm -f "$helper_state"; printf 'helper-id\n' ;;
    'container rm migration-id') rm -f "$migration_state"; printf 'migration-id\n' ;;
    *'ps -aq grafana') printf 'grafana-id\n' ;;
    *'stop grafana') [ "${FAKE_DOCKER_MODE:-success}" != stop-failure ] || exit 7 ;;
    *'ps -q --status running grafana')
        [ "${FAKE_DOCKER_MODE:-success}" != status-failure ] || exit 8
        [ "${FAKE_DOCKER_MODE:-success}" != still-running ] || printf 'grafana-id\n'
        ;;
    *) echo "unexpected docker call: $*" >&2; exit 9 ;;
esac
SCRIPT
    chmod +x "$bin_dir/docker"
}

reset_case() {
    find "$TEST_ROOT/control" -type f -delete 2>/dev/null || true
    find "$TEST_ROOT/control" -depth -type d -empty -delete 2>/dev/null || true
    rm -f "$TEST_ROOT/migration.state" "$TEST_ROOT/helper.state" "$TEST_ROOT/data-volume.state" \
        "$TEST_ROOT/migration-started" "$TEST_ROOT/migration-release" "$TEST_ROOT/events.log"
    find "$TEST_ROOT/grafana-data" -type f -delete 2>/dev/null || true
    mkdir -p "$TEST_ROOT/control" "$TEST_ROOT/grafana-data"
    : > "$TEST_ROOT/docker.log"
}

run_helper() {
    local mode="$1" path_value="${2:-$TEST_ROOT/bin:$PATH}" project_dir="${3:-$PROJECT_ROOT}"
    FAKE_DOCKER_MODE="$mode" FAKE_DOCKER_LOG="$TEST_ROOT/docker.log" \
        FAKE_MIGRATION_STATE="$TEST_ROOT/migration.state" \
        FAKE_HELPER_STATE="$TEST_ROOT/helper.state" FAKE_CONTROL_DIR="$TEST_ROOT/control" \
        FAKE_DATA_VOLUME_STATE="$TEST_ROOT/data-volume.state" \
        FAKE_GRAFANA_DATA_DIR="$TEST_ROOT/grafana-data" \
        FAKE_EVENT_LOG="$TEST_ROOT/events.log" \
        FAKE_MIGRATION_STARTED_SIGNAL="$TEST_ROOT/migration-started" \
        FAKE_MIGRATION_RELEASE_SIGNAL="$TEST_ROOT/migration-release" \
        FAKE_PROJECT_NAME="$TEST_PROJECT" FAKE_DATA_VOLUME="$TEST_DATA_VOLUME" \
        FAKE_CONTROL_VOLUME="$TEST_CONTROL_VOLUME" FAKE_MIGRATION_NAME="$MIGRATION_NAME" \
        FAKE_CONTROL_NAME="$CONTROL_NAME" FAKE_SCRIPT_DIGEST="$SCRIPT_DIGEST" \
        SANCTUARY_INSTALL_MODE="${SANCTUARY_INSTALL_MODE:-}" \
        GRAFANA_PASSWORD="test-grafana-password" \
        PATH="$path_value" /bin/bash "$HELPER" "$project_dir" \
        --project-directory "$PROJECT_ROOT" -f "$PROJECT_ROOT/docker-compose.yml" \
        -f "$PROJECT_ROOT/docker/compose/monitoring.yml"
}

test_success_uses_daemon_control_volume() {
    reset_case
    run_helper success >/dev/null
    grep -Fq -- '--pull never --name' "$TEST_ROOT/docker.log"
    grep -Fq "src=$TEST_CONTROL_VOLUME,dst=/control" "$TEST_ROOT/docker.log"
    grep -Fq "src=$TEST_DATA_VOLUME,dst=/var/lib/grafana" "$TEST_ROOT/docker.log"
    grep -Fq "volume inspect $TEST_DATA_VOLUME" "$TEST_ROOT/docker.log"
    grep -Fq "volume inspect $TEST_CONTROL_VOLUME" "$TEST_ROOT/docker.log"
    ! grep -Fq '/proc/' "$TEST_ROOT/docker.log"
    ! grep -Fq "$PROJECT_ROOT/scripts/ops/migrate-grafana-password.sh" "$TEST_ROOT/docker.log"
    test ! -f "$TEST_ROOT/migration.state"
    test -z "$(find "$TEST_ROOT/control" -type f -print -quit)"
}

test_precondition_refusals_happen_before_migration() {
    local mode
    for mode in stop-failure still-running status-failure; do
        reset_case
        if run_helper "$mode" >/dev/null 2>&1; then
            echo "$mode unexpectedly allowed migration" >&2
            exit 1
        fi
        ! grep -Fq 'sanctuary.grafana.role=password-migration' "$TEST_ROOT/docker.log"
    done
}

test_no_flock_path_succeeds() {
    reset_case
    local restricted="$TEST_ROOT/no-flock-bin"
    mkdir -p "$restricted"
    ln -s "$TEST_ROOT/bin/docker" "$restricted/docker"
    local tool resolved
    for tool in sed head awk grep openssl mkdir chmod date cat rm rmdir find sleep; do
        resolved="$(command -v "$tool")"
        ln -s "$resolved" "$restricted/$tool"
    done
    run_helper success "$restricted" >/dev/null
    grep -Fq 'sanctuary.grafana.role=password-migration' "$TEST_ROOT/docker.log"
}

no_flock_path() {
    local restricted="$TEST_ROOT/no-flock-bin"
    mkdir -p "$restricted"
    ln -sf "$TEST_ROOT/bin/docker" "$restricted/docker"
    local tool resolved
    for tool in sed head awk grep openssl mkdir chmod date cat rm rmdir find sleep; do
        resolved="$(command -v "$tool")"
        ln -sf "$resolved" "$restricted/$tool"
    done
    printf '%s\n' "$restricted"
}

test_fresh_data_volume_is_created_with_compose_identity() {
    reset_case
    run_helper fresh-volume >/dev/null
    grep -Fq "volume create --label com.docker.compose.project=$TEST_PROJECT --label com.docker.compose.volume=grafana_data $TEST_DATA_VOLUME" \
        "$TEST_ROOT/docker.log"
}

test_flock_refusal_precedes_docker_mutation() {
    reset_case
    local bin="$TEST_ROOT/refusing-flock-bin"
    mkdir -p "$bin"
    ln -s "$TEST_ROOT/bin/docker" "$bin/docker"
    cat > "$bin/flock" <<'SCRIPT'
#!/bin/sh
exit 1
SCRIPT
    chmod +x "$bin/flock"
    if run_helper success "$bin:$PATH" >/dev/null 2>&1; then
        echo "unavailable flock unexpectedly allowed migration" >&2
        exit 1
    fi
    ! grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"
}

test_control_helper_failure_precedes_grafana_stop() {
    reset_case
    if run_helper helper-failure >/dev/null 2>&1; then
        echo "failed control helper unexpectedly allowed migration" >&2
        exit 1
    fi
    ! grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"
    ! grep -Fq 'sanctuary.grafana.role=password-migration' "$TEST_ROOT/docker.log"
}

test_rolled_back_terminal_reconciles_before_retry() {
    reset_case
    if run_helper migration-failure >/dev/null 2>&1; then
        echo "failed migration unexpectedly succeeded" >&2
        exit 1
    fi
    grep -Fqx 'status=rolled-back' "$TEST_ROOT/control/outcomes/"outcome-*
    : > "$TEST_ROOT/docker.log"
    run_helper success >/dev/null
    grep -Fq 'container rm migration-id' "$TEST_ROOT/docker.log"
}

test_post_claim_pre_snapshot_failure_reconciles_without_data_mutation() {
    reset_case
    local originals="$TEST_ROOT/pre-snapshot-originals"
    mkdir -p "$originals"
    local suffix
    for suffix in '' '-journal' '-wal' '-shm'; do
        printf 'preserved-%s\n' "${suffix:-database}" \
            > "$TEST_ROOT/grafana-data/grafana.db$suffix"
        cp "$TEST_ROOT/grafana-data/grafana.db$suffix" "$originals/grafana.db$suffix"
    done

    if run_helper pre-snapshot-failure >/dev/null 2>&1; then
        echo "post-claim pre-snapshot failure unexpectedly succeeded" >&2
        exit 1
    fi
    for suffix in '' '-journal' '-wal' '-shm'; do
        cmp "$originals/grafana.db$suffix" "$TEST_ROOT/grafana-data/grafana.db$suffix"
    done
    test ! -f "$TEST_ROOT/grafana-data/.sanctuary-independent-password-v1"
    grep -Fqx 'status=rolled-back' "$TEST_ROOT/control/outcomes/"outcome-*

    : > "$TEST_ROOT/docker.log"
    run_helper success >/dev/null
    grep -Fq 'container rm migration-id' "$TEST_ROOT/docker.log"
}

test_concurrent_no_flock_wrapper_is_refused_by_running_sentinel() {
    reset_case
    local restricted owner_pid second_status=0
    restricted="$(no_flock_path)"
    run_helper concurrent-hold "$restricted" >"$TEST_ROOT/owner.out" 2>&1 &
    owner_pid=$!
    for _attempt in {1..200}; do
        [ -f "$TEST_ROOT/migration-started" ] && break
        sleep 0.01
    done
    [ -f "$TEST_ROOT/migration-started" ] || {
        touch "$TEST_ROOT/migration-release"
        wait "$owner_pid" || true
        echo "first no-flock wrapper never reached its daemon sentinel" >&2
        return 1
    }

    run_helper concurrent-hold "$restricted" >"$TEST_ROOT/contender.out" 2>&1 \
        && second_status=0 || second_status=$?
    [ "$second_status" -ne 0 ] || {
        touch "$TEST_ROOT/migration-release"
        wait "$owner_pid" || true
        echo "concurrent no-flock wrapper unexpectedly overlapped migration" >&2
        return 1
    }
    [ "$(grep -Fc 'stop grafana' "$TEST_ROOT/docker.log")" -eq 1 ]
    grep -Fq 'still active or indeterminate' "$TEST_ROOT/contender.out"

    touch "$TEST_ROOT/migration-release"
    wait "$owner_pid"
}

test_terminal_disconnect_reconciles_fresh_and_marked_paths() {
    local mode expected_event
    for mode in disconnect-fresh-terminal disconnect-marked-terminal; do
        reset_case
        expected_event=marker
        if [ "$mode" = disconnect-marked-terminal ]; then
            : > "$TEST_ROOT/grafana-data/.sanctuary-independent-password-v1"
            expected_event=marker-observed
        fi
        if run_helper "$mode" >/dev/null 2>&1; then
            echo "$mode unexpectedly retained its Compose client" >&2
            exit 1
        fi
        test -f "$TEST_ROOT/grafana-data/.sanctuary-independent-password-v1"
        printf '%s\noutcome\n' "$expected_event" | cmp - "$TEST_ROOT/events.log"
        grep -Fqx 'status=success' "$TEST_ROOT/control/outcomes/"outcome-*

        : > "$TEST_ROOT/docker.log"
        run_helper success >/dev/null
        grep -Fq 'container rm migration-id' "$TEST_ROOT/docker.log"
    done
}

test_remote_daemon_never_receives_client_checkout_path() {
    reset_case
    local absent_client_path="$TEST_ROOT/client-checkout-absent-on-daemon"
    local restricted
    restricted="$(no_flock_path)"
    test ! -e "$absent_client_path"
    run_helper success "$restricted" "$absent_client_path" >/dev/null
    if grep -F 'container create' "$TEST_ROOT/docker.log" | grep -Fq "$absent_client_path"; then
        echo "daemon-side container creation received the client checkout path" >&2
        exit 1
    fi
    ! grep -F 'container create' "$TEST_ROOT/docker.log" | grep -Eq 'type=bind|scripts/ops'
}

test_online_and_preloaded_offline_helpers_never_pull() {
    reset_case
    run_helper success >/dev/null
    grep -Fq 'image inspect' "$TEST_ROOT/docker.log"
    ! grep -Eq '^pull ' "$TEST_ROOT/docker.log"

    reset_case
    SANCTUARY_INSTALL_MODE=offline run_helper success >/dev/null
    grep -Fq 'image inspect' "$TEST_ROOT/docker.log"
    grep -Fq -- '--pull never' "$TEST_ROOT/docker.log"
    ! grep -Eq '^pull ' "$TEST_ROOT/docker.log"
}

test_client_disconnect_requires_scoped_terminal_outcome() {
    reset_case
    if run_helper client-disconnect >/dev/null 2>&1; then
        echo "client disconnect unexpectedly succeeded" >&2
        exit 1
    fi
    IFS='|' read -r state _exit token container generation < "$TEST_ROOT/migration.state"
    test "$state" = running
    if run_helper success >/dev/null 2>&1; then
        echo "running daemon sentinel unexpectedly reconciled" >&2
        exit 1
    fi
    ! grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"

    cat > "$TEST_ROOT/control/outcomes/outcome-$token" <<EOF
version=1
status=success
token=$token
project=$TEST_PROJECT
data_volume=$TEST_DATA_VOLUME
control_volume=$TEST_CONTROL_VOLUME
container_id=$container
generation=$generation
EOF
    printf 'exited|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$TEST_ROOT/migration.state"
    : > "$TEST_ROOT/docker.log"
    run_helper success >/dev/null
    grep -Fq 'container rm migration-id' "$TEST_ROOT/docker.log"
}

make_fake_docker "$TEST_ROOT/bin"
test_success_uses_daemon_control_volume
test_precondition_refusals_happen_before_migration
test_no_flock_path_succeeds
test_fresh_data_volume_is_created_with_compose_identity
test_flock_refusal_precedes_docker_mutation
test_control_helper_failure_precedes_grafana_stop
test_rolled_back_terminal_reconciles_before_retry
test_post_claim_pre_snapshot_failure_reconciles_without_data_mutation
test_concurrent_no_flock_wrapper_is_refused_by_running_sentinel
test_client_disconnect_requires_scoped_terminal_outcome
test_terminal_disconnect_reconciles_fresh_and_marked_paths
test_remote_daemon_never_receives_client_checkout_path
test_online_and_preloaded_offline_helpers_never_pull

echo "Grafana quiescence tests passed"
