#!/usr/bin/env bash
# Behavioral upgrade-mode and deployment-stage contracts; no Docker daemon used.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SETUP="$ROOT/scripts/setup.sh"
RED= GREEN= YELLOW= NC=
extract() {
    awk -v name="$1" '$0 ~ "^" name "\\(\\) *\\{" { printing=1 } printing { print } printing && /^}$/ { exit }' "$SETUP"
}
fail() { echo "FAIL: $*" >&2; exit 1; }
mode_contract() (
    local selected="$1" prior="$2" expected="$3" expected_version="$4"
    local fixture
    fixture="$(mktemp -d "$ROOT/.tmp/setup-mode.XXXXXX")"
    ENV_FILE="$fixture/runtime.env"
    LEGACY_LOCAL_ENV_FILE="$fixture/absent"
    LEGACY_DEFAULT_ENCRYPTION_SALT=legacy-default
    OPT_OFFLINE="$selected"
    OPT_ENABLE_MONITORING= OPT_ENABLE_TOR= OPT_ENABLE_MCP=
    SANCTUARY_OFFLINE_VERSION=v0.8.74-rc2
    cat > "$ENV_FILE" <<ENV
SANCTUARY_INSTALL_MODE=$prior
SANCTUARY_OFFLINE_VERSION=v0.8.69
JWT_SECRET=preserved-jwt
ENCRYPTION_KEY=preserved-encryption
ENCRYPTION_SALT=preserved-salt
GATEWAY_SECRET=preserved-gateway
WORKER_DIAGNOSTICS_SECRET=preserved-worker
POSTGRES_PASSWORD=preserved-postgres
GRAFANA_PASSWORD=preserved-grafana
LLM_EGRESS_PROXY_SECRET=preserved-egress
REDIS_PASSWORD=preserved-redis
ENABLE_MONITORING=yes
ENABLE_TOR=no
ENABLE_MCP=no
ENV
    eval "$(extract load_or_generate_secrets)"
    load_or_generate_secrets >/dev/null
    [[ "$SANCTUARY_INSTALL_MODE" == "$expected" ]] || fail 'selected mode must replace persisted mode'
    [[ "$SANCTUARY_OFFLINE_VERSION" == "$expected_version" ]] || fail 'offline version must describe this invocation'
    [[ "$JWT_SECRET:$ENCRYPTION_KEY:$ENCRYPTION_SALT:$POSTGRES_PASSWORD" == preserved-jwt:preserved-encryption:preserved-salt:preserved-postgres ]] || fail 'runtime secrets changed'
    [[ "$OPT_ENABLE_MONITORING" == yes ]] || fail 'monitoring preference changed'
)
startup_contract() (
    local supports_wait="$1" initial_failure="$2" selected_mode="${3:-false}"
    PROJECT_DIR="$ROOT" OPT_OFFLINE="$selected_mode" OPT_UPGRADE=true
    COMPOSE_FILE_ARGS=(-f retained-compose.yml --env-file retained.env -p retained-project)
    stage=password_reconciled
    FRONTEND_RUNNING=false WORKER_RUNNING=false USED_WAIT_FLAG=false
    up_status="$initial_failure" up_calls=0
    export_runtime_environment() { :; }
    deployment_stage_before() { [[ "$1" == stack_started && "$stage" != stack_started ]]; }
    deployment_transition() { stage="$1"; }
    docker() {
        if [[ "$*" == 'compose up --help' ]]; then
            echo --pull
            [[ "$supports_wait" != true ]] || echo --wait
            return 0
        fi
        [[ "$*" == 'compose -f retained-compose.yml --env-file retained.env -p retained-project up '* ]] || {
            echo 'unexpected or unscoped Docker command' >&2
            return 99
        }
        [[ "$*" == *" --no-build"* ]] || return 98
        if [[ "$OPT_OFFLINE" == true ]]; then
            [[ "$*" == *" --pull never"* ]] || return 97
        fi
        up_calls=$((up_calls + 1))
        return "$up_status"
    }
    eval "$(extract compose_up_after_build_args)"
    eval "$(extract compose_up_no_build_args)"
    eval "$(extract start_compose_services)"
    eval "$(extract start_services)"
    local result=0
    start_services >/dev/null || result=$?
    if [[ "$initial_failure" != 0 ]]; then
        [[ "$result" == "$initial_failure" ]] || fail 'compose failure must propagate'
        [[ "$stage" == password_reconciled ]] || fail 'failed startup advanced pending stage'
        [[ "$FRONTEND_RUNNING:$WORKER_RUNNING" == false:false ]] || fail 'failed startup inferred health'
        up_status=0
        start_services >/dev/null || fail 'retry did not resume startup'
        [[ "$up_calls" == 2 ]] || fail 'retry skipped compose up'
    else
        [[ "$result" == 0 ]] || fail 'successful startup failed'
    fi
    [[ "$stage" == stack_started ]] || fail 'successful startup did not advance'
)
health_contract() (
    local healthy="$1" count_file
    count_file="$(mktemp "$ROOT/.tmp/setup-health.XXXXXX")"
    echo 0 > "$count_file"
    USED_WAIT_FLAG=false FRONTEND_RUNNING=false WORKER_RUNNING=false
    COMPOSE_FILE_ARGS=(-f retained-compose.yml --env-file retained.env -p retained-project)
    docker() {
        [[ "$*" == 'compose -f retained-compose.yml --env-file retained.env -p retained-project ps '* ]] || return 99
        case "$healthy" in
            true) printf 'frontend healthy running\nworker healthy running\n' ;;
            false) printf 'worker  exited\n' ;;
            missing) : ;;
            unhealthy) printf 'frontend unhealthy running\nworker unhealthy running\n' ;;
            alternating)
                local count
                count=$(cat "$count_file")
                echo $((count + 1)) > "$count_file"
                if (( count % 2 == 0 )); then
                    printf 'frontend healthy running\nworker starting running\n'
                else
                    printf 'frontend starting running\nworker healthy running\n'
                fi
                ;;
        esac
    }
    sleep() { :; }
    eval "$(extract sample_service_health)"
    eval "$(extract wait_for_healthy)"
    local result=0
    wait_for_healthy >/dev/null || result=$?
    if [[ "$healthy" == true ]]; then
        [[ "$result" == 0 && "$FRONTEND_RUNNING:$WORKER_RUNNING" == true:true ]] || fail 'retained generation health was not recognized'
    else
        [[ "$result" != 0 ]] || fail 'unhealthy generation passed readiness'
    fi
)
# The install/upgrade log is kept on disk and often shared when asking for
# help; the reminder must say where the keys live without printing them
# (v0.8.75-rc3 prod upgrade log, 2026-09-23, held the key and salt).
backup_reminder_contract() (
    ENV_FILE=/home/operator/.config/sanctuary/sanctuary.env
    ENCRYPTION_KEY='unique-key-value-6f1c2a9e8b7d'
    ENCRYPTION_SALT='unique-salt-value-3d4e5f60'
    eval "$(extract show_backup_reminder)"
    local output
    output="$(show_backup_reminder)"
    [[ "$output" != *"$ENCRYPTION_KEY"* ]] || fail 'backup reminder printed ENCRYPTION_KEY'
    [[ "$output" != *"$ENCRYPTION_SALT"* ]] || fail 'backup reminder printed ENCRYPTION_SALT'
    [[ "$output" == *"$ENV_FILE"* ]] || fail 'backup reminder no longer names the runtime env file'
    [[ "$output" == *ENCRYPTION_KEY* && "$output" == *ENCRYPTION_SALT* ]] \
        || fail 'backup reminder no longer names the keys to back up'
)
mkdir -p "$ROOT/.tmp"
failures=0
for contract in 'mode_contract false offline online ""' 'mode_contract false online online ""' 'mode_contract true online offline v0.8.74-rc2' 'mode_contract true offline offline v0.8.74-rc2' 'startup_contract true 42' 'startup_contract false 42' 'startup_contract true 0' 'startup_contract true 42 true' 'startup_contract false 42 true' 'health_contract true' 'health_contract false' 'health_contract missing' 'health_contract unhealthy' 'health_contract alternating' 'backup_reminder_contract'; do
    if ( eval "$contract" ); then echo "PASS: $contract"; else failures=$((failures + 1)); fi
done
[[ "$failures" == 0 ]]
