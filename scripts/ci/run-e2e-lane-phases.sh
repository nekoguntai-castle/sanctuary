#!/usr/bin/env bash
# Run one e2e lane's stack phases as a single unit, so the caller can hold the
# runner lock for the whole lifetime of the stack.
#
# The lanes used to take the `e2e` lock per step: once to start containers,
# release, run an unlocked wait-for-migration, then take it again for the test.
# That left a live stack unprotected between locked sections, and both
# install-test.yml and release-candidate.yml fire on an RC tag by design, so
# another lane could hold the lock and work on the same daemon while the first
# lane's containers sat idle.
#
# v0.8.60-rc2's Container Health died in exactly that window: the backend was
# reported Healthy when `docker compose up` returned at 07:59:13Z, every one of
# the following 30 reachability probes failed, and by 08:05:19Z the backend and
# migrate containers no longer existed while postgres, frontend and gateway
# survived. See #719.
#
# Collapsing the phases into one command lets the caller wrap the entire
# sequence in a single `with-runner-lock.sh e2e`, so no other e2e lane can
# interleave with a live stack. The three phases keep writing their own logs,
# because the diagnostic index and write-diagnostic-summary.sh are keyed to
# those filenames.
#
# Usage:
#   run-e2e-lane-phases.sh <workspace> <log-dir> <lane-label> <test-command...>

set -euo pipefail

WORKSPACE="${1:?usage: run-e2e-lane-phases.sh <workspace> <log-dir> <lane-label> <test-command...>}"
LOG_DIR="${2:?log directory is required}"
LANE="${3:?lane label is required}"
shift 3
[ "$#" -gt 0 ] || { echo "run-e2e-lane-phases.sh: a test command is required" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$REPO_ROOT/scripts/ownership/producer-hooks.sh"
SANCTUARY_PROJECT_DIR="$WORKSPACE"
SANCTUARY_PROJECT="${SANCTUARY_PROJECT:-${COMPOSE_PROJECT_NAME:-sanctuary-e2e}}"
export SANCTUARY_PROJECT_DIR SANCTUARY_PROJECT
ownership_initialize_build_identity

mkdir -p "$LOG_DIR"

# Phase 1 — build and start the stack.
"$REPO_ROOT/scripts/ci/run-with-log.sh" "$LOG_DIR/start-containers.log" \
    "$REPO_ROOT/scripts/ci/time-command.sh" "${LANE} start" \
    bash -c "cd \"$WORKSPACE\" && docker compose build && docker compose up -d"

# Phase 2 — wait for the migration container to finish, then for the backend to
# answer. Extracted to wait-for-migration.sh so it can be tested: as an inline
# `bash -c` string it carried a lookup that could never succeed (#741) and a
# failure branch that could never run.
"$REPO_ROOT/scripts/ci/run-with-log.sh" "$LOG_DIR/wait-migration.log" \
    "$REPO_ROOT/scripts/ci/wait-for-migration.sh" "$WORKSPACE"

# Phase 3 — the lane's own test.
"$REPO_ROOT/scripts/ci/run-with-log.sh" "$LOG_DIR/${LANE}.log" \
    "$REPO_ROOT/scripts/ci/time-command.sh" "${LANE} e2e" \
    bash -c "cd \"$WORKSPACE\" && $(printf '%q ' "$@")"
