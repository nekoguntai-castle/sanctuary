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
#
# Cancelling a running lock holder can strand the lock. The flock lives on fd 9
# of this script's process; the kernel releases it when that process dies, but
# a cancelled Forgejo job can leave its job container (and this process) alive
# while the runner moves on. Every later taker then waits the full timeout and
# reports "timed out ... waiting for runner lock" although no lane is doing
# work. Check `runner-lock: acquired` lines on the host for a holder whose job
# is gone before assuming a lane is genuinely busy (v0.8.70-rc3/rc4, #1020).
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

  # Measure the wait. The line above is printed before flock is attempted, so
  # it reads identically whether the lock was free or held for an hour -- which
  # meant no log anywhere could say whether serialising these lanes costs
  # anything. That question gates sanctuary#664, so report the answer instead of
  # implying it.
  #
  # Stable, greppable prefixes so contention can be aggregated across runs:
  #   runner-lock: acquired <name> after <n>s
  #   runner-lock: released <name> held <n>s status=<n>
  local wait_start wait_end waited
  wait_start="$(date +%s%N)"
  if ! flock -w "$timeout" 9; then
    wait_end="$(date +%s%N)"
    echo "runner-lock: timeout ${lock_name} after $(((wait_end - wait_start) / 1000000000))s" >&2
    echo "with-runner-lock: timed out after ${timeout}s waiting for runner lock: ${lock_name}" >&2
    return "$LOCK_CONFLICT_EXIT_CODE"
  fi
  wait_end="$(date +%s%N)"
  waited=$(((wait_end - wait_start) / 1000000000))
  echo "runner-lock: acquired ${lock_name} after ${waited}s"
  if [ "$waited" -ge 1 ]; then
    echo "::notice title=Runner lock contention::${lock_name} was held by another lane; waited ${waited}s"
  fi

  local status=0
  "$@" || status="$?"

  echo "runner-lock: released ${lock_name} held $((( $(date +%s%N) - wait_end) / 1000000000))s status=${status}"
  return "$status"
}

main "$@"
