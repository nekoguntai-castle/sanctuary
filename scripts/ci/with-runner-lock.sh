#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'Usage: scripts/ci/with-runner-lock.sh LOCK_NAME COMMAND [ARG...]' >&2
}

fail() {
  echo "with-runner-lock: $*" >&2
  exit 1
}

main() {
  if [ "$#" -lt 2 ]; then
    usage
    fail 'expected a lock name and command'
  fi

  local lock_name="$1"
  shift

  if [[ ! "$lock_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    fail 'lock name may contain only letters, numbers, dots, underscores, and hyphens'
  fi

  local timeout="${SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS:-3600}"
  if [[ ! "$timeout" =~ ^[1-9][0-9]*$ ]]; then
    fail 'SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS must be a positive integer'
  fi

  local workspace
  workspace="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"

  local lock_dir="${SANCTUARY_RUNNER_LOCK_DIR:-}"
  if [ -z "$lock_dir" ]; then
    lock_dir="$(dirname "$workspace")/.sanctuary-runner-locks"
  fi

  mkdir -p "$lock_dir"
  chmod 1777 "$lock_dir" 2>/dev/null || true

  if [ ! -w "$lock_dir" ]; then
    fail "runner lock directory is not writable: $lock_dir"
  fi

  local lock_file="${lock_dir}/${lock_name}.lock"
  (
    umask 000
    touch "$lock_file"
  ) || fail "runner lock file is not writable: $lock_file"
  chmod 666 "$lock_file" 2>/dev/null || true

  echo "Waiting for runner lock: ${lock_name}"
  flock -w "$timeout" "$lock_file" "$@"
}

main "$@"
