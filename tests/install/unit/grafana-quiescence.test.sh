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
MIGRATION_RUNTIME_ID="$(printf 'b%.0s' {1..64})"
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
volume_inspect_count="${FAKE_VOLUME_INSPECT_COUNT:?}"
control="${FAKE_CONTROL_DIR:?}"
grafana_data="${FAKE_GRAFANA_DATA_DIR:?}"
event_log="${FAKE_EVENT_LOG:?}"
started_signal="${FAKE_MIGRATION_STARTED_SIGNAL:?}"
release_signal="${FAKE_MIGRATION_RELEASE_SIGNAL:?}"
helper_created_signal="${FAKE_HELPER_CREATED_SIGNAL:?}"
helper_exited_signal="${FAKE_HELPER_EXITED_SIGNAL:?}"
helper_release_signal="${FAKE_HELPER_RELEASE_SIGNAL:?}"
printf '%s\n' "$*" >> "$log"
mkdir -p "$control/leases" "$control/claims" "$control/outcomes" "$control/abandonments"
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
        && { [ "${FAKE_DOCKER_MODE:-success}" = fresh-volume ] \
            || [ "${FAKE_DOCKER_MODE:-success}" = volume-create-response-lost ]; } \
        && [ ! -f "$data_volume_state" ]; then
        exit 1
    fi
    [ "${FAKE_DOCKER_MODE:-success}" != volume-inspect-error ] || exit 19
    if [ "${FAKE_DOCKER_MODE:-success}" = malformed-volume ]; then
        printf '[]\n'
        exit 0
    fi
    logical=grafana_data
    [ "$volume" != "${FAKE_CONTROL_VOLUME:?}" ] || logical=grafana_quiescence
    owner="$SANCTUARY_OWNER_ID"
    [ "${FAKE_DOCKER_MODE:-success}" != foreign-volume ] || owner=foreign-owner
    release="$SANCTUARY_RELEASE"
    if [ "${FAKE_DOCKER_MODE:-success}" = unstable-volume ]; then
        count=0
        [ ! -f "$volume_inspect_count" ] || count="$(cat "$volume_inspect_count")"
        count=$((count + 1))
        printf '%s\n' "$count" > "$volume_inspect_count"
        release="$release-$((count % 2))"
    fi
    jq -cn --arg name "$volume" --arg composeProject "${FAKE_PROJECT_NAME:?}" \
      --arg logical "$logical" --arg project "$SANCTUARY_PROJECT" \
      --arg deployment "$SANCTUARY_DEPLOYMENT_ID" --arg owner "$owner" \
      --arg run "$SANCTUARY_OPERATION_RUN_ID" --arg createdAt "$SANCTUARY_CLEANUP_CREATED_AT" \
      --arg release "$release" --arg commit "$SANCTUARY_COMMIT" \
      '[{Name:$name,Driver:"local",Scope:"local",Mountpoint:("/volumes/" + $name),CreatedAt:"2026-09-01T00:00:00Z",Options:null,Labels:{
        "com.docker.compose.project":$composeProject,
        "com.docker.compose.volume":$logical,
        "io.sanctuary.project":$project,
        "io.sanctuary.deployment-id":$deployment,
        "io.sanctuary.owner-id":$owner,
        "io.sanctuary.resource-class":"compose_volume",
        "io.sanctuary.lifecycle":"active",
        "io.sanctuary.cleanup-policy":"preserve_ambiguous",
        "io.sanctuary.created-at":$createdAt,
        "io.sanctuary.created-by-release":$release,
        "io.sanctuary.created-by-commit":$commit,
        "io.sanctuary.creation-run-id":$run}}]'
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

fake_helper_id() {
    printf 'a'
    printf '%s' "helper-$1" | openssl dgst -sha256 -r | awk '{print substr($1, 1, 63)}'
}

if [ "${1:-}" = container ] && [ "${2:-}" = inspect ]; then
    name="${@: -1}"
    if [[ "$name" == "${FAKE_PROJECT_NAME:?}-sanctuary-grafana-control-"* ]]; then
        nonce="${name##*-}"
        name="$(fake_helper_id "$nonce")"
    fi
    if [[ "$name" == helper-* ]] || [ -f "$helper_state.$name" ]; then
        helper_file="$helper_state.$name"
        [ -f "$helper_file" ] || exit 1
        IFS='|' read -r action state exit_code _token _container _generation operation created _migration_ref _created_input owner nonce < "$helper_file"
        if [ "${FAKE_DOCKER_MODE:-success}" = helper-terminal-state-lag ] && [ "$state" = running ]; then
            sed -i 's/|running|/|exited|/' "$helper_file"
        fi
        if [[ "$*" == *'--format'* ]]; then
            printf '%s|/%s|%s|%s|sha256:migration-image|%s|control-helper|%s|%s|%s|%s|%s|%s\n' \
                "$name" "${FAKE_PROJECT_NAME:?}-sanctuary-grafana-control-$nonce" \
                "$state" "$exit_code" "$created" "${FAKE_PROJECT_NAME:?}" \
                "${FAKE_DATA_VOLUME:?}" "${FAKE_CONTROL_VOLUME:?}" "$owner" "$operation" "$nonce"
        else
            jq -cn --arg id "$name" --arg name "/${FAKE_PROJECT_NAME:?}-sanctuary-grafana-control-$nonce" \
              --arg project "$SANCTUARY_PROJECT" --arg deployment "$SANCTUARY_DEPLOYMENT_ID" \
              --arg ownerId "$SANCTUARY_OWNER_ID" --arg run "$SANCTUARY_OPERATION_RUN_ID" \
              --arg createdAt "$SANCTUARY_CLEANUP_CREATED_AT" --arg release "$SANCTUARY_RELEASE" \
              --arg commit "$SANCTUARY_COMMIT" '[{Id:$id,Name:$name,State:{Status:"created",Running:false},Config:{Labels:{"io.sanctuary.project":$project,"io.sanctuary.deployment-id":$deployment,"io.sanctuary.owner-id":$ownerId,"io.sanctuary.resource-class":"compose_container","io.sanctuary.lifecycle":"obsolete","io.sanctuary.cleanup-policy":"exact_delete","io.sanctuary.created-at":$createdAt,"io.sanctuary.created-by-release":$release,"io.sanctuary.created-by-commit":$commit,"io.sanctuary.creation-run-id":$run}}}]'
        fi
        exit 0
    fi
    migration_runtime_id="${FAKE_MIGRATION_ID:?}"
    if [ "$name" = "${FAKE_MIGRATION_NAME:?}" ] || [ "$name" = "$migration_runtime_id" ]; then
        [ -f "$migration_state" ] || exit 1
        read_migration
        if [ "${FAKE_DOCKER_MODE:-success}" = terminal-state-lag ] && [ "$state" = stopping ]; then
            printf 'exited|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
        fi
        if [[ "$*" == *'--format'* ]]; then
            printf '%s|%s|%s|sha256:migration-image|password-migration|%s|%s|%s|%s|%s|%s\n' \
                "$migration_runtime_id" "$state" "$exit_code" "${FAKE_PROJECT_NAME:?}" \
                "${FAKE_DATA_VOLUME:?}" "${FAKE_CONTROL_VOLUME:?}" \
                "$token" "$container" "$generation"
        else
            jq -cn --arg id "$migration_runtime_id" --arg name "/${FAKE_MIGRATION_NAME:?}" \
              --arg project "$SANCTUARY_PROJECT" --arg deployment "$SANCTUARY_DEPLOYMENT_ID" \
              --arg ownerId "$SANCTUARY_OWNER_ID" --arg run "$SANCTUARY_OPERATION_RUN_ID" \
              --arg createdAt "$SANCTUARY_CLEANUP_CREATED_AT" --arg release "$SANCTUARY_RELEASE" \
              --arg commit "$SANCTUARY_COMMIT" '[{Id:$id,Name:$name,State:{Status:"created",Running:false},Config:{Labels:{"io.sanctuary.project":$project,"io.sanctuary.deployment-id":$deployment,"io.sanctuary.owner-id":$ownerId,"io.sanctuary.resource-class":"compose_container","io.sanctuary.lifecycle":"obsolete","io.sanctuary.cleanup-policy":"exact_delete","io.sanctuary.created-at":$createdAt,"io.sanctuary.created-by-release":$release,"io.sanctuary.created-by-commit":$commit,"io.sanctuary.creation-run-id":$run}}}]'
        fi
        exit 0
    fi
    exit 1
fi

case "$*" in
    'volume create '*'com.docker.compose.volume=grafana_data'*)
        : > "$data_volume_state"
        [ "${FAKE_DOCKER_MODE:-success}" != volume-inspect-error ] || exit 19
        [ "${FAKE_DOCKER_MODE:-success}" != volume-create-response-lost ] || exit 12
        printf '%s\n' "${FAKE_DATA_VOLUME:?}"
        ;;
    'volume create '*)
        [ "${FAKE_DOCKER_MODE:-success}" != volume-inspect-error ] || exit 19
        printf '%s\n' "${@: -1}"
        ;;
    *'config --format json')
        printf '{\n  "name": "%s",\n  "services": {},\n  "volumes": {\n    "grafana_data": {\n      "name": "%s"\n    },\n    "grafana_quiescence": {\n      "name": "%s"\n    }\n  }\n}\n' \
            "${FAKE_PROJECT_NAME:?}" "${FAKE_DATA_VOLUME:?}" "${FAKE_CONTROL_VOLUME:?}"
        ;;
    *'config --images') printf 'sanctuary-grafana-migration:local\n' ;;
    'container ls -a '*'--format {{.ID}}')
        case "$*" in
            *'--filter id='*)
                exact_id="$(printf '%s\n' "$*" | sed -n 's/.*--filter id=\([^ ]*\).*/\1/p')"
                case "${FAKE_DOCKER_MODE:-success}:$exact_id" in
                    control-postcondition-query-failure:*) exit 19 ;;
                    migration-postcondition-query-failure:${FAKE_MIGRATION_ID:?}) exit 19 ;;
                esac
                if [ -f "$helper_state.$exact_id" ]; then
                    printf '%s\n' "$exact_id"
                elif [ "$exact_id" = "${FAKE_MIGRATION_ID:?}" ] && [ -f "$migration_state" ]; then
                    printf '%s\n' "$FAKE_MIGRATION_ID"
                fi
                ;;
            *'sanctuary.grafana.role=control-helper'*)
                for helper_file in "$helper_state".*; do
                    [ -f "$helper_file" ] || continue
                    [[ "$helper_file" != "$helper_state.output."* ]] || continue
                    basename "$helper_file" | sed 's/^helper.state\.//'
                done
                ;;
            *"${FAKE_MIGRATION_NAME:?}"*) [ ! -f "$migration_state" ] || printf '%s\n' "$FAKE_MIGRATION_ID" ;;
        esac
        ;;
    'container create '*'sanctuary.grafana.role=control-helper'*)
        token="$(env_arg TOKEN "$@")"
        container="$(env_arg CONTAINER_ID "$@")"
        generation="$(env_arg GENERATION "$@")"
        migration_ref="$(env_arg MIGRATION_ID "$@")"
        created_input="$(env_arg CREATED "$@")"
        command="${@: -1}"
        operation="$(printf '%s\n' "$*" | sed -n 's/.*sanctuary.grafana.operation=\([^ ]*\).*/\1/p')"
        owner="$(printf '%s\n' "$*" | sed -n 's/.*sanctuary.grafana.owner=\([^ ]*\).*/\1/p')"
        nonce="$(printf '%s\n' "$*" | sed -n 's/.*sanctuary.grafana.nonce=\([^ ]*\).*/\1/p')"
        helper_id="$(fake_helper_id "$nonce")"
        helper_file="$helper_state.$helper_id"
        action=bootstrap
        [ "$command" != 'date +%s' ] || action=daemon-time
        [[ "$command" != *'date -u -d "$value" +%s'* ]] || action=created-time
        [[ "$command" != *'/control/leases/lease-'* ]] || action=lease
        [[ "$command" != *'/control/abandonments/abandonment-'* ]] || action=abandonment
        [[ "$command" != cat*'/control/outcomes/'* ]] || action=read-outcome
        [[ "$command" != cat*'/control/leases/'* ]] || action=read-lease
        [[ "$command" != cat*'/control/abandonments/'* ]] || action=read-abandonment
        [[ "$command" != cat*'/control/claims/'* ]] || action=read-reclamation
        [[ "$command" != *'result=claimed'* ]] || action=claim-reclamation
        [[ "$command" != rm\ -f* ]] || action=cleanup
        printf '%s|created|0|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
            "$action" "$token" "$container" "$generation" "$operation" \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$migration_ref" "$created_input" "$owner" "$nonce" > "$helper_file"
        [ "${FAKE_DOCKER_MODE:-success}" != helper-create-response-lost ] || exit 12
        if [ "${FAKE_DOCKER_MODE:-success}" = hold-helper-created ]; then
            : > "$helper_created_signal"
            while [ ! -f "$helper_release_signal" ]; do sleep 0.01; done
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = helper-create-foreign-output ]; then
            printf 'f%.0s' {1..64}; printf '\n'
        else
            printf '%s\n' "$helper_id"
        fi
        ;;
    'container create '*'sanctuary.grafana.role=password-migration'*)
        [ "${FAKE_DOCKER_MODE:-success}" != create-failure ] || exit 12
        token="$(env_arg SANCTUARY_GRAFANA_QUIESCENCE_TOKEN "$@")"
        container="$(env_arg SANCTUARY_GRAFANA_QUIESCENCE_CONTAINER_ID "$@")"
        generation="$(env_arg SANCTUARY_GRAFANA_QUIESCENCE_GENERATION "$@")"
        printf 'created|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
        [ "${FAKE_DOCKER_MODE:-success}" != migration-create-response-lost ] || exit 12
        if [ "${FAKE_DOCKER_MODE:-success}" = migration-create-foreign-output ]; then
            printf 'c%.0s' {1..64}; printf '\n'
        else
            printf '%s\n' "$FAKE_MIGRATION_ID"
        fi
        ;;
    'container start a'*)
        helper_id="$3"
        helper_file="$helper_state.$helper_id"
        [ "${FAKE_DOCKER_MODE:-success}" != helper-start-failure ] || exit 12
        sed -i 's/|created|/|running|/' "$helper_file"
        printf '%s\n' "$helper_id"
        ;;
    'wait a'*)
        helper_id="$2"
        helper_file="$helper_state.$helper_id"
        helper_output_file="$helper_state.output.$helper_id"
        IFS='|' read -r action _state _exit token container generation operation created migration_ref created_input owner nonce < "$helper_file"
        [ "${FAKE_DOCKER_MODE:-success}" != helper-wait-failure ] || exit 15
        if [ "${FAKE_DOCKER_MODE:-success}" = helper-failure ]; then
            sed -i 's/|running|0|/|exited|13|/' "$helper_file"
            printf '13\n'
            exit 0
        fi
        case "$action" in
            daemon-time) printf '%s\n' "$(date +%s)" > "$helper_output_file" ;;
            created-time) printf '%s\n' "$(date -d "$created_input" +%s)" > "$helper_output_file" ;;
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
            read-outcome) cat "$control/outcomes/outcome-$token" > "$helper_output_file" ;;
            read-lease) cat "$control/leases/lease-$token" > "$helper_output_file" ;;
            read-abandonment) cat "$control/abandonments/abandonment-$token" > "$helper_output_file" ;;
            read-reclamation) cat "$control/claims/$token" > "$helper_output_file" ;;
            claim-reclamation)
                if [ -e "$control/claims/$token" ]; then
                    printf 'exists\n' > "$helper_output_file"
                else
                    cat > "$control/claims/$token" <<EOF
version=1
status=reclaiming-before-start
token=$token
project=${FAKE_PROJECT_NAME:?}
data_volume=${FAKE_DATA_VOLUME:?}
control_volume=${FAKE_CONTROL_VOLUME:?}
migration_id=$migration_ref
container_id=$container
generation=$generation
EOF
                    printf 'claimed\n' > "$helper_output_file"
                fi
                if [ "${FAKE_DOCKER_MODE:-success}" = reclaim-race-running ]; then
                    printf 'running|17|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
                elif [ "${FAKE_DOCKER_MODE:-success}" = reclaim-race-exited ]; then
                    printf 'exited|17|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
                fi
                ;;
            abandonment)
                cat > "$control/abandonments/abandonment-$token" <<EOF
version=1
status=abandoned-before-start
token=$token
project=${FAKE_PROJECT_NAME:?}
data_volume=${FAKE_DATA_VOLUME:?}
control_volume=${FAKE_CONTROL_VOLUME:?}
migration_id=$migration_ref
container_id=$container
generation=$generation
EOF
                ;;
            cleanup)
                rm -f "$control/leases/lease-$token" "$control/outcomes/outcome-$token" \
                    "$control/abandonments/abandonment-$token"
                if [ -f "$control/claims/$token" ]; then
                    rm -f "$control/claims/$token"
                else
                    rmdir "$control/claims/$token" 2>/dev/null || true
                fi
                ;;
        esac
        case "${FAKE_DOCKER_MODE:-success}" in
            helper-terminal-state-lag|helper-terminal-state-stuck) ;;
            helper-terminal-exit-mismatch) sed -i 's/|running|0|/|exited|17|/' "$helper_file" ;;
            *) sed -i 's/|running|/|exited|/' "$helper_file" ;;
        esac
        if [ "${FAKE_DOCKER_MODE:-success}" = hold-helper-exited ]; then
            : > "$helper_exited_signal"
            while [ ! -f "$helper_release_signal" ]; do sleep 0.01; done
        fi
        printf '0\n'
        ;;
    'logs a'*)
        helper_id="$2"
        [ "${FAKE_DOCKER_MODE:-success}" != helper-logs-failure ] || exit 14
        helper_output_file="$helper_state.output.$helper_id"
        [ ! -f "$helper_output_file" ] || cat "$helper_output_file"
        ;;
    "container start ${FAKE_MIGRATION_ID:?}")
        read_migration
        if [ "${FAKE_DOCKER_MODE:-success}" = start-failure-created ]; then
            exit 12
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = start-failure-running ]; then
            printf 'running|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            exit 12
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = start-failure-exited ]; then
            write_outcome success
            printf 'exited|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            exit 12
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = concurrent-hold ]; then
            printf 'running|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            : > "$started_signal"
            while [ ! -f "$release_signal" ]; do sleep 0.01; done
            write_outcome success
            printf 'exited|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            printf '%s\n' "$FAKE_MIGRATION_ID"
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
        if [ "${FAKE_DOCKER_MODE:-success}" = terminal-state-stuck ]; then
            write_outcome success
            printf 'stopping|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            printf '%s\n' "$FAKE_MIGRATION_ID"
            exit 0
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = terminal-state-lag ]; then
            write_outcome success
            printf 'stopping|0|%s|%s|%s\n' "$token" "$container" "$generation" > "$migration_state"
            printf '%s\n' "$FAKE_MIGRATION_ID"
            exit 0
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
        printf '%s\n' "$FAKE_MIGRATION_ID"
        ;;
    "wait ${FAKE_MIGRATION_ID:?}")
        read_migration
        if [ "${FAKE_DOCKER_MODE:-success}" = reclaim-race-running ] && [ "$state" = running ]; then
            state=exited
            printf '%s|%s|%s|%s|%s\n' "$state" "$exit_code" "$token" "$container" "$generation" > "$migration_state"
        fi
        printf '%s\n' "$exit_code"
        ;;
    'container rm a'*)
        helper_id="$3"
        if [ -f "$helper_state.$helper_id" ]; then
            rm -f "$helper_state.$helper_id" "$helper_state.output.$helper_id"
        else
            exit 1
        fi
        printf '%s\n' "$helper_id"
        [ "${FAKE_DOCKER_MODE:-success}" != helper-remove-response-lost ] || exit 17
        [ "${FAKE_DOCKER_MODE:-success}" != migration-remove-response-lost ] || exit 17
        ;;
    'container rm helper-'*)
        helper_id="$3"
        rm -f "$helper_state.$helper_id" "$helper_state.output.$helper_id"
        printf '%s\n' "$helper_id"
        ;;
    'container rm aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        rm -f "$helper_state.$3"
        printf '%s\n' "$3"
        ;;
    "container rm ${FAKE_MIGRATION_ID:?}")
        read_migration
        [ "$state" != running ] || exit 18
        rm -f "$migration_state"
        printf '%s\n' "$FAKE_MIGRATION_ID"
        [ "${FAKE_DOCKER_MODE:-success}" != migration-remove-response-lost ] || exit 17
        ;;
    'container rm bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
        rm -f "$migration_state"
        printf '%s\n' "$3"
        ;;
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
    find "$TEST_ROOT/ownership" -type f -delete 2>/dev/null || true
    find "$TEST_ROOT/ownership" -depth -type d -empty -delete 2>/dev/null || true
    rm -f "$TEST_ROOT/migration.state" "$TEST_ROOT/helper.state" "$TEST_ROOT/helper.state".* \
        "$TEST_ROOT/data-volume.state" \
        "$TEST_ROOT/volume-inspect.count" "$TEST_ROOT/migration-started" \
        "$TEST_ROOT/migration-release" "$TEST_ROOT/events.log"
    rm -f "$TEST_ROOT/helper-created" "$TEST_ROOT/helper-exited" "$TEST_ROOT/helper-release"
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
        FAKE_VOLUME_INSPECT_COUNT="$TEST_ROOT/volume-inspect.count" \
        FAKE_GRAFANA_DATA_DIR="$TEST_ROOT/grafana-data" \
        FAKE_EVENT_LOG="$TEST_ROOT/events.log" \
        FAKE_MIGRATION_STARTED_SIGNAL="$TEST_ROOT/migration-started" \
        FAKE_MIGRATION_RELEASE_SIGNAL="$TEST_ROOT/migration-release" \
        FAKE_HELPER_CREATED_SIGNAL="$TEST_ROOT/helper-created" \
        FAKE_HELPER_EXITED_SIGNAL="$TEST_ROOT/helper-exited" \
        FAKE_HELPER_RELEASE_SIGNAL="$TEST_ROOT/helper-release" \
        FAKE_PROJECT_NAME="$TEST_PROJECT" FAKE_DATA_VOLUME="$TEST_DATA_VOLUME" \
        FAKE_CONTROL_VOLUME="$TEST_CONTROL_VOLUME" FAKE_MIGRATION_NAME="$MIGRATION_NAME" \
        FAKE_MIGRATION_ID="$MIGRATION_RUNTIME_ID" \
        FAKE_CONTROL_NAME="$CONTROL_NAME" FAKE_SCRIPT_DIGEST="$SCRIPT_DIGEST" \
        SANCTUARY_INSTALL_MODE="${SANCTUARY_INSTALL_MODE:-}" \
        SANCTUARY_OWNERSHIP_ROOT="$TEST_ROOT/ownership" \
        GRAFANA_PASSWORD="test-grafana-password" \
        PATH="$path_value" /bin/bash "$HELPER" "$project_dir" \
        --project-directory "$PROJECT_ROOT" -f "$PROJECT_ROOT/docker-compose.yml" \
        -f "$PROJECT_ROOT/docker/compose/monitoring.yml"
}

test_success_uses_daemon_control_volume() {
    reset_case
    local evidence label registration remove_line absent_line
    evidence="$(run_helper success 2>&1 >/dev/null)"
    grep -Fq -- '--pull never --name' "$TEST_ROOT/docker.log"
    grep -Eq -- '--label sanctuary\.grafana\.owner=[0-9a-f]{64}' "$TEST_ROOT/docker.log"
    grep -Fq -- '--label sanctuary.grafana.operation=control-init' "$TEST_ROOT/docker.log"
    grep -Eq -- '--label sanctuary\.grafana\.nonce=[0-9a-f]{32}' "$TEST_ROOT/docker.log"
    grep -Fq "src=$TEST_CONTROL_VOLUME,dst=/control" "$TEST_ROOT/docker.log"
    grep -Fq "src=$TEST_DATA_VOLUME,dst=/var/lib/grafana" "$TEST_ROOT/docker.log"
    grep -Fq "volume inspect $TEST_DATA_VOLUME" "$TEST_ROOT/docker.log"
    grep -Fq "volume inspect $TEST_CONTROL_VOLUME" "$TEST_ROOT/docker.log"
    for label in project deployment-id owner-id resource-class lifecycle cleanup-policy \
        created-at created-by-release created-by-commit creation-run-id; do
        grep -Fq -- "--label io.sanctuary.$label=" "$TEST_ROOT/docker.log"
    done
    grep -Fq -- '--label io.sanctuary.resource-class=compose_container' "$TEST_ROOT/docker.log"
    grep -Fq -- '--label io.sanctuary.lifecycle=obsolete' "$TEST_ROOT/docker.log"
    ! grep -Fq -- 'io.sanctuary.resource-class=collector_process' "$TEST_ROOT/docker.log"
    test "$(find "$TEST_ROOT/ownership/registrations/compose_volume" -name '*.json' | wc -l)" -eq 2
    for registration in "$TEST_ROOT/ownership/registrations/compose_volume"/*.json; do
        jq -e '.resourceClass == "compose_volume"
            and .lifecycle == "active"
            and .cleanupPolicy == "preserve_ambiguous"
            and (.immutableIdentity | test("^[0-9a-f]{64}$"))' "$registration" >/dev/null
    done
    test "$(find "$TEST_ROOT/ownership/registrations/compose_container" -name '*.json' | wc -l)" -ge 2
    for registration in "$TEST_ROOT/ownership/registrations/compose_container"/*.json; do
        jq -e '.resourceClass == "compose_container"
            and .lifecycle == "obsolete"
            and .cleanupPolicy == "exact_delete"
            and .locatorKind == "engine_id"
            and (.immutableIdentity | type == "string" and length > 0)' "$registration" >/dev/null
    done
    grep -Eq 'registered-transient resource_class=compose_container immutable_id=[0-9a-f]{64} postcondition=absent' <<< "$evidence"
    grep -Fq "registered-transient resource_class=compose_container immutable_id=$MIGRATION_RUNTIME_ID postcondition=absent" <<< "$evidence"
    remove_line="$(grep -nF "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log" | tail -1 | cut -d: -f1)"
    absent_line="$(grep -nF "container inspect $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log" | tail -1 | cut -d: -f1)"
    [ "$remove_line" -lt "$absent_line" ]
    ! grep -Fq '/proc/' "$TEST_ROOT/docker.log"
    ! grep -Fq "$PROJECT_ROOT/scripts/ops/migrate-grafana-password.sh" "$TEST_ROOT/docker.log"
    test ! -f "$TEST_ROOT/migration.state"
    test -z "$(find "$TEST_ROOT/control" -type f -print -quit)"
}

test_control_helpers_use_detached_start_wait_and_logs() {
    reset_case
    run_helper success >/dev/null
    grep -Eq '^container start [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
    grep -Eq '^wait [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
    grep -Eq '^logs [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
    ! grep -Eq '^container start -a helper-' "$TEST_ROOT/docker.log"

    local start_line wait_line logs_line remove_line
    start_line="$(grep -nEm1 '^container start [0-9a-f]{64}$' "$TEST_ROOT/docker.log" | cut -d: -f1)"
    wait_line="$(grep -nEm1 '^wait [0-9a-f]{64}$' "$TEST_ROOT/docker.log" | cut -d: -f1)"
    logs_line="$(grep -nEm1 '^logs [0-9a-f]{64}$' "$TEST_ROOT/docker.log" | cut -d: -f1)"
    remove_line="$(grep -nEm1 '^container rm [0-9a-f]{64}$' "$TEST_ROOT/docker.log" | cut -d: -f1)"
    [ "$start_line" -lt "$wait_line" ]
    [ "$wait_line" -lt "$logs_line" ]
    [ "$logs_line" -lt "$remove_line" ]
}

test_create_response_loss_arms_exact_retirement() {
    local mode output status
    for mode in helper-create-response-lost migration-create-response-lost; do
        reset_case
        status=0
        output="$(run_helper "$mode" 2>&1)" || status=$?
        [ "$status" -ne 0 ]
        if [ "$mode" = helper-create-response-lost ]; then
            grep -Eq '^container rm [a-f0-9]{64}$' "$TEST_ROOT/docker.log"
            grep -Eq 'immutable_id=[a-f0-9]{64} postcondition=absent' <<< "$output"
        else
            grep -Eq '^container rm [b]{64}$' "$TEST_ROOT/docker.log"
            grep -Eq 'immutable_id=[b]{64} postcondition=absent' <<< "$output"
        fi
    done
}

test_remove_response_loss_reconciles_exact_absence() {
    local mode output
    for mode in helper-remove-response-lost migration-remove-response-lost; do
        reset_case
        output="$(run_helper "$mode" 2>&1 >/dev/null)"
        grep -Fq 'postcondition=absent' <<< "$output"
        test -z "$(find "$TEST_ROOT" -maxdepth 1 \( -name 'helper.state.*' -o -name 'migration.state' \) -type f -print -quit)"
    done
}

test_successful_create_foreign_output_is_recovered_registered_and_retired() {
    local mode output status
    for mode in helper-create-foreign-output migration-create-foreign-output; do
        reset_case
        status=0
        output="$(run_helper "$mode" 2>&1)" || status=$?
        [ "$status" -ne 0 ]
        grep -Fq 'postcondition=absent' <<< "$output"
        test -z "$(find "$TEST_ROOT" -maxdepth 1 \( -name 'helper.state.*' -o -name 'migration.state' \) -type f -print -quit)"
    done
}

test_control_helper_absence_query_ambiguity_fails_without_evidence() {
    reset_case
    local output status=0
    output="$(run_helper control-postcondition-query-failure 2>&1)" || status=$?
    [ "$status" -ne 0 ]
    grep -Eq '^container rm [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
    grep -Eq '^container ls -a --no-trunc --filter id=[0-9a-f]{64}' "$TEST_ROOT/docker.log"
    ! grep -Fq 'registered-transient resource_class=compose_container' <<< "$output"
    ! grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"
}

test_migration_absence_query_ambiguity_fails_without_evidence() {
    reset_case
    local output status=0
    output="$(run_helper migration-postcondition-query-failure 2>&1)" || status=$?
    [ "$status" -ne 0 ]
    grep -Fq "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
    grep -Fq "container ls -a --no-trunc --filter id=$MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
    ! grep -Fq "immutable_id=$MIGRATION_RUNTIME_ID postcondition=absent" <<< "$output"
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
    for tool in sed head awk grep jq node openssl mkdir chmod date cat rm rmdir find sleep; do
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
    for tool in sed head awk grep jq node openssl mkdir chmod date cat rm rmdir find sleep; do
        resolved="$(command -v "$tool")"
        ln -sf "$resolved" "$restricted/$tool"
    done
    printf '%s\n' "$restricted"
}

test_fresh_data_volume_is_created_with_compose_identity() {
    reset_case
    run_helper fresh-volume >/dev/null
    local label
    for label in project deployment-id owner-id resource-class lifecycle cleanup-policy \
        created-at created-by-release created-by-commit creation-run-id; do
        grep -Fq -- "--label io.sanctuary.$label=" "$TEST_ROOT/docker.log"
    done
    grep -Fq -- '--label io.sanctuary.resource-class=compose_volume' "$TEST_ROOT/docker.log"
    grep -Fq -- '--label io.sanctuary.lifecycle=active' "$TEST_ROOT/docker.log"
    grep -Fq -- '--label io.sanctuary.cleanup-policy=preserve_ambiguous' "$TEST_ROOT/docker.log"
    grep -Fq -- "--label com.docker.compose.project=$TEST_PROJECT" "$TEST_ROOT/docker.log"
    grep -Fq -- '--label com.docker.compose.volume=grafana_data' "$TEST_ROOT/docker.log"
    ! grep -Eq '^volume rm ' "$TEST_ROOT/docker.log"
}

test_volume_create_response_loss_recovers_without_deleting_data() {
    reset_case
    local output
    output="$(run_helper volume-create-response-lost 2>&1 >/dev/null)"
    grep -Fq 'Recovered Grafana grafana_data volume after a lost create response.' <<< "$output"
    grep -Fq 'volume create ' "$TEST_ROOT/docker.log"
    ! grep -Eq '^volume rm ' "$TEST_ROOT/docker.log"
    grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"
}

test_foreign_malformed_and_unstable_volumes_fail_closed() {
    local mode output status
    for mode in foreign-volume malformed-volume unstable-volume volume-inspect-error; do
        reset_case
        status=0
        output="$(run_helper "$mode" 2>&1)" || status=$?
        [ "$status" -ne 0 ] || {
            echo "$mode unexpectedly accepted an ambiguous Grafana volume" >&2
            return 1
        }
        grep -Fq 'volume identity is unavailable, unexpected, or unstable' <<< "$output"
        ! grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"
        ! grep -Eq '^volume rm ' "$TEST_ROOT/docker.log"
    done
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
    grep -Eq '^container start [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
    grep -Eq '^wait [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
    grep -Eq '^logs [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
    grep -Eq '^container rm [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
    test -z "$(find "$TEST_ROOT" -maxdepth 1 -name 'helper.state.*' -type f -print -quit)"
    ! grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"
    ! grep -Fq 'sanctuary.grafana.role=password-migration' "$TEST_ROOT/docker.log"
}

test_control_helper_transport_failures_fail_closed() {
    local mode
    for mode in helper-start-failure helper-wait-failure helper-logs-failure; do
        reset_case
        if run_helper "$mode" >/dev/null 2>&1; then
            echo "$mode unexpectedly allowed migration" >&2
            return 1
        fi
        ! grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"
        ! grep -Fq 'sanctuary.grafana.role=password-migration' "$TEST_ROOT/docker.log"
    done
}

test_control_helper_terminal_state_lag_settles() {
    reset_case
    SANCTUARY_GRAFANA_TERMINAL_SETTLE_DELAY=0 \
        run_helper helper-terminal-state-lag >/dev/null
    grep -Eq '^container rm [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
}

test_control_helper_terminal_state_failures_stay_closed() {
    local mode output status
    for mode in helper-terminal-state-stuck helper-terminal-exit-mismatch; do
        reset_case
        set +e
        output="$(SANCTUARY_GRAFANA_TERMINAL_SETTLE_ATTEMPTS=2 \
            SANCTUARY_GRAFANA_TERMINAL_SETTLE_DELAY=0 run_helper "$mode" 2>&1)"
        status=$?
        set -e
        [ "$status" -ne 0 ] || {
            echo "$mode unexpectedly accepted an inconsistent terminal state" >&2
            return 1
        }
        case "$output" in
            *"Grafana control helper terminal state is inconsistent"*) ;;
            *) echo "$mode produced an unexpected refusal: $output" >&2; return 1 ;;
        esac
        ! grep -Eq '^container rm [0-9a-f]{64}$' "$TEST_ROOT/docker.log"
        ! grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"
    done
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
    grep -Fq "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
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
    grep -Fq "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
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
        grep -Fq "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
    done
}

test_remote_daemon_never_receives_client_checkout_path() {
    reset_case
    local client_only_path="$TEST_ROOT/client-checkout-not-mounted-on-daemon"
    local restricted
    restricted="$(no_flock_path)"
    mkdir -p "$client_only_path"
    run_helper success "$restricted" "$client_only_path" >/dev/null
    if grep -F 'container create' "$TEST_ROOT/docker.log" | grep -Fq "$client_only_path"; then
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
    grep -Fq "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
}

test_created_sentinel_start_failure_reconciles_from_abandonment() {
    reset_case
    local originals="$TEST_ROOT/start-failure-originals" suffix
    mkdir -p "$originals"
    for suffix in '' '-journal' '-wal' '-shm'; do
        printf 'never-started-%s\n' "${suffix:-database}" > "$TEST_ROOT/grafana-data/grafana.db$suffix"
        cp "$TEST_ROOT/grafana-data/grafana.db$suffix" "$originals/grafana.db$suffix"
    done

    if run_helper start-failure-created >/dev/null 2>&1; then
        echo "created-state start failure unexpectedly succeeded" >&2
        return 1
    fi
    IFS='|' read -r state _ < "$TEST_ROOT/migration.state"
    test "$state" = created
    grep -Fqx 'status=abandoned-before-start' "$TEST_ROOT/control/abandonments/"abandonment-*
    for suffix in '' '-journal' '-wal' '-shm'; do
        cmp "$originals/grafana.db$suffix" "$TEST_ROOT/grafana-data/grafana.db$suffix"
    done
    test ! -f "$TEST_ROOT/grafana-data/.sanctuary-independent-password-v1"

    : > "$TEST_ROOT/docker.log"
    run_helper success >/dev/null
    grep -Fq "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
    test ! -f "$TEST_ROOT/migration.state"
    test -z "$(find "$TEST_ROOT/control" -type f -print -quit)"
}

test_created_reclaim_fences_delayed_start_transitions() {
    local mode suffix originals
    for mode in reclaim-race-running reclaim-race-exited; do
        reset_case
        originals="$TEST_ROOT/$mode-originals"
        mkdir -p "$originals"
        for suffix in '' '-journal' '-wal' '-shm'; do
            printf '%s-%s\n' "$mode" "${suffix:-database}" > "$TEST_ROOT/grafana-data/grafana.db$suffix"
            cp "$TEST_ROOT/grafana-data/grafana.db$suffix" "$originals/grafana.db$suffix"
        done
        if run_helper start-failure-created >/dev/null 2>&1; then
            echo "$mode setup unexpectedly succeeded" >&2
            return 1
        fi
        : > "$TEST_ROOT/docker.log"
        run_helper "$mode" >/dev/null
        grep -Fq 'status=reclaiming-before-start' "$TEST_ROOT/docker.log" \
            || grep -Fq 'result=claimed' "$TEST_ROOT/docker.log"
        if [ "$mode" = reclaim-race-running ]; then
            grep -Fq "wait $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
        fi
        for suffix in '' '-journal' '-wal' '-shm'; do
            cmp "$originals/grafana.db$suffix" "$TEST_ROOT/grafana-data/grafana.db$suffix"
        done
        test ! -f "$TEST_ROOT/migration.state"
        test -z "$(find "$TEST_ROOT/control" -type f -print -quit)"
    done
}

test_entrypoint_claim_directory_wins_without_nested_reclaim_artifact() {
    reset_case
    if run_helper start-failure-created >/dev/null 2>&1; then
        echo "entrypoint-claim setup unexpectedly succeeded" >&2
        return 1
    fi
    IFS='|' read -r state exit_code token container generation < "$TEST_ROOT/migration.state"
    mkdir "$TEST_ROOT/control/claims/$token"
    if run_helper success >/dev/null 2>&1; then
        echo "entrypoint-owned claim unexpectedly allowed created reclamation" >&2
        return 1
    fi
    test -z "$(find "$TEST_ROOT/control/claims/$token" -mindepth 1 -print -quit)"

    cat > "$TEST_ROOT/control/outcomes/outcome-$token" <<EOF
version=1
status=rolled-back
token=$token
project=$TEST_PROJECT
data_volume=$TEST_DATA_VOLUME
control_volume=$TEST_CONTROL_VOLUME
container_id=$container
generation=$generation
EOF
    printf 'exited|1|%s|%s|%s\n' "$token" "$container" "$generation" > "$TEST_ROOT/migration.state"
    run_helper success >/dev/null
    test ! -e "$TEST_ROOT/control/claims/$token"
    test -z "$(find "$TEST_ROOT/control" -type f -print -quit)"
}

test_start_failure_running_and_exited_states_keep_existing_rules() {
    reset_case
    if run_helper start-failure-running >/dev/null 2>&1; then
        echo "running-state start failure unexpectedly succeeded" >&2
        return 1
    fi
    if run_helper success >/dev/null 2>&1; then
        echo "running start-failure sentinel unexpectedly reconciled" >&2
        return 1
    fi
    ! find "$TEST_ROOT/control/abandonments" -type f -print -quit | grep -q .

    reset_case
    if run_helper start-failure-exited >/dev/null 2>&1; then
        echo "exited-state start failure unexpectedly succeeded" >&2
        return 1
    fi
    grep -Fqx 'status=success' "$TEST_ROOT/control/outcomes/"outcome-*
    : > "$TEST_ROOT/docker.log"
    run_helper success >/dev/null
    grep -Fq "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
}

test_live_unique_control_helpers_are_not_cross_removed() {
    local mode signal owner_pid restricted second_status
    restricted="$(no_flock_path)"
    for mode in hold-helper-created hold-helper-exited; do
        reset_case
        signal="$TEST_ROOT/helper-created"
        [ "$mode" != hold-helper-exited ] || signal="$TEST_ROOT/helper-exited"
        run_helper "$mode" "$restricted" >"$TEST_ROOT/helper-owner.out" 2>&1 &
        owner_pid=$!
        for _attempt in {1..200}; do
            [ -f "$signal" ] && break
            sleep 0.01
        done
        [ -f "$signal" ] || {
            touch "$TEST_ROOT/helper-release"
            wait "$owner_pid" || true
            echo "$mode never reached its barrier" >&2
            return 1
        }

        second_status=0
        run_helper success "$restricted" >"$TEST_ROOT/helper-contender.out" 2>&1 \
            || second_status=$?
        [ "$second_status" -eq 0 ] || {
            touch "$TEST_ROOT/helper-release"
            wait "$owner_pid" || true
            return "$second_status"
        }
        find "$TEST_ROOT" -maxdepth 1 -name 'helper.state.*' -type f | grep -q .
        touch "$TEST_ROOT/helper-release"
        wait "$owner_pid" || {
            cat "$TEST_ROOT/helper-owner.out" >&2
            return 1
        }
        test -z "$(find "$TEST_ROOT" -maxdepth 1 -name 'helper.state.*' -type f -print -quit)"
    done
}

test_stale_owned_control_helpers_are_reclaimed() {
    local state nonce owner helper_file
    for state in created exited; do
        reset_case
        nonce="$(printf '%032d' 7)"
        owner="$(printf '%064d' 8)"
        helper_file="$TEST_ROOT/helper.state.helper-$nonce"
        printf 'daemon-time|%s|0||||daemon-time|2020-01-01T00:00:00Z|||%s|%s\n' \
            "$state" "$owner" "$nonce" > "$helper_file"
        run_helper success >/dev/null
        test ! -f "$helper_file"
        grep -Fq "container rm helper-$nonce" "$TEST_ROOT/docker.log"
    done
}

# A container that has genuinely exited can still be reported non-terminal for a
# moment: `docker wait` returns as soon as the process ends, while the daemon
# finalises State.Status asynchronously. Podman's docker-compat layer widens that
# window (conmon updates the state DB after wait returns), and rootless Podman is
# what CI runs on.
#
# run_migration sampled the state exactly once and refused on the first
# disagreement, so that lag surfaced as a hard install failure:
#   Grafana credential migration refused: migration container terminal state is inconsistent.
# It took down the release-blocking latest-stable/optional-profiles upgrade lane on
# v0.8.64-rc1 and rc2, in a different phase each time -- the signature of a race,
# not a deterministic fault.
#
# The invariant is unchanged: the state must still converge to exactly "exited"
# with an exit code matching `docker wait`. Only the moment of observation may lag.
test_terminal_state_lag_settles_instead_of_refusing() {
    reset_case
    run_helper terminal-state-lag >/dev/null
    grep -Fq 'sanctuary.grafana.role=password-migration' "$TEST_ROOT/docker.log"
    grep -Fq "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log"
}

# Negative control for the settle above: tolerating a lagging observation must not
# become tolerating any observation. A state that never converges is still refused,
# with the same message, once the settle budget is spent.
test_terminal_state_that_never_settles_is_still_refused() {
    reset_case
    local output status
    set +e
    output="$(SANCTUARY_GRAFANA_TERMINAL_SETTLE_ATTEMPTS=2 SANCTUARY_GRAFANA_TERMINAL_SETTLE_DELAY=0 \
        run_helper terminal-state-stuck 2>&1)"
    status=$?
    set -e
    [ "$status" -ne 0 ] || { echo "FAIL: a never-settling terminal state was accepted" >&2; return 1; }
    case "$output" in
        *"migration container terminal state is inconsistent"*) ;;
        *) echo "FAIL: unexpected refusal reason: $output" >&2; return 1 ;;
    esac
    grep -Fq "container rm $MIGRATION_RUNTIME_ID" "$TEST_ROOT/docker.log" \
        && { echo "FAIL: removed a container whose state never settled" >&2; return 1; }
    return 0
}

make_fake_docker "$TEST_ROOT/bin"
test_success_uses_daemon_control_volume
test_control_helpers_use_detached_start_wait_and_logs
test_create_response_loss_arms_exact_retirement
test_remove_response_loss_reconciles_exact_absence
test_successful_create_foreign_output_is_recovered_registered_and_retired
test_control_helper_absence_query_ambiguity_fails_without_evidence
test_migration_absence_query_ambiguity_fails_without_evidence
test_precondition_refusals_happen_before_migration
test_no_flock_path_succeeds
test_fresh_data_volume_is_created_with_compose_identity
test_volume_create_response_loss_recovers_without_deleting_data
test_foreign_malformed_and_unstable_volumes_fail_closed
test_flock_refusal_precedes_docker_mutation
test_control_helper_failure_precedes_grafana_stop
test_control_helper_transport_failures_fail_closed
test_control_helper_terminal_state_lag_settles
test_control_helper_terminal_state_failures_stay_closed
test_rolled_back_terminal_reconciles_before_retry
test_post_claim_pre_snapshot_failure_reconciles_without_data_mutation
test_concurrent_no_flock_wrapper_is_refused_by_running_sentinel
test_live_unique_control_helpers_are_not_cross_removed
test_stale_owned_control_helpers_are_reclaimed
test_created_sentinel_start_failure_reconciles_from_abandonment
test_created_reclaim_fences_delayed_start_transitions
test_entrypoint_claim_directory_wins_without_nested_reclaim_artifact
test_start_failure_running_and_exited_states_keep_existing_rules
test_client_disconnect_requires_scoped_terminal_outcome
test_terminal_disconnect_reconciles_fresh_and_marked_paths
test_remote_daemon_never_receives_client_checkout_path
test_online_and_preloaded_offline_helpers_never_pull
test_terminal_state_lag_settles_instead_of_refusing
test_terminal_state_that_never_settles_is_still_refused

echo "Grafana quiescence tests passed"
