#!/usr/bin/env bash
#
# The monitoring overlay bind-mounts config FILES from the project directory.
# Compose resolves "./docker/monitoring/..." against the project dir, which
# inside a CI job is /workspace/... — a path that exists in the job container
# and not on the host where the container engine runs.
#
# Under Docker-in-Docker the daemon ran as root in its own container and could
# create the missing path, so a shim
# (sync_monitoring_configs_to_daemon) populated it by docker-cp'ing through a
# helper container's bind mount. Under rootless Podman the engine runs as an
# unprivileged host user and cannot mkdir /workspace, so both the mount and the
# shim that worked around it fail identically:
#
#   making volume mountpoint for volume /workspace/.../alertmanager.yml:
#     mkdir /workspace: permission denied
#
# The boundary the shim worked around no longer exists: the job's workspace is a
# host bind mount, so a real host path holds these files and
# docker_visible_path() can derive it from the job container's own mount table.
# That is already how the SSL directory is handled, and those mounts work on
# Podman today.
#
# Guards the parameterisation that lets the lane supply a daemon-visible path,
# while leaving operator installs on the current relative default.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OVERLAY="$PROJECT_ROOT/docker/compose/monitoring.yml"

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

[ -f "$OVERLAY" ] || { printf 'FAIL: %s not found\n' "$OVERLAY" >&2; exit 1; }

no_literal_config_source() {
  local offenders
  offenders="$(grep -nE '^[[:space:]]*-[[:space:]]*\./docker/monitoring/' "$OVERLAY" || true)"
  if [ -n "$offenders" ]; then
    printf 'literal ./docker/monitoring mount sources remain:\n%s\n' "$offenders" >&2
    return 1
  fi
  return 0
}

all_sources_parameterised() {
  # Every monitoring config mount must route through the variable.
  local total parameterised
  total="$(grep -cE '^[[:space:]]*-[[:space:]]*.*docker/monitoring.*:/' "$OVERLAY" || echo 0)"
  parameterised="$(grep -cE '\$\{SANCTUARY_MONITORING_CONFIG_DIR:-\./docker/monitoring\}' "$OVERLAY" || echo 0)"
  [ "$total" -gt 0 ] && [ "$parameterised" -eq "$total" ]
}

default_is_unchanged() {
  # Operators run Docker with the project dir on the same host as the daemon,
  # so the relative path must remain the default.
  grep -q '\${SANCTUARY_MONITORING_CONFIG_DIR:-\./docker/monitoring}' "$OVERLAY"
}

container_side_unchanged() {
  # The in-container destinations must not move, or the images would need edits.
  grep -q ':/etc/prometheus/prometheus.yml:ro' "$OVERLAY" &&
    grep -q ':/etc/alertmanager/alertmanager.yml:ro' "$OVERLAY" &&
    grep -q ':/etc/promtail/config.yml:ro' "$OVERLAY"
}

# promtail discovers containers through the Docker API (docker_sd_configs against
# the daemon socket), not by reading /var/lib/docker/containers. The directory
# mount served nothing, and on a rootless Podman host it is actively fatal:
# /var/lib/docker does not exist and cannot be created without root, so the
# mount aborts the whole compose up (run 8904).
no_containers_dir_mount() {
  local offenders
  # Match mount entries only. A comment explaining why the directory is not
  # mounted must not trip the check that it is not mounted.
  offenders="$(grep -nE '^[[:space:]]*-[[:space:]]*[^#]*/var/lib/docker/containers' "$OVERLAY" || true)"
  if [ -n "$offenders" ]; then
    printf 'promtail no longer reads this directory; the mount must go:\n%s\n' "$offenders" >&2
    return 1
  fi
  return 0
}

# The socket is what promtail actually needs, so removing the directory must not
# take the socket with it.
socket_mount_retained() {
  grep -q 'SANCTUARY_DOCKER_SOCKET:-/var/run/docker.sock' "$OVERLAY"
}

check "the vestigial containers-dir mount is gone" no_containers_dir_mount
check "promtail keeps the daemon socket it actually uses" socket_mount_retained
check "no literal ./docker/monitoring mount sources remain" no_literal_config_source
check "every monitoring config source is parameterised" all_sources_parameterised
check "the default remains the relative project path" default_is_unchanged
check "container-side destinations are unchanged" container_side_unchanged

printf '\n====================\n'
printf 'Passed: %d\n' "$PASS"
printf 'Failed: %d\n' "${#FAILURES[@]}"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf 'Failing checks:\n'
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
