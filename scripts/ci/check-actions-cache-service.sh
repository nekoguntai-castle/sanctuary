#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/provider-context.sh"

state_file="${CACHE_HEALTH_STATE_FILE:-}"

initialize_state_file() {
  local state_dir

  if [ -n "$state_file" ]; then
    return
  fi

  state_dir="$(ci_temp_dir)"
  mkdir -p "$state_dir"
  state_file="$(mktemp "$state_dir/sanctuary-cache-health.XXXXXX")"

  # The provider environment channel is scoped to the current job. Persisting
  # the generated path lets later wrapper invocations reuse the decision
  # without sharing matrix state.
  if [ "$(ci_env_file)" != /dev/stdout ]; then
    ci_emit_env "CACHE_HEALTH_STATE_FILE=$state_file"
  fi
}

write_output() {
  ci_emit_output "available=$1"
}

read_cached_state() {
  local state

  if [ ! -f "$state_file" ]; then
    return 1
  fi

  IFS= read -r state < "$state_file"
  case "$state" in
    available|unavailable)
      printf '%s\n' "$state"
      ;;
    *)
      return 1
      ;;
  esac
}

cache_endpoint_host_port() {
  local endpoint="$1"
  local scheme
  local authority
  local host
  local port

  if [[ ! "$endpoint" =~ ^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]+) ]]; then
    return 1
  fi

  scheme="${BASH_REMATCH[1],,}"
  authority="${BASH_REMATCH[2]}"
  authority="${authority##*@}"

  if [[ "$authority" =~ ^([A-Za-z0-9._-]+):([0-9]+)$ ]]; then
    host="${BASH_REMATCH[1]}"
    port="${BASH_REMATCH[2]}"
  elif [[ "$authority" =~ ^[A-Za-z0-9._-]+$ ]]; then
    host="$authority"
    case "$scheme" in
      http) port=80 ;;
      https) port=443 ;;
      *) return 1 ;;
    esac
  else
    return 1
  fi

  case "$scheme" in
    http|https) ;;
    *) return 1 ;;
  esac

  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    return 1
  fi

  printf '%s\n%s\n' "$host" "$port"
}

cache_endpoint_origin() {
  local endpoint="$1"
  local scheme
  local parsed
  local host
  local port

  if [[ ! "$endpoint" =~ ^([A-Za-z][A-Za-z0-9+.-]*):// ]]; then
    return 1
  fi
  scheme="${BASH_REMATCH[1],,}"
  parsed="$(cache_endpoint_host_port "$endpoint")" || return 1
  host="$(printf '%s\n' "$parsed" | sed -n '1p')"
  port="$(printf '%s\n' "$parsed" | sed -n '2p')"

  printf '%s://%s:%s/\n' "$scheme" "$host" "$port"
}

probe_cache_endpoint() {
  local endpoint="$1"
  local origin
  local status

  origin="$(cache_endpoint_origin "$endpoint")" || return 1
  status="$(
    curl --silent --show-error --output /dev/null \
      --connect-timeout 3 --max-time 5 --proto '=http,https' \
      --write-out '%{http_code}' "$origin" 2>/dev/null
  )" || return 1

  case "$status" in
    2??|404) return 0 ;;
    *) return 1 ;;
  esac
}

record_state() {
  local state="$1"

  mkdir -p "$(dirname "$state_file")"
  printf '%s\n' "$state" > "$state_file"
}

report_unavailable() {
  local message

  message='Skipping cache restore/save for this job; deterministic fallbacks remain enabled. Check the Actions runner cache service.'
  ci_emit_warning "Action cache unavailable: $message"
  if [ "$(ci_step_summary_file)" != /dev/stderr ]; then
    ci_emit_summary '### Action cache unavailable' '' "$message"
  fi
}

main() {
  local state
  local endpoint

  initialize_state_file

  if state="$(read_cached_state)"; then
    if [ "$state" = available ]; then
      write_output true
    else
      write_output false
    fi
    return
  fi

  endpoint="${ACTIONS_CACHE_URL:-}"
  if [ -z "$endpoint" ]; then
    # Cache actions cannot operate without their runtime URL. Treat a missing
    # contract as one contained outage so deterministic fallbacks still run.
    record_state unavailable
    write_output false
    report_unavailable
    return
  fi

  if probe_cache_endpoint "$endpoint"; then
    record_state available
    write_output true
    return
  fi

  record_state unavailable
  write_output false
  report_unavailable
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
