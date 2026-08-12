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
for (const key of [
  'SANCTUARY_GRAFANA_QUIESCENCE_TOKEN',
  'SANCTUARY_GRAFANA_QUIESCENCE_PROJECT',
  'SANCTUARY_GRAFANA_DATA_VOLUME',
  'SANCTUARY_GRAFANA_CONTROL_VOLUME',
  'SANCTUARY_GRAFANA_QUIESCENCE_CONTAINER_ID',
  'SANCTUARY_GRAFANA_QUIESCENCE_GENERATION',
]) {
  if (!(key in (migration?.environment ?? {}))) {
    throw new Error(`credential migration must receive scoped quiescence field ${key}`);
  }
}
const migrationMounts = JSON.stringify(migration?.volumes ?? []);
if (!migrationMounts.includes('/var/lib/sanctuary-grafana-control')) {
  throw new Error('credential migration must mount the daemon-owned quiescence control volume');
}
if (!migrationMounts.includes('grafana_quiescence')) {
  throw new Error('credential migration must use the project-scoped Grafana control volume');
}
if ((migration?.image ?? '') !== 'sanctuary-grafana-migration:local') {
  throw new Error('credential migration must use the packaged Sanctuary image');
}
if (!migration?.build || !JSON.stringify(migration.build).includes('docker/grafana-migration/Dockerfile')) {
  throw new Error('credential migration must build from the reviewed packaged artifact');
}
if (migrationMounts.includes('bind') || migrationMounts.includes('/proc/') || migrationMounts.includes('scripts/ops')) {
  throw new Error('credential migration must not depend on client-host bind mounts');
}
if (JSON.stringify({ migration, grafana }).includes(process.env.ENCRYPTION_KEY)) {
  throw new Error('monitoring services must not receive the encryption master key');
}
NODE

remote_only_client_path="/client-only/sanctuary-checkout-not-visible-to-daemon"
rendered_remote_monitoring="$(SANCTUARY_PROJECT_DIR="$remote_only_client_path" docker compose \
    -f "$PROJECT_ROOT/docker-compose.yml" \
    -f "$PROJECT_ROOT/docker/compose/monitoring.yml" \
    config --format json)"
COMPOSE_JSON="$rendered_remote_monitoring" REMOTE_CLIENT_PATH="$remote_only_client_path" node <<'NODE'
const config = JSON.parse(process.env.COMPOSE_JSON);
const migration = config.services['grafana-password-migration'];
if (migration.build?.context !== process.env.REMOTE_CLIENT_PATH) {
  throw new Error('rendered remote-daemon proof did not retain the client-only build context');
}
for (const mount of migration.volumes ?? []) {
  if (mount.type !== 'volume') {
    throw new Error('remote-daemon migration must use only daemon-owned named volumes');
  }
  if (JSON.stringify(mount).includes(process.env.REMOTE_CLIENT_PATH)) {
    throw new Error('client checkout path leaked into a daemon-side migration mount');
  }
}
NODE

grep -Fq 'run-grafana-password-migration.sh' "$PROJECT_ROOT/scripts/setup.sh"
grep -Fq 'run-grafana-password-migration.sh' "$PROJECT_ROOT/start.sh"
grep -Fq -- '--pull never' "$PROJECT_ROOT/scripts/ops/run-grafana-password-migration.sh"
grep -Fq 'grafana_quiescence' "$PROJECT_ROOT/scripts/ops/run-grafana-password-migration.sh"
test -r "$PROJECT_ROOT/scripts/ops/grafana-quiescence-records.sh"
grep -Fq 'source "$script_dir/grafana-quiescence-records.sh"' \
    "$PROJECT_ROOT/scripts/ops/run-grafana-password-migration.sh"
grep -Fq 'org.sanctuary.grafana-migration.script-sha256' \
    "$PROJECT_ROOT/docker/grafana-migration/Dockerfile"
script_digest="$(sha256sum "$PROJECT_ROOT/scripts/ops/migrate-grafana-password.sh" | awk '{print $1}')"
grep -Fq "script-sha256=\"$script_digest\"" \
    "$PROJECT_ROOT/docker/grafana-migration/Dockerfile"
if grep -Eq '/proc/|OWNER_PID|OWNER_START_TIME|SANCTUARY_GRAFANA_QUIESCENCE_DIR' \
    "$PROJECT_ROOT/scripts/ops/run-grafana-password-migration.sh" \
    "$PROJECT_ROOT/scripts/ops/migrate-grafana-password.sh" \
    "$PROJECT_ROOT/docker/compose/monitoring.yml"; then
    echo "Grafana migration must not depend on client PID or host quiescence paths" >&2
    exit 1
fi
if grep -Fq 'SANCTUARY_TEST_GRAFANA_CANONICAL_LOCK_DIR' \
    "$PROJECT_ROOT/scripts/ops/run-grafana-password-migration.sh" \
    "$PROJECT_ROOT/docker/compose/monitoring.yml"; then
    echo "the production canonical Grafana lock path must not be caller-overridable" >&2
    exit 1
fi
if grep -Fq 'stop grafana >/dev/null 2>&1 || true' "$PROJECT_ROOT/scripts/setup.sh" \
    || grep -Fq 'stop grafana >/dev/null 2>&1 || true' "$PROJECT_ROOT/start.sh"; then
    echo "Grafana stop failures must abort supported startup" >&2
    exit 1
fi

grep -Fq 'COPY --chown=sanctuary:nodejs --from=builder /repo/server/prisma ./prisma' "$PROJECT_ROOT/server/Dockerfile"
grep -Fq 'COPY --chown=sanctuary:nodejs --from=builder /repo/server/scripts ./scripts' "$PROJECT_ROOT/server/Dockerfile"
grep -Fq 'npm prune --omit=dev --include-workspace-root --ignore-scripts --audit=false --fund=false' \
    "$PROJECT_ROOT/server/Dockerfile"
if grep -Fq 'chown -R sanctuary:nodejs /app' "$PROJECT_ROOT/server/Dockerfile"; then
    echo "backend image must assign runtime ownership during COPY, not rescan /app" >&2
    exit 1
fi
runtime_owned_copy_count="$(grep -c '^COPY --chown=sanctuary:nodejs --from=builder' "$PROJECT_ROOT/server/Dockerfile")"
if [ "$runtime_owned_copy_count" -ne 9 ]; then
    echo "expected all 9 backend runtime copies to set sanctuary ownership, found $runtime_owned_copy_count" >&2
    exit 1
fi

if grep -Fq "migrationService" "$PROJECT_ROOT/server/src/index.ts"; then
    echo "backend startup must not own or inspect migrations" >&2
    exit 1
fi

echo "Migration and Compose contracts passed"
