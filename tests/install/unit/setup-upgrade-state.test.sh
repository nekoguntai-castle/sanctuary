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
            true) printf 'frontend healthy running\nworker healthy running\nbackup-volume-init  exited\n' ;;
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
# Secret generation must come from a CSPRNG, never the clock, and must fail
# hard (not print a short or empty secret) when its source breaks. The sandbox
# PATH holds only od/tr/head/cat plus a constant-time `date`, so openssl is
# absent and any timestamp-derived fallback would repeat.
secret_sandbox() {
    local tools="$1" tool
    SANDBOX_BIN="$(mktemp -d "$ROOT/.tmp/setup-secret.XXXXXX")"
    for tool in $tools; do
        ln -s "$(command -v "$tool")" "$SANDBOX_BIN/$tool"
    done
    printf '#!/bin/sh\necho 1700000000000000000\n' > "$SANDBOX_BIN/date"
    chmod +x "$SANDBOX_BIN/date"
}
secret_fallback_contract() (
    secret_sandbox 'od tr head cat'
    eval "$(extract generate_secret)"
    eval "$(extract generate_password)"
    local first second pw
    first="$(PATH="$SANDBOX_BIN" generate_secret)" || fail 'generate_secret failed without openssl'
    second="$(PATH="$SANDBOX_BIN" generate_secret)" || fail 'generate_secret failed without openssl'
    [[ "$first" != "$second" ]] || fail 'fallback secrets repeat (timestamp-derived)'
    [[ "$first" =~ ^[A-Za-z0-9]{32,}$ ]] || fail "fallback secret is not >=32 alphanumerics: $first"
    pw="$(PATH="$SANDBOX_BIN" generate_password)" || fail 'generate_password failed without openssl'
    [[ "$pw" =~ ^[A-Za-z0-9]{16,}$ ]] || fail "fallback password is not >=16 alphanumerics: $pw"
)
secret_hard_fail_contract() (
    secret_sandbox 'tr head cat'
    printf '#!/bin/sh\nexit 1\n' > "$SANDBOX_BIN/od"
    chmod +x "$SANDBOX_BIN/od"
    eval "$(extract generate_secret)"
    local out status=0
    out="$(PATH="$SANDBOX_BIN" generate_secret 2>/dev/null)" || status=$?
    [[ "$status" != 0 ]] || fail 'generate_secret succeeded with a failing CSPRNG read'
    [[ -z "$out" ]] || fail 'generate_secret printed a value despite failing'
)
secret_openssl_contract() (
    secret_sandbox 'od tr head cat'
    printf '#!/bin/sh\necho "Ab1=/+Cd2Ef3Gh4Ij5Kl6M=="\n' > "$SANDBOX_BIN/openssl"
    chmod +x "$SANDBOX_BIN/openssl"
    eval "$(extract generate_password)"
    local pw
    pw="$(PATH="$SANDBOX_BIN" generate_password)" || fail 'generate_password rejected openssl output'
    [[ "$pw" == Ab1Cd2Ef3Gh4Ij5Kl6M ]] || fail "unexpected openssl-derived password: $pw"
    # A broken openssl falls through to /dev/urandom instead of printing nothing.
    printf '#!/bin/sh\nexit 1\n' > "$SANDBOX_BIN/openssl"
    pw="$(PATH="$SANDBOX_BIN" generate_password)" || fail 'generate_password did not fall through from broken openssl'
    [[ "$pw" =~ ^[A-Za-z0-9]{16,}$ ]] || fail "fall-through password invalid: $pw"
)
# An upgrade rewrites the env file from the template; keys the template does
# not own (PAYJOIN_PUBLIC_URL, RATE_LIMIT_*, ...) must survive exactly once.
env_file_preservation_contract() (
    local fixture count
    fixture="$(mktemp -d "$ROOT/.tmp/setup-envfile.XXXXXX")"
    ENV_FILE="$fixture/sanctuary.env"
    PROJECT_DIR="$fixture"
    LEGACY_LOCAL_ENV_FILE="$fixture/absent"
    OPT_OFFLINE=false
    JWT_SECRET=j ENCRYPTION_KEY=e ENCRYPTION_SALT=s GATEWAY_SECRET=g
    WORKER_DIAGNOSTICS_SECRET=w POSTGRES_PASSWORD=p GRAFANA_PASSWORD=gr
    LLM_EGRESS_PROXY_SECRET=l REDIS_PASSWORD=r
    SANCTUARY_PROJECT=proj SANCTUARY_DEPLOYMENT_ID=dep SANCTUARY_OWNER_ID=own
    SANCTUARY_RELEASE=rel SANCTUARY_COMMIT=com SANCTUARY_SOURCE_COMMIT=src
    SANCTUARY_IMAGE_LOCK_SHA256=lock SANCTUARY_VERSION=v1 SANCTUARY_BUILD_ID=b
    GATEWAY_TLS_ENABLED=false
    cat > "$ENV_FILE" <<ENV
JWT_SECRET=stale-template-value
PAYJOIN_PUBLIC_URL=http://x.onion
export RATE_LIMIT_MAX=500
GATEWAY_TLS_ENABLED=false
MCP_PORT=1
MCP_PORT=2
export JWT_SECRET=stale-exported
APNS_KEY="line1
line2"
ENV
    eval "$(extract write_env_file)"
    local exit_trap_before exit_trap_after
    exit_trap_before="$(trap -p EXIT)"
    write_env_file >/dev/null 2>&1 || fail 'write_env_file failed'
    write_env_file >/dev/null 2>&1 || fail 'second write_env_file failed'
    exit_trap_after="$(trap -p EXIT)"
    [[ "$exit_trap_before" == "$exit_trap_after" ]] || fail 'write_env_file replaced the EXIT trap'
    count() { grep -c -- "$1" "$ENV_FILE" || true; }
    [[ "$(count '^PAYJOIN_PUBLIC_URL=http://x.onion$')" == 1 ]] || fail 'PAYJOIN_PUBLIC_URL not preserved exactly once'
    [[ "$(count '^export RATE_LIMIT_MAX=500$')" == 1 ]] || fail 'export RATE_LIMIT_MAX not preserved exactly once'
    [[ "$(count '^MCP_PORT=2$')" == 1 && "$(count '^MCP_PORT=1$')" == 0 ]] || fail 'last duplicate must win'
    [[ "$(count '^APNS_KEY=')" == 0 ]] || fail 'multi-line value must not be preserved'
    [[ "$(count '^GATEWAY_TLS_ENABLED=false$')" == 1 ]] || fail 'operator GATEWAY_TLS_ENABLED=false lost'
    [[ "$(count '^JWT_SECRET=j$')" == 1 && "$(count 'JWT_SECRET=')" == 1 ]] || fail 'template key must stay authoritative once'
    [[ "$(count 'OPERATOR SETTINGS')" == 1 ]] || fail 'operator section header duplicated'
    [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || fail 'env file mode is not 600'
    [[ -z "$(ls "$fixture" | grep -F .tmp. || true)" ]] || fail 'temp file left behind'

    # A copy that dies half-way must not leave a truncated secrets file behind.
    local before status=0
    before="$(cat "$ENV_FILE")"
    cat() {
        local arg
        for arg in "$@"; do
            case "$arg" in
                *.tmp.*) command cat "$arg" | head -n 2; return 1 ;;
            esac
        done
        command cat "$@"
    }
    write_env_file >/dev/null 2>&1 || status=$?
    unset -f cat
    [[ "$status" != 0 ]] || fail 'write_env_file ignored a failed copy'
    [[ "$(cat "$ENV_FILE")" == "$before" ]] || fail 'failed copy left a truncated env file'
    [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || fail 'env file mode is not 600 after failed copy'
    [[ -z "$(ls -A "$fixture" | grep -E '\.(tmp|bak)\.' || true)" ]] || fail 'temp/backup file left after failed copy'
    [[ -z "$(ls -A "$fixture" | grep -E '\.bak\.' || true)" ]] || fail 'backup left behind'
)
mkdir -p "$ROOT/.tmp"
failures=0
for contract in 'mode_contract false offline online ""' 'mode_contract false online online ""' 'mode_contract true online offline v0.8.74-rc2' 'mode_contract true offline offline v0.8.74-rc2' 'startup_contract true 42' 'startup_contract false 42' 'startup_contract true 0' 'startup_contract true 42 true' 'startup_contract false 42 true' 'health_contract true' 'health_contract false' 'health_contract missing' 'health_contract unhealthy' 'health_contract alternating' 'backup_reminder_contract' 'secret_fallback_contract' 'secret_hard_fail_contract' 'secret_openssl_contract' 'env_file_preservation_contract'; do
    if ( eval "$contract" ); then echo "PASS: $contract"; else failures=$((failures + 1)); fi
done
[[ "$failures" == 0 ]]
