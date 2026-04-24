#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${2:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
OUTPUT_DIR="${1:?Usage: collect-upgrade-artifacts.sh <output-dir> [project-root]}"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/helpers.sh"

mkdir -p "$OUTPUT_DIR"

redact_env_file() {
    local env_file="$1"

    awk -F= '
        BEGIN { OFS="=" }
        /^[[:space:]]*#/ { print; next }
        NF == 0 { print; next }
        $1 ~ /(SECRET|PASSWORD|TOKEN|KEY)$/ { print $1, "<redacted>"; next }
        { print }
    ' "$env_file"
}

{
    echo "job_name=${SANCTUARY_UPGRADE_JOB_NAME:-manual}"
    echo "mode=${SANCTUARY_UPGRADE_TEST_MODE:-unknown}"
    echo "source_ref=${SANCTUARY_UPGRADE_SOURCE_REF_LABEL:-unknown}"
    echo "fixture=${SANCTUARY_UPGRADE_FIXTURE_LABEL:-unknown}"
    echo "compose_project=${COMPOSE_PROJECT_NAME:-unknown}"
    echo "project_root=$PROJECT_ROOT"
    echo "runtime_dir=${SANCTUARY_UPGRADE_RUNTIME_DIR:-unknown}"
} > "$OUTPUT_DIR/metadata.txt"

if [ -n "${SANCTUARY_UPGRADE_RUNTIME_DIR:-}" ] && [ -d "${SANCTUARY_UPGRADE_RUNTIME_DIR:-}" ]; then
    cp "${SANCTUARY_UPGRADE_RUNTIME_DIR}"/install-*.log "$OUTPUT_DIR/" 2>/dev/null || true
fi

if [ -n "${SANCTUARY_ENV_FILE:-}" ] && [ -f "${SANCTUARY_ENV_FILE:-}" ]; then
    redact_env_file "$SANCTUARY_ENV_FILE" > "$OUTPUT_DIR/runtime-env.txt"
elif [ -f "$PROJECT_ROOT/.env" ]; then
    redact_env_file "$PROJECT_ROOT/.env" > "$OUTPUT_DIR/runtime-env.txt"
fi

docker compose -f "$PROJECT_ROOT/docker-compose.yml" ps > "$OUTPUT_DIR/docker-compose-ps.txt" 2>&1 || true
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' > "$OUTPUT_DIR/docker-ps.txt" 2>&1 || true

for service in postgres backend worker frontend gateway migrate; do
    compose_logs "$service" 200 > "$OUTPUT_DIR/${service}.log" 2>&1 || true
done

for container in \
    "${GRAFANA_CONTAINER_NAME:-sanctuary-grafana}" \
    "${PROMETHEUS_CONTAINER_NAME:-sanctuary-prometheus}" \
    "${LOKI_CONTAINER_NAME:-sanctuary-loki}" \
    "${PROMTAIL_CONTAINER_NAME:-sanctuary-promtail}" \
    "${ALERTMANAGER_CONTAINER_NAME:-sanctuary-alertmanager}" \
    "${JAEGER_CONTAINER_NAME:-sanctuary-jaeger}" \
    sanctuary-tor
do
    if docker inspect "$container" >/dev/null 2>&1; then
        docker logs --tail 200 "$container" > "$OUTPUT_DIR/${container}.log" 2>&1 || true
    fi
done

if "$PROJECT_ROOT/scripts/support-package.sh" "$OUTPUT_DIR/support-package.json" > "$OUTPUT_DIR/support-package.stdout" 2> "$OUTPUT_DIR/support-package.stderr"; then
    :
else
    rm -f "$OUTPUT_DIR/support-package.json"
fi
