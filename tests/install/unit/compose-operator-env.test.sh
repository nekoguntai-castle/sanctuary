#!/usr/bin/env bash
# Guard: operator settings documented in config/env/.env.example, the
# operations runbooks or README.md's ```env blocks, and read by server/src or gateway/src, must reach the
# container that reads them. docker-compose.yml has no env_file, so a key that is
# not listed in a service's `environment:` block is silently ignored there.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE="$ROOT_DIR/docker-compose.yml"
START_SH="$ROOT_DIR/start.sh"
ENV_EXAMPLE="$ROOT_DIR/config/env/.env.example"
RUNBOOK="$ROOT_DIR/docs/how-to/operations-runbooks.md"
README="$ROOT_DIR/README.md"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Keys deliberately NOT forwarded by compose, with the reason.
#   PRICE_PROVIDERS_ENABLED / PRICE_PROVIDERS_DISABLED: bootstrap-only legacy
#     keys. hasLegacyPriceProviderEnv tests `!== undefined`, so an empty value
#     delivered by compose would switch provider bootstrap on and log a
#     deprecation on every boot.
#   GRAFANA_PASSWORD: an independent credential only the monitoring overlay
#     receives (#770); the backend would return it from getGrafanaConfig.
#   COMPOSE_PROJECT_NAME: read by compose itself and by test tooling.
#   AUTH_CSRF_SESSION_STALE: an error-code string, not an environment setting.
EXEMPT_KEYS=(
  PRICE_PROVIDERS_ENABLED
  PRICE_PROVIDERS_DISABLED
  GRAFANA_PASSWORD
  COMPOSE_PROJECT_NAME
  AUTH_CSRF_SESSION_STALE
)

# service|KEY|compose default (equal to the server default; the server parsers
# treat '' as unset, so these only make the effective value explicit).
REQUIRED_FORWARDS=(
  'backend|CORS_ALLOWED_ORIGINS|'
  'backend|RATE_LIMIT_API_DEFAULT|1000'
  'backend|JWT_REFRESH_EXPIRES_IN|7d'
  'backend|AUDIT_LOG_RETENTION_DAYS|90'
  'backend|PRICE_DATA_RETENTION_DAYS|30'
  'backend|FEE_ESTIMATE_RETENTION_DAYS|7'
  'backend|DISK_WARNING_THRESHOLD_PERCENT|80'
  'backend|SLOW_QUERY_THRESHOLD_MS|50'
  'backend|WORKER_HEALTH_TIMEOUT_MS|3000'
  'backend|WORKER_HEALTH_CHECK_INTERVAL_MS|10000'
  'backend|WORKER_DIAGNOSTICS_TIMEOUT_MS|3000'
  'backend|GRAFANA_PORT|3000'
  'backend|PROMETHEUS_PORT|9090'
  'backend|JAEGER_UI_PORT|16686'
  'worker|AUDIT_LOG_RETENTION_DAYS|90'
  'worker|PRICE_DATA_RETENTION_DAYS|30'
  'worker|FEE_ESTIMATE_RETENTION_DAYS|7'
  'worker|DISK_WARNING_THRESHOLD_PERCENT|80'
  'worker|SLOW_QUERY_THRESHOLD_MS|50'
  # endpointPolicy.ts reads these in the backend (the Test route) and in the
  # worker (deliveries), so each must reach both services.
  'backend|WEBHOOK_ALLOW_HTTP|'
  'backend|WEBHOOK_ALLOWED_HOSTS|'
  'backend|WEBHOOK_ALLOWED_CIDRS|'
  'worker|WEBHOOK_ALLOW_HTTP|'
  'worker|WEBHOOK_ALLOWED_HOSTS|'
  'worker|WEBHOOK_ALLOWED_CIDRS|'
  'gateway|CORS_ALLOWED_ORIGINS|'
  # Only the gateway holds APNs/FCM credentials. The worker hands insight and
  # consolidation pushes to it over the gateway-only Redis channel and the
  # backend forwards them, so both need the gateway secret.
  'backend|GATEWAY_SECRET|'
  'worker|GATEWAY_SECRET|'
  # mcp runs the backend image; models/prisma.ts reads this at runtime. The
  # other forwarded settings (CORS, rate limits, retention, worker health,
  # monitoring ports) are not read by its startup path.
  'mcp|SLOW_QUERY_THRESHOLD_MS|50'
)

# Compose service -> the `KEY: value` lines of its `environment:` block.
compose_env() {
  awk '
    /^  [a-z][a-z0-9-]*:[[:space:]]*$/ { svc = $1; sub(":", "", svc); inenv = 0; next }
    /^    environment:[[:space:]]*$/ { inenv = 1; next }
    /^    [A-Za-z_]+:/ { inenv = 0 }
    inenv && /^      [A-Z][A-Z0-9_]*:/ { print svc "|" substr($0, 7) }
  ' "$COMPOSE"
}

COMPOSE_ENV="$(compose_env)"

is_exempt() {
  local key="$1" exempt
  for exempt in "${EXEMPT_KEYS[@]}"; do
    [ "$exempt" != "$key" ] || return 0
  done
  return 1
}

# True when server/src or gateway/src reads KEY from the environment (a plain
# quoted string such as an error code does not count).
is_env_read() {
  local key="$1"
  grep -rqE --include='*.ts' \
    -e "process\.env\.${key}\b" \
    -e "process\.env\[['\"]${key}['\"]" \
    -e "Env[A-Za-z]*\(\s*\[?['\"]${key}['\"]" \
    "$ROOT_DIR/server/src" "$ROOT_DIR/gateway/src"
}

is_read_by_runtime() {
  local key="$1"
  is_env_read "$key" && return 0
  grep -qw -e "$key" "$COMPOSE" "$START_SH" && return 0
  grep -rqw -e "$key" "$ROOT_DIR/docker" 2>/dev/null
}

# 1. Every pinned key is forwarded to the service that reads it, with the
#    server-default value, and exported by start.sh.
for entry in "${REQUIRED_FORWARDS[@]}"; do
  case "$entry" in '#'*) continue ;; esac
  IFS='|' read -r service key default <<< "$entry"
  line="$(printf '%s\n' "$COMPOSE_ENV" | sed -n "s/^${service}|${key}: //p" | head -1)"
  [ -n "$line" ] || fail "docker-compose.yml service '$service' does not forward $key"
  expected="\${${key}:-${default}}"
  [ "$line" = "$expected" ] || fail "service '$service' $key is '$line', expected '$expected'"
  grep -E "^export (.* )?${key}( |\$)" "$START_SH" >/dev/null \
    || fail "start.sh does not export $key"
done

# 2. Exempt keys stay out of the services they must not reach.
for key in PRICE_PROVIDERS_ENABLED PRICE_PROVIDERS_DISABLED GRAFANA_PASSWORD; do
  ! printf '%s\n' "$COMPOSE_ENV" | grep -q "^[a-z-]*|${key}:" \
    || fail "$key must not be forwarded to a runtime service (see exemption list)"
done

# 3. Every documented key that server/src or gateway/src reads appears in some
#    service's environment, unless it is a commented exemption. Documented keys
#    come from the env example (commented or not), backticked runbook names and
#    the KEY= lines of README.md's ```env blocks.
documented_keys() {
  grep -ohE '^#? ?[A-Z][A-Z0-9_]+=' "$ENV_EXAMPLE" | tr -d '# =' || true
  grep -ohE '`[A-Z][A-Z0-9_]+`' "$RUNBOOK" | tr -d '`' || true
  awk '/^```env[[:space:]]*$/ { inenv = 1; next } /^```/ { inenv = 0 } inenv' "$README" \
    | grep -oE '^[A-Z][A-Z0-9_]+=' | tr -d '=' || true
}

while IFS= read -r key; do
  [ -n "$key" ] || continue
  is_exempt "$key" && continue
  is_env_read "$key" || continue
  printf '%s\n' "$COMPOSE_ENV" | grep -q "^[a-z-]*|${key}:" \
    || grep -qE "\\\$\{${key}[:}-]" "$COMPOSE" \
    || fail "documented setting $key is read by the runtime but docker-compose.yml never forwards it"
done < <(documented_keys | sort -u)

# 4. Every key documented in the env example is read by something (a removed or
#    misspelled key, such as ELECTRUM_SSL, would silently do nothing).
while IFS= read -r key; do
  [ -n "$key" ] || continue
  is_exempt "$key" && continue
  is_read_by_runtime "$key" || fail "$ENV_EXAMPLE documents $key but nothing reads it"
done < <(grep -ohE '^#? ?[A-Z][A-Z0-9_]+=' "$ENV_EXAMPLE" | tr -d '# =' | sort -u)

# 5. The env example no longer claims compose defaults the legacy price keys.
! grep -q 'Compose defaults PRICE_PROVIDERS' "$ENV_EXAMPLE" \
  || fail "$ENV_EXAMPLE still claims Compose defaults PRICE_PROVIDERS_DISABLED"

# 6. The gateway runbook names the compose variable that tunes the gateway.
! grep -q 'tune `RATE_LIMIT_MAX`' "$RUNBOOK" \
  || fail "runbook tells operators to set RATE_LIMIT_MAX, which compose does not read (use GATEWAY_RATE_LIMIT_MAX)"

echo "compose-operator-env checks passed"
