#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'Usage: scripts/ci/with-runner-lock.sh LOCK_NAME COMMAND [ARG...]' >&2
  echo '       scripts/ci/with-runner-lock.sh --print-default-timeout' >&2
}

fail() {
  echo "with-runner-lock: $*" >&2
  exit 1
}

# A lock wait that outlives its job is worse than useless: the job-level timeout
# cancels the `if: always()` diagnostics upload, so the log never names the lock
# or any other step. That is how sanctuary#699's verify-vectors failure produced
# three identical 30-minute runs with no usable evidence.
#
# This default nonetheless stays at 3600. It is shared with the `e2e` lock, which
# wraps whole E2E bodies rather than toolchain setup -- Upgrade Baseline was
# measured at 63 minutes (tasks/issue-664-runner-capacity-findings-2026-08-05.md),
# and the only two e2e jobs anyone has tuned needed 1200s. Lowering it globally
# would convert legitimate waits into hard failures, and nothing classifies a
# lock conflict as retryable.
#
# The fix belongs per workflow, where the hold time is known: set
# SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS below the enclosing step budget, as
# .github/workflows/verify-vectors.yml does. tests/ci/with-runner-lock.test.sh
# enforces that relationship wherever a workflow declares one. Bringing the
# remaining jobs under it needs measured hold times and is follow-up work.
DEFAULT_LOCK_TIMEOUT_SECONDS=3600

# Returned only when the lock itself was never acquired. Taking the lock on a
# dedicated fd rather than via `flock CMD` keeps this unambiguous: the child
# never runs, so no child exit status can be mistaken for it. (`flock -E` would
# not be enough -- it only reserves a number the child is asked not to use, and
# 75 is EX_TEMPFAIL, which retry tooling does use.)
LOCK_CONFLICT_EXIT_CODE=75

main() {
  # Guarded on argument count: the flag matches the lock-name charset below, so
  # an unguarded branch would swallow `with-runner-lock.sh --print-default-timeout CMD`
  # and exit 0 having run nothing -- a CI step reporting success for no work.
  if [ "$#" -eq 1 ] && [ "$1" = '--print-default-timeout' ]; then
    printf '%s\n' "$DEFAULT_LOCK_TIMEOUT_SECONDS"
    return 0
  fi

  if [ "$#" -lt 2 ]; then
    usage
    fail 'expected a lock name and command'
  fi

  local lock_name="$1"
  shift

  if [[ ! "$lock_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    fail 'lock name may contain only letters, numbers, dots, underscores, and hyphens'
  fi

  local timeout="${SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS:-$DEFAULT_LOCK_TIMEOUT_SECONDS}"
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

  # Hold the lock on fd 9 for the lifetime of the child rather than using
  # `flock LOCKFILE CMD`, so acquisition failure and child failure stay
  # distinguishable. Not fail(): the reserved status has to survive.
  exec 9>"$lock_file"
  if ! flock -w "$timeout" 9; then
    echo "with-runner-lock: timed out after ${timeout}s waiting for runner lock: ${lock_name}" >&2
    return "$LOCK_CONFLICT_EXIT_CODE"
  fi

  local status=0
  "$@" || status="$?"
  return "$status"
}

main "$@"
