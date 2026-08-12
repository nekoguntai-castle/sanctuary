#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo 'Usage: scripts/ci/time-command.sh LABEL COMMAND [ARG...]' >&2
  exit 1
fi

label="$1"
shift

start_epoch="$(date +%s)"
echo "::group::$label"

set +e
"$@"
status="$?"
set -e

echo '::endgroup::'

end_epoch="$(date +%s)"
elapsed_seconds="$((end_epoch - start_epoch))"
elapsed_minutes="$((elapsed_seconds / 60))"
remaining_seconds="$((elapsed_seconds % 60))"
message="$label completed in ${elapsed_minutes}m ${remaining_seconds}s (${elapsed_seconds}s)"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
budget_file="${SANCTUARY_CI_PERFORMANCE_BUDGET_FILE:-$repo_root/.github/ci-performance-budget.json}"
timing_file="${SANCTUARY_CI_TIMING_FILE:-}"
if [ -z "$timing_file" ] && [ -n "${DIAGNOSTIC_DIR:-}" ]; then
  timing_file="$DIAGNOSTIC_DIR/ci-timings.jsonl"
fi
timing_file="${timing_file:--}"

set +e
node "$script_dir/record-command-timing.mjs" \
  "$timing_file" "$budget_file" "$label" "$elapsed_seconds" "$status" \
  "$start_epoch" "$end_epoch"
timing_status="$?"
set -e

if [ "$status" -eq 0 ]; then
  echo "::notice title=CI timing::$message"
else
  echo "::error title=CI timing::$message with exit code $status"
fi

if [ "$status" -eq 0 ] && [ "$timing_status" -ne 0 ]; then
  exit "$timing_status"
fi

exit "$status"
