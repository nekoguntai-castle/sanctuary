#!/usr/bin/env bash
#
# Compose bind mounts whose SOURCE is a host path must be parameterised, because
# the correct value differs by container engine:
#
#   Docker           /var/run/docker.sock          /var/lib/docker/containers
#   rootless Podman  /run/user/<uid>/podman/...    ~/.local/share/containers/...
#
# This matters more than a normal portability nit because a bind mount whose
# source does not exist is auto-created as a DIRECTORY. The container then
# receives a directory where it expects a socket. docker-proxy has no
# healthcheck and no install test exercises it, so on the Podman runners this
# broke silently and the gate stayed green (see #676). promtail in the
# monitoring overlay is more exposed still: it mounts both the socket and the
# containers directory, and it runs in the optional-profiles lane.
#
# The container-side path stays /var/run/docker.sock in every case, so nothing
# inside the images changes and operator installs keep the Docker default.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

PASS=0
FAILURES=()

check() {
  local description="$1"
  shift
  if "$@"; then
    PASS=$((PASS + 1))
    printf 'PASS: %s\n' "$description"
  else
    FAILURES+=("$description")
    printf 'FAIL: %s\n' "$description" >&2
  fi
}

# A mount line is "hardcoded" when the text left of the first colon is a literal
# host path rather than a ${VAR:-default} expansion.
no_hardcoded_host_source() {
  local file="$1" needle="$2" offenders
  [ -f "$PROJECT_ROOT/$file" ] || return 0
  offenders="$(grep -nE "^[[:space:]]*-[[:space:]]*${needle}:" "$PROJECT_ROOT/$file" || true)"
  if [ -n "$offenders" ]; then
    printf '%s: hardcoded host path as a mount source:\n%s\n' "$file" "$offenders" >&2
    return 1
  fi
  return 0
}

parameterised() {
  local file="$1" var="$2"
  grep -q "\${${var}:-" "$PROJECT_ROOT/$file"
}

for f in docker-compose.yml docker/compose/monitoring.yml; do
  check "$f does not bind /var/run/docker.sock by literal source" \
    no_hardcoded_host_source "$f" "/var/run/docker\.sock"
  check "$f does not bind /var/lib/docker/containers by literal source" \
    no_hardcoded_host_source "$f" "/var/lib/docker/containers"
done

check "docker-compose.yml parameterises the daemon socket" \
  parameterised docker-compose.yml SANCTUARY_DOCKER_SOCKET
check "monitoring.yml parameterises the daemon socket" \
  parameterised docker/compose/monitoring.yml SANCTUARY_DOCKER_SOCKET
check "monitoring.yml parameterises the containers directory" \
  parameterised docker/compose/monitoring.yml SANCTUARY_DOCKER_CONTAINERS_DIR

# The default must remain the Docker path: operators run Docker, and this change
# must not alter what a normal install does.
default_is_docker_path() {
  local file="$1"
  grep -q '\${SANCTUARY_DOCKER_SOCKET:-/var/run/docker\.sock}' "$PROJECT_ROOT/$file"
}
for f in docker-compose.yml docker/compose/monitoring.yml; do
  check "$f defaults the socket to the Docker path" default_is_docker_path "$f"
done

# The container-side path must not change, or images would need edits.
container_side_unchanged() {
  local file="$1"
  grep -q ':/var/run/docker\.sock:ro' "$PROJECT_ROOT/$file"
}
for f in docker-compose.yml docker/compose/monitoring.yml; do
  check "$f keeps the container-side socket path unchanged" container_side_unchanged "$f"
done

printf '\n====================\n'
printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "${#FAILURES[@]}"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf 'Failing checks:\n'
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
