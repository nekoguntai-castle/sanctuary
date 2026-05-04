#!/usr/bin/env bash

sanctuary_default_gateway_ip() {
  local route_file="${SANCTUARY_PROC_ROUTE_FILE:-/proc/net/route}"
  local gateway_hex

  gateway_hex="$(awk '$2 == "00000000" { print $3; exit }' "$route_file" 2>/dev/null || true)"
  if [[ "$gateway_hex" =~ ^[0-9A-Fa-f]{8}$ ]]; then
    printf '%d.%d.%d.%d\n' \
      "$((16#${gateway_hex:6:2}))" \
      "$((16#${gateway_hex:4:2}))" \
      "$((16#${gateway_hex:2:2}))" \
      "$((16#${gateway_hex:0:2}))"
  fi
}

sanctuary_running_in_container() {
  case "${SANCTUARY_ASSUME_CONTAINERIZED:-}" in
    1)
      return 0
      ;;
    0)
      return 1
      ;;
  esac

  if [ -f /.dockerenv ] || [ -f /run/.containerenv ]; then
    return 0
  fi

  grep -Eiq '(docker|containerd|kubepods|libpod)' /proc/1/cgroup 2>/dev/null
}

sanctuary_default_docker_published_host() {
  local gateway_ip

  if sanctuary_running_in_container; then
    gateway_ip="$(sanctuary_default_gateway_ip)"
    if [ -n "$gateway_ip" ]; then
      printf '%s\n' "$gateway_ip"
      return
    fi
  fi

  printf '127.0.0.1\n'
}

sanctuary_docker_published_host_for_endpoint() {
  local endpoint="$1"
  local address
  local host

  case "$endpoint" in
    __default__|unix://*|npipe://*)
      sanctuary_default_docker_published_host
      ;;
    tcp://*|http://*|https://*)
      address="${endpoint#*://}"
      address="${address%%/*}"
      if [[ "$address" == \[*\]* ]]; then
        host="${address%%]*}"
        host="${host#[}"
      else
        host="${address%%:*}"
      fi
      if [ -n "$host" ]; then
        printf '%s\n' "$host"
      else
        printf '127.0.0.1\n'
      fi
      ;;
    *)
      printf '127.0.0.1\n'
      ;;
  esac
}

sanctuary_current_docker_published_host() {
  if [ -n "${SANCTUARY_DOCKER_PUBLISHED_HOST:-}" ]; then
    printf '%s\n' "$SANCTUARY_DOCKER_PUBLISHED_HOST"
    return
  fi

  if [ -n "${DOCKER_HOST:-}" ]; then
    sanctuary_docker_published_host_for_endpoint "$DOCKER_HOST"
    return
  fi

  printf '127.0.0.1\n'
}
