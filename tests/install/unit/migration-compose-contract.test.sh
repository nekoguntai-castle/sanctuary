#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-contract-postgres-password}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-contract-redis-password}"
export JWT_SECRET="${JWT_SECRET:-contract-jwt-secret-with-enough-length}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-contract-encryption-key-with-enough-length}"
export ENCRYPTION_SALT="${ENCRYPTION_SALT:-contract-encryption-salt}"
export GATEWAY_SECRET="${GATEWAY_SECRET:-contract-gateway-secret}"
export WORKER_DIAGNOSTICS_SECRET="${WORKER_DIAGNOSTICS_SECRET:-contract-worker-diagnostics-secret-with-enough-length}"
export LLM_EGRESS_PROXY_SECRET="${LLM_EGRESS_PROXY_SECRET:-contract-llm-secret}"
export GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-contract-grafana-secret}"

assert_compose_contract() {
    local compose_file="$1"
    local rendered
    rendered="$(docker compose -f "$compose_file" --profile mcp config --format json)"

    COMPOSE_JSON="$rendered" node <<'NODE'
const config = JSON.parse(process.env.COMPOSE_JSON);
const services = config.services;
for (const consumer of ['backend', 'worker']) {
  const dependency = services[consumer]?.depends_on?.migrate;
  if (dependency?.condition !== 'service_completed_successfully') {
    throw new Error(`${consumer} must wait for successful migrations`);
  }
}
if (services.migrate?.depends_on?.backend) {
  throw new Error('migrate must not depend on backend');
}
const command = JSON.stringify(services.migrate?.command);
if (command !== JSON.stringify(['sh', '/app/scripts/migrate.sh'])) {
  throw new Error(`migrate must use the canonical script, got ${command}`);
}
if (!services.backend?.build) {
  throw new Error('local backend must remain the shared image build owner');
}
for (const consumer of ['worker', 'migrate']) {
  if (services[consumer]?.build) {
    throw new Error(`${consumer} must reuse rather than rebuild the backend image`);
  }
  if (services[consumer]?.image !== services.backend.image) {
    throw new Error(`${consumer} must reuse the backend image`);
  }
}
if (services.mcp?.environment?.WORKER_DIAGNOSTICS_SECRET !== process.env.WORKER_DIAGNOSTICS_SECRET) {
  throw new Error('mcp must receive the production diagnostics credential required by shared config');
}
NODE
}

assert_compose_contract "$PROJECT_ROOT/docker-compose.yml"

rendered_monitoring="$(docker compose \
    -f "$PROJECT_ROOT/docker-compose.yml" \
    -f "$PROJECT_ROOT/docker/compose/monitoring.yml" \
    config --format json)"

COMPOSE_JSON="$rendered_monitoring" node <<'NODE'
const config = JSON.parse(process.env.COMPOSE_JSON);
const services = config.services;
const migration = services['grafana-password-migration'];
const grafana = services.grafana;
if (grafana?.depends_on?.['grafana-password-migration']?.condition !== 'service_completed_successfully') {
  throw new Error('grafana must wait for successful credential migration');
}
if (grafana?.environment?.GF_SECURITY_ADMIN_PASSWORD !== process.env.GRAFANA_PASSWORD) {
  throw new Error('grafana must require the independent credential');
}
if (migration?.environment?.GRAFANA_PASSWORD !== process.env.GRAFANA_PASSWORD) {
  throw new Error('credential migration must receive the independent credential');
}
if (!JSON.stringify(migration).includes('migrate-grafana-password.sh')) {
  throw new Error('credential migration must invoke the reviewed migration script');
}
if (JSON.stringify({ migration, grafana }).includes(process.env.ENCRYPTION_KEY)) {
  throw new Error('monitoring services must not receive the encryption master key');
}
NODE

grep -Fq 'COPY --from=builder /repo/server/prisma ./prisma' "$PROJECT_ROOT/server/Dockerfile"
grep -Fq 'COPY --from=builder /repo/server/scripts ./scripts' "$PROJECT_ROOT/server/Dockerfile"

if grep -Fq "migrationService" "$PROJECT_ROOT/server/src/index.ts"; then
    echo "backend startup must not own or inspect migrations" >&2
    exit 1
fi

echo "Migration and Compose contracts passed"
