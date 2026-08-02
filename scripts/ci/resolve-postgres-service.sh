#!/usr/bin/env bash
# Resolve a workflow Postgres service without relying on a shared Docker DNS
# alias. Forgejo runner jobs can share one DinD bridge; the generic `postgres`
# alias may therefore point at another job's service. Prefer the runner-assigned
# published port and prove it with a real authenticated query before exporting
# DATABASE_URL. Retain provider-portable fallbacks for VM runners and isolated
# service networks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

fail() {
  echo "resolve-postgres-service: $*" >&2
  exit 1
}

is_containerized_runner() {
  case "${SANCTUARY_CONTAINERIZED_RUNNER:-auto}" in
    true) return 0 ;;
    false) return 1 ;;
    auto) [ -f /.dockerenv ] ;;
    *) fail 'SANCTUARY_CONTAINERIZED_RUNNER must be true, false, or auto' ;;
  esac
}

published_host() {
  if ! is_containerized_runner; then
    printf '%s\n' localhost
    return
  fi

  if [ -n "${SANCTUARY_POSTGRES_GATEWAY:-}" ]; then
    printf '%s\n' "$SANCTUARY_POSTGRES_GATEWAY"
    return
  fi

  ip -4 route show default 2>/dev/null | awk '/default/ { print $3; exit }'
}

database_url() {
  local host="$1"
  local port="$2"
  local user="${POSTGRES_USER:-test}"
  local password="${POSTGRES_PASSWORD:-test}"
  local database="${POSTGRES_DB:-sanctuary_test}"
  printf 'postgresql://%s:%s@%s:%s/%s?schema=public\n' \
    "$user" "$password" "$host" "$port" "$database"
}

probe() {
  local candidate_url="$1"
  local check timeout
  check="$SCRIPT_DIR/check-integration-db.mjs"
  timeout="${SANCTUARY_POSTGRES_PROBE_TIMEOUT_SECONDS:-10}"

  (
    export DATABASE_URL="$candidate_url"
    unset TEST_DATABASE_URL
    node "$check" wait "--timeout=$timeout"
  )
}

select_candidate() {
  local label="$1"
  local host="$2"
  local port="$3"
  local candidate_url
  candidate_url="$(database_url "$host" "$port")"

  echo "resolve-postgres-service: probing ${label} endpoint ${host}:${port}"
  if probe "$candidate_url"; then
    ci_emit_env "DATABASE_URL=$candidate_url"
    echo "resolve-postgres-service: selected ${label} endpoint ${host}:${port}"
    return 0
  fi

  echo "::warning::resolve-postgres-service: ${label} endpoint ${host}:${port} was not usable"
  return 1
}

main() {
  [ "$(ci_env_file)" != /dev/stdout ] \
    || fail 'a CI environment file is required'

  if [ -n "${POSTGRES_PORT:-}" ]; then
    local host
    host="$(published_host)"
    if [ -n "$host" ] && select_candidate published "$host" "$POSTGRES_PORT"; then
      return
    fi
  fi

  if getent hosts postgres >/dev/null 2>&1 \
    && select_candidate service-alias postgres 5432; then
    return
  fi

  if select_candidate localhost localhost "${POSTGRES_PORT:-5432}"; then
    return
  fi

  fail 'no usable Postgres service endpoint was found'
}

main "$@"
