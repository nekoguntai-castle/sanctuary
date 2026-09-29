#!/usr/bin/env bash
# Run every frontend coverage shard as a concurrent process inside one job.
#
# Each shard keeps frontend-coverage-shard.sh's single-worker contract (#265);
# only the shard processes overlap, on a runner that is otherwise mostly idle.
# The shards stay in one job because splitting them into matrix jobs lost the
# gain to runner queueing (PR #884). Every shard writes its own report
# directory, blob and log, and every shard is awaited even after another
# fails, so each failure is reported. See R3 of
# tasks/ci-speedup-analysis-2026-09-29.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SHARD_TOTAL=2
log_dir="${DIAGNOSTIC_DIR:-.tmp/ci-diagnostics/frontend-coverage-merge}"

# The shard processes stay in this step's process group, so a signal the
# runner sends to the step reaches them just as it reached the former
# sequential steps.
pids=()
for shard in $(seq 1 "$SHARD_TOTAL"); do
  # A per-shard parent keeps a crash retry's stash of parent-level `.tmp-*`
  # scratch entries (frontend-coverage-shard.sh) away from the sibling shard.
  SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR="coverage-shards/shard-${shard}-${SHARD_TOTAL}/reports" \
    "$SCRIPT_DIR/run-with-log.sh" "$log_dir/frontend-coverage-shard-${shard}.log" \
    "$SCRIPT_DIR/time-command.sh" "frontend coverage shard ${shard}/${SHARD_TOTAL}" \
    bash "$SCRIPT_DIR/frontend-coverage-shard.sh" "$shard" "$SHARD_TOTAL" &
  pids+=("$!")
done

status=0
for index in "${!pids[@]}"; do
  shard_status=0
  wait "${pids[$index]}" || shard_status=$?
  if [ "$shard_status" -ne 0 ]; then
    echo "frontend-coverage-shards: shard $((index + 1))/${SHARD_TOTAL} failed with exit ${shard_status}; see ${log_dir}/frontend-coverage-shard-$((index + 1)).log" >&2
    status=1
  fi
done
exit "$status"
