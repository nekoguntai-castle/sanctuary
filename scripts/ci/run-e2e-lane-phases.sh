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

mkdir -p "$LOG_DIR"

# Phase 1 — build and start the stack.
"$REPO_ROOT/scripts/ci/run-with-log.sh" "$LOG_DIR/start-containers.log" \
    "$REPO_ROOT/scripts/ci/time-command.sh" "${LANE} start" \
    bash -c "cd \"$WORKSPACE\" && docker compose build && docker compose up -d"

# Phase 2 — wait for the migration container to finish, then for the backend to
# answer. Unchanged behaviour; it simply now runs while the lock is still held.
"$REPO_ROOT/scripts/ci/run-with-log.sh" "$LOG_DIR/wait-migration.log" \
    bash -c '
      cd "$1"
      echo "Waiting for migration container to finish..."
      for i in $(seq 1 60); do
        STATUS=$(docker compose ps migrate --format "{{.Status}}" 2>/dev/null | grep -oE "^[A-Za-z]+" || echo "not_found")
        if [ "$STATUS" = "Exited" ]; then
          EXIT_STATUS=$(docker compose ps migrate --format "{{.Status}}" 2>/dev/null)
          if echo "$EXIT_STATUS" | grep -q "(0)"; then
            echo "Migration completed successfully"
            break
          else
            echo "Migration failed: $EXIT_STATUS"
            docker compose logs --tail 50 migrate
            exit 1
          fi
        fi
        echo "Waiting for migration... (attempt $i/60, status: $STATUS)"
        sleep 5
      done
      echo "Waiting for backend to be healthy..."
      for i in $(seq 1 30); do
        if docker compose exec backend wget -q -O - http://localhost:3001/health >/dev/null 2>&1; then
          echo "Backend is healthy"
          break
        fi
        echo "Waiting for backend... (attempt $i/30)"
        sleep 2
      done
    ' _ "$WORKSPACE"

# Phase 3 — the lane's own test.
"$REPO_ROOT/scripts/ci/run-with-log.sh" "$LOG_DIR/${LANE}.log" \
    "$REPO_ROOT/scripts/ci/time-command.sh" "${LANE} e2e" \
    bash -c "cd \"$WORKSPACE\" && $(printf '%q ' "$@")"
