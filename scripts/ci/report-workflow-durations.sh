#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/ci/report-workflow-durations.sh RUN_ID

Print a compact duration report for a GitHub Actions run using:
  gh run view RUN_ID --json jobs
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

run_id="${1:-}"
if [ -z "$run_id" ]; then
  usage >&2
  exit 1
fi

gh run view "$run_id" --json jobs --jq '
  def to_epoch:
    if . == null then null else fromdateiso8601 end;

  def seconds_between($started; $completed):
    if $started == null or $completed == null then null
    else
      (($completed | to_epoch) - ($started | to_epoch)) as $seconds
      | if $seconds < 0 then 0 else $seconds end
    end;

  def format_seconds:
    if . == null then "n/a"
    else
      (floor as $seconds
        | "\(($seconds / 60) | floor)m \(($seconds % 60))s")
    end;

  [.jobs[]
    | . as $job
    | seconds_between($job.startedAt; $job.completedAt) as $seconds
    | {
        name: $job.name,
        status: $job.status,
        conclusion: ($job.conclusion // "n/a"),
        seconds: $seconds,
        duration: ($seconds | format_seconds)
      }]
  | sort_by(.seconds // -1)
  | reverse
  | (["Duration | Conclusion | Job", "--- | --- | ---"]
      + map("\(.duration) | \(.conclusion) | \(.name)"))
  | .[]'
