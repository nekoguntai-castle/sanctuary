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
  local timeout_override="${2:-}"
  local check timeout
  check="$SCRIPT_DIR/check-integration-db.mjs"
  timeout="${timeout_override:-${SANCTUARY_POSTGRES_PROBE_TIMEOUT_SECONDS:-10}}"

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
  local timeout_override="${4:-}"
  local candidate_url
  candidate_url="$(database_url "$host" "$port")"

  echo "resolve-postgres-service: probing ${label} endpoint ${host}:${port}"
  if probe "$candidate_url" "$timeout_override"; then
    ci_emit_env "DATABASE_URL=$candidate_url"
    echo "resolve-postgres-service: selected ${label} endpoint ${host}:${port}"
    return 0
  fi

  echo "::warning::resolve-postgres-service: ${label} endpoint ${host}:${port} was not usable"
  return 1
}

service_alias_ips() {
  getent ahostsv4 postgres 2>/dev/null \
    | awk '$2 == "STREAM" && !seen[$1]++ { print $1 }'
}

is_ipv4() {
  local address="$1"
  local octet
  local -a octets

  [[ "$address" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || return 1
  IFS=. read -r -a octets <<< "$address"
  for octet in "${octets[@]}"; do
    [ "$octet" -le 255 ] || return 1
  done
}

select_service_container() {
  local attempt ip
  local candidate_timeout="${SANCTUARY_POSTGRES_ALIAS_PROBE_TIMEOUT_SECONDS:-2}"
  local resolution_attempts="${SANCTUARY_POSTGRES_ALIAS_RESOLUTION_ATTEMPTS:-3}"
  local candidate_cap="${SANCTUARY_POSTGRES_ALIAS_CANDIDATE_CAP:-32}"
  local -a candidates=()
  local -a matches=()
  local -A seen=()

  for attempt in $(seq 1 "$resolution_attempts"); do
    while IFS= read -r ip; do
      [ -n "$ip" ] || continue
      is_ipv4 "$ip" || continue
      if [ -z "${seen[$ip]:-}" ]; then
        seen[$ip]=1
        candidates+=("$ip")
        if [ "${#candidates[@]}" -gt "$candidate_cap" ]; then
          fail 'Postgres service alias resolved beyond the candidate safety cap'
        fi
      fi
    done < <(service_alias_ips)

    [ "$attempt" -eq "$resolution_attempts" ] || sleep 1
  done

  for ip in "${candidates[@]}"; do
    echo "resolve-postgres-service: authenticating service candidate ${ip}:5432"
    if probe "$(database_url "$ip" 5432)" "$candidate_timeout"; then
      matches+=("$ip")
    fi
  done

  if [ "${#matches[@]}" -ne 1 ]; then
    echo "::warning::resolve-postgres-service: expected one authenticated service candidate; found ${#matches[@]}"
    return 1
  fi

  ci_emit_env "DATABASE_URL=$(database_url "${matches[0]}" 5432)"
  echo "resolve-postgres-service: selected authenticated service endpoint ${matches[0]}:5432"
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

  # Shared Forgejo DinD runners may attach several jobs' services to one
  # bridge. Docker DNS then returns several containers for the same `postgres`
  # alias and may rotate between them on separate connections. Probe each
  # concrete address with this job's unique service credentials, then pin the
  # selected IP in DATABASE_URL so migrations and tests cannot switch targets.
  if is_containerized_runner; then
    select_service_container \
      || fail 'no unique authenticated Postgres service endpoint was found'
    return
  elif select_service_container; then
    return
  fi

  if select_candidate localhost localhost "${POSTGRES_PORT:-5432}"; then
    return
  fi

  fail 'no usable Postgres service endpoint was found'
}

main "$@"
