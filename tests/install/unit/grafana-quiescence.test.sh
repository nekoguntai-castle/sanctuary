#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HELPER="$PROJECT_ROOT/scripts/ops/run-grafana-password-migration.sh"
TEST_ROOT="$(mktemp -d)"
ACTIVE_PID=""
TEST_PROJECT="grafana-quiescence-test-$$"
TEST_VOLUME="${TEST_PROJECT}_grafana_data"
CANONICAL_ROOT="/tmp/sanctuary-grafana-quiescence-locks"
CANONICAL_LOCK="$CANONICAL_ROOT/$TEST_PROJECT--$TEST_VOLUME.lock"
export FAKE_PROJECT_NAME="$TEST_PROJECT"
export FAKE_VOLUME_NAME="$TEST_VOLUME"

cleanup() {
    local token=""
    if [ -n "$ACTIVE_PID" ]; then
        kill "$ACTIVE_PID" 2>/dev/null || true
        wait "$ACTIVE_PID" 2>/dev/null || true
    fi
    if [ -f "$TEST_ROOT/docker.state" ]; then
        IFS='|' read -r _state _exit token < "$TEST_ROOT/docker.state" || true
    fi
    [ -z "$token" ] || rm -f "$CANONICAL_ROOT/outcomes/outcome-$token"
    rm -f "$CANONICAL_LOCK"
    rmdir "$CANONICAL_ROOT/outcomes" "$CANONICAL_ROOT" 2>/dev/null || true
    find "$TEST_ROOT" -type f -delete
    find "$TEST_ROOT" -depth -type d -empty -delete
}
trap cleanup EXIT

make_fake_docker() {
    local bin_dir="$1"
    mkdir -p "$bin_dir"
    cat > "$bin_dir/docker" <<'SCRIPT'
#!/bin/bash
set -eu
state_file="${FAKE_DOCKER_STATE:?}"
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG:?}"

read_state() {
    IFS='|' read -r state exit_code token < "$state_file"
}

if [ "${1:-}" = "inspect" ]; then
    if [[ "$*" == *'{{.State.Running}}'* ]]; then
        printf 'false\n'
    else
        printf 'container-1|2026-08-08T00:00:00Z|%s\n' "${FAKE_PROJECT_NAME:?}"
    fi
    exit 0
fi

if [ "${1:-}" = "container" ] && [ "${2:-}" = "inspect" ]; then
    [ -f "$state_file" ] || exit 1
    if [[ "$*" == *'--format'* ]]; then
        read_state
        printf 'migration-id|%s|%s|%s|%s|%s\n' \
            "$state" "$exit_code" "${FAKE_PROJECT_NAME:?}" "${FAKE_VOLUME_NAME:?}" "$token"
    else
        printf '{}\n'
    fi
    exit 0
fi

case "$*" in
    *'config --format json')
        printf '{\n  "name": "%s",\n  "services": {},\n  "volumes": {\n    "grafana_data": {\n      "name": "%s"\n    }\n  }\n}\n' \
            "${FAKE_PROJECT_NAME:?}" "${FAKE_VOLUME_NAME:?}"
        ;;
    'container ls -a '*'--format {{.ID}}') [ ! -f "$state_file" ] || printf 'migration-id\n' ;;
    'container rm '*'migration-id') rm -f "$state_file"; printf 'migration-id\n' ;;
    *'ps -aq grafana') printf 'container-1\n' ;;
    *'stop grafana') [ "${FAKE_DOCKER_MODE:-success}" != "stop-failure" ] || exit 7 ;;
    *'ps -q --status running grafana')
        [ "${FAKE_DOCKER_MODE:-success}" != "status-failure" ] || exit 8
        [ "${FAKE_DOCKER_MODE:-success}" != "still-running" ] || printf 'container-1\n'
        ;;
    *'run -d --no-deps --name '*'grafana-password-migration')
        token="${SANCTUARY_GRAFANA_QUIESCENCE_TOKEN:?}"
        if [ "${FAKE_DOCKER_MODE:-success}" = "client-disconnect" ]; then
            printf 'running|0|%s\n' "$token" > "$state_file"
            : > "${FAKE_MIGRATION_STARTED:?}"
            exit 10
        fi
        if [ "${FAKE_DOCKER_MODE:-success}" = "hold-migration" ]; then
            printf 'running|0|%s\n' "$token" > "$state_file"
            : > "${FAKE_MIGRATION_STARTED:?}"
            (while [ ! -f "${FAKE_MIGRATION_RELEASE:?}" ]; do sleep 0.01; done
             printf 'exited|0|%s\n' "$token" > "$state_file") &
        else
            printf 'exited|0|%s\n' "$token" > "$state_file"
        fi
        printf 'migration-id\n'
        ;;
    'wait migration-id')
        while :; do
            read_state
            [ "$state" != "running" ] || { sleep 0.01; continue; }
            printf '%s\n' "$exit_code"
            break
        done
        ;;
    *) echo "unexpected docker call: $*" >&2; exit 9 ;;
esac
SCRIPT
    chmod +x "$bin_dir/docker"
}

run_helper() {
    local mode="$1"
    local lease_root="$2"
    FAKE_DOCKER_MODE="$mode" FAKE_DOCKER_LOG="$TEST_ROOT/docker.log" \
        FAKE_DOCKER_STATE="$TEST_ROOT/docker.state" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$lease_root" \
        PATH="$TEST_ROOT/bin:$PATH" \
        bash "$HELPER" "$PROJECT_ROOT" --project-directory "$PROJECT_ROOT" \
            -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker/compose/monitoring.yml"
}

assert_no_migration_run() {
    ! grep -Fq 'run -d --no-deps --name' "$TEST_ROOT/docker.log"
}

test_precondition_refusals() {
    local mode
    for mode in stop-failure still-running status-failure; do
        : > "$TEST_ROOT/docker.log"
        if run_helper "$mode" "$TEST_ROOT/lease-$mode" >/dev/null 2>&1; then
            echo "$mode unexpectedly allowed Grafana migration" >&2
            exit 1
        fi
        assert_no_migration_run
    done
}

test_success_binds_identity_and_runs_once() {
    local lease_root="$TEST_ROOT/lease-success"
    : > "$TEST_ROOT/docker.log"
    run_helper success "$lease_root" >/dev/null
    grep -Fq 'stop grafana' "$TEST_ROOT/docker.log"
    grep -Fq 'run -d --no-deps --name' "$TEST_ROOT/docker.log"
    test ! -f "$lease_root/owner"
    test -z "$(find "$lease_root" -mindepth 1 -maxdepth 1 -name 'lease-*' -print -quit)"
}

test_owner_death_releases_kernel_lock_and_recovers() {
    local lease_root="$TEST_ROOT/lease-owner-death"
    local first_log="$TEST_ROOT/death-first.log"
    local recovery_log="$TEST_ROOT/death-recovery.log"
    local started="$TEST_ROOT/death-migration-started"
    local release="$TEST_ROOT/death-migration-release"
    local owner_pid state
    : > "$first_log"
    : > "$recovery_log"

    FAKE_DOCKER_MODE=hold-migration FAKE_DOCKER_LOG="$first_log" \
        FAKE_DOCKER_STATE="$TEST_ROOT/docker.state" \
        FAKE_MIGRATION_STARTED="$started" FAKE_MIGRATION_RELEASE="$release" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$lease_root" \
        PATH="$TEST_ROOT/bin:$PATH" \
        bash "$HELPER" "$PROJECT_ROOT" --project-directory "$PROJECT_ROOT" \
            -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker/compose/monitoring.yml" &
    local first_pid=$!
    ACTIVE_PID="$first_pid"
    for _ in $(seq 1 200); do
        [ ! -f "$started" ] || break
        sleep 0.01
    done
    test -f "$started"
    owner_pid="$(sed -n 's/^pid=//p' "$lease_root/owner")"
    test -n "$owner_pid"
    kill -KILL "$owner_pid"
    if FAKE_DOCKER_MODE=success FAKE_DOCKER_LOG="$recovery_log" \
        FAKE_DOCKER_STATE="$TEST_ROOT/docker.state" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$lease_root" \
        PATH="$TEST_ROOT/bin:$PATH" \
        bash "$HELPER" "$PROJECT_ROOT" --project-directory "$PROJECT_ROOT" \
            -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker/compose/monitoring.yml" \
            >/dev/null 2>&1; then
        echo "owner death released exclusion while migration client was still live" >&2
        exit 1
    fi
    grep -Fq 'config --format json' "$recovery_log"
    ! grep -Fq 'stop grafana' "$recovery_log"
    ! grep -Fq 'run -d --no-deps --name' "$recovery_log"
    : > "$recovery_log"
    : > "$release"
    wait "$first_pid" 2>/dev/null || true
    ACTIVE_PID=""
    for _ in $(seq 1 200); do
        IFS='|' read -r state _exit _token < "$TEST_ROOT/docker.state"
        [ "$state" = "exited" ] && break
        sleep 0.01
    done
    test "$state" = "exited"

    test -f "$CANONICAL_LOCK"
    FAKE_DOCKER_MODE=success FAKE_DOCKER_LOG="$recovery_log" \
        FAKE_DOCKER_STATE="$TEST_ROOT/docker.state" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$lease_root" \
        PATH="$TEST_ROOT/bin:$PATH" \
        bash "$HELPER" "$PROJECT_ROOT" --project-directory "$PROJECT_ROOT" \
            -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker/compose/monitoring.yml" \
            >/dev/null
    grep -Fq 'run -d --no-deps --name' "$recovery_log"
    test ! -f "$lease_root/owner"
}

test_concurrent_start_refuses_while_migration_holds_lock() {
    local lease_root="$TEST_ROOT/lease-concurrent"
    local first_log="$TEST_ROOT/first.log"
    local second_log="$TEST_ROOT/second.log"
    local started="$TEST_ROOT/migration-started"
    local release="$TEST_ROOT/migration-release"
    : > "$first_log"
    : > "$second_log"

    FAKE_DOCKER_MODE=hold-migration FAKE_DOCKER_LOG="$first_log" \
        FAKE_DOCKER_STATE="$TEST_ROOT/docker.state" \
        FAKE_MIGRATION_STARTED="$started" FAKE_MIGRATION_RELEASE="$release" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$lease_root" \
        PATH="$TEST_ROOT/bin:$PATH" \
        bash "$HELPER" "$PROJECT_ROOT" --project-directory "$PROJECT_ROOT" \
            -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker/compose/monitoring.yml" &
    local first_pid=$!
    ACTIVE_PID="$first_pid"
    for _ in $(seq 1 200); do
        [ ! -f "$started" ] || break
        sleep 0.01
    done
    test -f "$started"

    if FAKE_DOCKER_MODE=success FAKE_DOCKER_LOG="$second_log" \
        FAKE_DOCKER_STATE="$TEST_ROOT/docker.state" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$TEST_ROOT/other-lease-root" \
        SANCTUARY_TEST_GRAFANA_CANONICAL_LOCK_DIR="$TEST_ROOT/ignored-conflicting-lock-root" \
        HOME="$TEST_ROOT/other-home" SANCTUARY_RUNTIME_DIR="$TEST_ROOT/other-runtime" \
        PATH="$TEST_ROOT/bin:$PATH" \
        bash "$HELPER" "$PROJECT_ROOT" --project-directory "$PROJECT_ROOT" \
            -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker/compose/monitoring.yml" \
            >/dev/null 2>&1; then
        echo "concurrent Grafana start unexpectedly acquired the migration lease" >&2
        exit 1
    fi
    grep -Fq 'config --format json' "$second_log"
    ! grep -Fq 'stop grafana' "$second_log"
    ! grep -Fq 'run -d --no-deps --name' "$second_log"
    : > "$release"
    wait "$first_pid"
    ACTIVE_PID=""
}

test_client_disconnect_leaves_daemon_sentinel_until_safe_terminal_state() {
    local lease_root="$TEST_ROOT/lease-client-disconnect"
    local first_log="$TEST_ROOT/disconnect-first.log"
    local second_log="$TEST_ROOT/disconnect-second.log"
    local recovery_log="$TEST_ROOT/disconnect-recovery.log"
    local started="$TEST_ROOT/disconnect-started"
    local token
    : > "$first_log"
    : > "$second_log"
    : > "$recovery_log"

    if FAKE_DOCKER_MODE=client-disconnect FAKE_DOCKER_LOG="$first_log" \
        FAKE_DOCKER_STATE="$TEST_ROOT/docker.state" FAKE_MIGRATION_STARTED="$started" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$lease_root" \
        PATH="$TEST_ROOT/bin:$PATH" \
        bash "$HELPER" "$PROJECT_ROOT" --project-directory "$PROJECT_ROOT" \
            -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker/compose/monitoring.yml" \
            >/dev/null 2>&1; then
        echo "detached migration client failure unexpectedly succeeded" >&2
        exit 1
    fi
    test -f "$started"

    if FAKE_DOCKER_MODE=success FAKE_DOCKER_LOG="$second_log" \
        FAKE_DOCKER_STATE="$TEST_ROOT/docker.state" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$TEST_ROOT/disconnect-other-root" \
        HOME="$TEST_ROOT/disconnect-home" SANCTUARY_RUNTIME_DIR="$TEST_ROOT/disconnect-runtime" \
        PATH="$TEST_ROOT/bin:$PATH" \
        bash "$HELPER" "$PROJECT_ROOT" --project-directory "$PROJECT_ROOT" \
            -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker/compose/monitoring.yml" \
            >/dev/null 2>&1; then
        echo "orphaned running migration did not block a second wrapper" >&2
        exit 1
    fi
    ! grep -Fq 'stop grafana' "$second_log"
    ! grep -Fq 'run -d --no-deps --name' "$second_log"

    IFS='|' read -r _state _exit token < "$TEST_ROOT/docker.state"
    printf 'exited|1|%s\n' "$token" > "$TEST_ROOT/docker.state"
    printf 'rolled-back\n' > "$CANONICAL_ROOT/outcomes/outcome-$token"
    FAKE_DOCKER_MODE=success FAKE_DOCKER_LOG="$recovery_log" \
        FAKE_DOCKER_STATE="$TEST_ROOT/docker.state" \
        SANCTUARY_GRAFANA_QUIESCENCE_DIR="$TEST_ROOT/disconnect-recovery-root" \
        PATH="$TEST_ROOT/bin:$PATH" \
        bash "$HELPER" "$PROJECT_ROOT" --project-directory "$PROJECT_ROOT" \
            -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker/compose/monitoring.yml" \
            >/dev/null
    grep -Fq 'container rm migration-id' "$recovery_log"
    grep -Fq 'run -d --no-deps --name' "$recovery_log"
}

make_fake_docker "$TEST_ROOT/bin"
test_precondition_refusals
test_success_binds_identity_and_runs_once
test_concurrent_start_refuses_while_migration_holds_lock
test_owner_death_releases_kernel_lock_and_recovers
test_client_disconnect_leaves_daemon_sentinel_until_safe_terminal_state

echo "Grafana quiescence tests passed"
