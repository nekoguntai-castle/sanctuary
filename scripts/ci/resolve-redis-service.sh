#!/usr/bin/env bash
# Resolve this job's Redis service through its runner-assigned published port.
# Forgejo v13 may omit that port, while shared DinD runners can expose several
# `redis` alias candidates on one bridge. The service health check installs a
# job-unique password, so the fallback probes every concrete alias IP and
# accepts exactly one authenticated candidate before exporting REDIS_URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

fail() {
  echo "resolve-redis-service: $*" >&2
  exit 1
}

is_containerized_runner() {
  case "${SANCTUARY_CONTAINERIZED_RUNNER:-auto}" in
    true) return 0 ;;
    false) return 1 ;;
    auto) [ -f /.dockerenv ] || [ -f /run/.containerenv ] ;;
    *) fail 'SANCTUARY_CONTAINERIZED_RUNNER must be true, false, or auto' ;;
  esac
}

published_host() {
  if ! is_containerized_runner; then
    printf '%s\n' localhost
    return
  fi

  if [ -n "${SANCTUARY_REDIS_GATEWAY:-}" ]; then
    printf '%s\n' "$SANCTUARY_REDIS_GATEWAY"
    return
  fi

  ip -4 route show default 2>/dev/null | awk '/default/ { print $3; exit }'
}

validate_port() {
  local port="$1"
  [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] \
    || fail 'REDIS_PORT must be an integer from 1 through 65535'
}

validate_password() {
  local password="$1"
  [[ "$password" =~ ^[A-Za-z0-9._-]{1,128}$ ]] \
    || fail 'REDIS_PASSWORD must contain 1 through 128 safe characters'
}

redis_url() {
  printf 'redis://:%s@%s:%s\n' "$1" "$2" "$3"
}

probe() {
  local host="$1"
  local port="$2"
  local password="$3"
  local timeout="${SANCTUARY_REDIS_PROBE_TIMEOUT_SECONDS:-10}"
  node "$SCRIPT_DIR/check-redis-service.mjs" \
    "$host" "$port" "$timeout" "$password"
}

service_alias_ips() {
  getent ahostsv4 redis 2>/dev/null \
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

select_alias_candidate() {
  local password="$1"
  local attempt ip
  local resolution_attempts="${SANCTUARY_REDIS_ALIAS_RESOLUTION_ATTEMPTS:-3}"
  local candidate_cap="${SANCTUARY_REDIS_ALIAS_CANDIDATE_CAP:-32}"
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
        [ "${#candidates[@]}" -le "$candidate_cap" ] \
          || fail 'Redis service alias exceeded the candidate safety cap'
      fi
    done < <(service_alias_ips)
    [ "$attempt" -eq "$resolution_attempts" ] || sleep 1
  done

  for ip in "${candidates[@]}"; do
    echo "resolve-redis-service: authenticating service candidate ${ip}:6379"
    if probe "$ip" 6379 "$password"; then
      matches+=("$ip")
    fi
  done

  [ "${#matches[@]}" -eq 1 ] \
    || fail "expected one authenticated Redis service candidate; found ${#matches[@]}"
  ci_emit_env "REDIS_URL=$(redis_url "$password" "${matches[0]}" 6379)"
  echo "resolve-redis-service: selected authenticated service endpoint ${matches[0]}:6379"
}

main() {
  [ "$(ci_env_file)" != /dev/stdout ] \
    || fail 'a CI environment file is required'

  local port="${REDIS_PORT:-}"
  local password="${REDIS_PASSWORD:-}"
  local host
  validate_password "$password"

  if [ -n "$port" ]; then
    validate_port "$port"
    host="$(published_host)"
    if [ -n "$host" ]; then
      echo "resolve-redis-service: authenticating published endpoint ${host}:${port}"
      if probe "$host" "$port" "$password"; then
        ci_emit_env "REDIS_URL=$(redis_url "$password" "$host" "$port")"
        echo "resolve-redis-service: selected published endpoint ${host}:${port}"
        return
      fi
      echo "::warning::resolve-redis-service: published Redis endpoint ${host}:${port} was not usable"
    fi
  fi

  select_alias_candidate "$password"
}

main "$@"
