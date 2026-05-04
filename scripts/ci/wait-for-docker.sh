#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/docker-endpoint-lib.sh
source "$script_dir/docker-endpoint-lib.sh"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/wait-for-docker.sh

Waits for Docker and Docker Compose to become available in CI job containers.
EOF
}

fail() {
  echo "wait-for-docker: $*" >&2
  exit 1
}

require_non_negative_integer() {
  local name="$1"
  local value="$2"

  case "$value" in
    ''|*[!0-9]*)
      fail "${name} must be a non-negative integer"
      ;;
  esac
}

docker_ready() {
  local endpoint="$1"

  if [ "$endpoint" = "__default__" ]; then
    env -u DOCKER_HOST docker version >/dev/null 2>&1 &&
      env -u DOCKER_HOST docker compose version >/dev/null 2>&1
    return "$?"
  fi

  DOCKER_HOST="$endpoint" docker version >/dev/null 2>&1 &&
    DOCKER_HOST="$endpoint" docker compose version >/dev/null 2>&1
}

add_candidate() {
  local candidate="$1"
  local existing

  for existing in "${docker_candidates[@]}"; do
    [ "$existing" = "$candidate" ] && return 0
  done
  docker_candidates+=("$candidate")
}

collect_candidates() {
  local gateway_ip

  docker_candidates=()

  if [ -n "${DOCKER_HOST:-}" ]; then
    add_candidate "$DOCKER_HOST"
  fi

  add_candidate "__default__"

  if [ -S /var/run/docker.sock ]; then
    add_candidate "unix:///var/run/docker.sock"
  fi
  if [ -S /run/docker.sock ]; then
    add_candidate "unix:///run/docker.sock"
  fi

  add_candidate "tcp://docker-in-docker:2375"
  add_candidate "tcp://localhost:2375"
  add_candidate "tcp://127.0.0.1:2375"
  add_candidate "tcp://host.docker.internal:2375"
  gateway_ip="$(sanctuary_default_gateway_ip)"
  if [ -n "$gateway_ip" ]; then
    add_candidate "tcp://${gateway_ip}:2375"
  fi
}

activate_candidate() {
  local endpoint="$1"
  local env_file="${SANCTUARY_DOCKER_ENV_FILE:-${GITHUB_ENV:-}}"
  local published_host

  published_host="$(sanctuary_docker_published_host_for_endpoint "$endpoint")"
  export SANCTUARY_DOCKER_PUBLISHED_HOST="$published_host"

  if [ "$endpoint" = "__default__" ]; then
    unset DOCKER_HOST
    if [ -n "$env_file" ]; then
      echo "DOCKER_HOST=" >> "$env_file"
      echo "SANCTUARY_DOCKER_PUBLISHED_HOST=$published_host" >> "$env_file"
    fi
    return 0
  fi

  export DOCKER_HOST="$endpoint"
  if [ -n "$env_file" ]; then
    echo "DOCKER_HOST=$endpoint" >> "$env_file"
    echo "SANCTUARY_DOCKER_PUBLISHED_HOST=$published_host" >> "$env_file"
  fi
}

main() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    usage
    exit 0
  fi
  if [ "$#" -gt 0 ]; then
    usage
    fail "unknown option: $1"
  fi

  local timeout="${SANCTUARY_DOCKER_WAIT_SECONDS:-120}"
  local interval="${SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS:-3}"
  require_non_negative_integer SANCTUARY_DOCKER_WAIT_SECONDS "$timeout"
  require_non_negative_integer SANCTUARY_DOCKER_WAIT_INTERVAL_SECONDS "$interval"

  local deadline=$((SECONDS + timeout))
  local attempt=1
  local docker_candidates=()
  local endpoint

  while true; do
    collect_candidates
    for endpoint in "${docker_candidates[@]}"; do
      if docker_ready "$endpoint"; then
        activate_candidate "$endpoint"
        echo "Docker daemon is available"
        docker --version
        docker compose version
        return 0
      fi
    done

    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "::error::Docker did not become available within ${timeout}s"
      echo "::error::Tried ${#docker_candidates[@]} Docker endpoint candidate(s)"
      docker --version || true
      docker compose version || true
      return 1
    fi

    echo "Waiting for Docker to become available, attempt ${attempt}"
    attempt=$((attempt + 1))
    sleep "$interval"
  done
}

main "$@"
