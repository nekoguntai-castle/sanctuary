#!/bin/bash
# Collect diagnostics for failed upgrade runs.

artifact_log() {
    echo "[upgrade-artifacts] $*"
}

redact_stream() {
    awk '
    {
        line = $0
        while (match(line, /[A-Za-z0-9_]*(SECRET|PASSWORD|TOKEN|KEY|SALT|COOKIE|CREDENTIAL)[A-Za-z0-9_]*=[^[:space:]|",;<]+/)) {
            token = substr(line, RSTART, RLENGTH)
            key = token
            sub(/=.*/, "", key)
            line = substr(line, 1, RSTART - 1) key "=<redacted>" substr(line, RSTART + RLENGTH)
        }
        while (match(line, /"[A-Za-z0-9_]*(SECRET|PASSWORD|TOKEN|KEY|SALT|COOKIE|CREDENTIAL)[A-Za-z0-9_]*"[[:space:]]*:[[:space:]]*"[^"<]*"/)) {
            token = substr(line, RSTART, RLENGTH)
            sub(/:[[:space:]]*"[^"]*"$/, ": \"<redacted>\"", token)
            line = substr(line, 1, RSTART - 1) token substr(line, RSTART + RLENGTH)
        }
        while (match(line, /(Authorization|authorization|Cookie|cookie|X-CSRF-Token|x-csrf-token):[[:space:]]*[^[:space:]",;<]+/)) {
            token = substr(line, RSTART, RLENGTH)
            sub(/:.*/, ": <redacted>", token)
            line = substr(line, 1, RSTART - 1) token substr(line, RSTART + RLENGTH)
        }
        print line
    }'
}

redact_file() {
    local input_file="$1"
    local output_file="$2"

    if [ ! -f "$input_file" ]; then
        echo "File not found: $input_file" > "$output_file"
        return 0
    fi

    redact_stream < "$input_file" > "$output_file"
}

write_container_inspect_summary() {
    local container="$1"
    local output_file="$2"

    docker inspect --format \
'name={{.Name}}
image={{.Config.Image}}
state={{.State.Status}}
running={{.State.Running}}
exit_code={{.State.ExitCode}}
started_at={{.State.StartedAt}}
finished_at={{.State.FinishedAt}}
restart_count={{.RestartCount}}
health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' \
        "$container" > "$output_file" 2>&1 || true
}

write_redacted_env() {
    local env_file="$1"
    local output_file="$2"

    if [ ! -f "$env_file" ]; then
        echo "Runtime env file not found: $env_file" > "$output_file"
        return 0
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            ""|\#*)
                printf '%s\n' "$line"
                ;;
            *=*)
                local key="${line%%=*}"
                local value="${line#*=}"
                if [[ "$key" =~ (SECRET|PASSWORD|TOKEN|KEY|SALT|COOKIE|CREDENTIAL) ]]; then
                    printf '%s=<redacted:length=%s>\n' "$key" "${#value}"
                else
                    printf '%s\n' "$line"
                fi
                ;;
            *)
                printf '%s\n' "$line"
                ;;
        esac
    done < "$env_file" > "$output_file"
}

collect_upgrade_artifacts() {
    local output_dir="$1"
    local project_root="$2"
    local runtime_dir="$3"
    local env_file="$4"
    local source_ref="$5"
    local target_ref="$6"
    local fixture="$7"
    local mode="$8"
    local project="${COMPOSE_PROJECT_NAME:-sanctuary}"

    mkdir -p "$output_dir/logs" "$output_dir/install"

    {
        echo "created_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        echo "project_root=$project_root"
        echo "runtime_dir=$runtime_dir"
        echo "env_file=$env_file"
        echo "compose_project=$project"
        echo "source_ref=$source_ref"
        echo "target_ref=$target_ref"
        echo "fixture=$fixture"
        echo "mode=$mode"
    } > "$output_dir/metadata.txt"

    write_redacted_env "$env_file" "$output_dir/runtime-env.redacted"

    docker ps -a --filter "name=${project}-" \
        --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" \
        > "$output_dir/docker-ps.txt" 2>&1 || true

    if [ -f "$project_root/docker-compose.yml" ]; then
        docker compose -f "$project_root/docker-compose.yml" ps -a \
            > "$output_dir/docker-compose-ps.txt" 2>&1 || true
    fi

    for service in postgres redis backend worker migrate frontend gateway ai; do
        local container
        container=$(docker ps -a --filter "name=^/${project}-${service}-[0-9]+$" --format '{{.Names}}' | head -n 1)
        if [ -n "$container" ]; then
            docker logs --tail 300 "$container" 2>&1 | redact_stream > "$output_dir/logs/${service}.log" || true
            write_container_inspect_summary "$container" "$output_dir/logs/${service}.inspect.txt"
        fi
    done

    if [ -d "$runtime_dir" ]; then
        local install_log
        for install_log in "$runtime_dir"/install-*.log; do
            [ -e "$install_log" ] || continue
            redact_file "$install_log" "$output_dir/install/$(basename "$install_log")"
        done
    fi

    artifact_log "Artifacts written to $output_dir"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    if [ "$#" -lt 8 ]; then
        echo "Usage: $0 OUT_DIR PROJECT_ROOT RUNTIME_DIR ENV_FILE SOURCE_REF TARGET_REF FIXTURE MODE" >&2
        exit 2
    fi

    collect_upgrade_artifacts "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8"
fi
