#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/ci/report-workflow-trends.sh --workflow WORKFLOW [--event EVENT] [--branch BRANCH] [--limit N]
  scripts/ci/report-workflow-trends.sh --runs-json FILE [--event EVENT]

Summarize recent GitHub Actions workflow durations as p50/p90 wall time and
runner time. Live mode fetches runs with `gh run list` and job details with
`gh run view`. Fixture mode reads JSON shaped as:

  { "runs": [ { "databaseId": 1, "event": "pull_request", "conclusion": "success",
                "createdAt": "...", "updatedAt": "...", "jobs": [...] } ] }
USAGE
}

fail() {
  echo "report-workflow-trends: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

is_positive_integer() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]]
}

workflow=''
event_filter=''
branch=''
limit='20'
runs_json_file=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --workflow)
      [ "$#" -ge 2 ] || fail '--workflow requires a value'
      workflow="$2"
      shift 2
      ;;
    --event)
      [ "$#" -ge 2 ] || fail '--event requires a value'
      event_filter="$2"
      shift 2
      ;;
    --branch)
      [ "$#" -ge 2 ] || fail '--branch requires a value'
      branch="$2"
      shift 2
      ;;
    --limit)
      [ "$#" -ge 2 ] || fail '--limit requires a value'
      limit="$2"
      shift 2
      ;;
    --runs-json)
      [ "$#" -ge 2 ] || fail '--runs-json requires a value'
      runs_json_file="$2"
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

is_positive_integer "$limit" || fail '--limit must be a positive integer'

summarize_runs() {
  local runs_file="$1"
  local label="$2"
  local event="$3"

  jq -r --arg label "$label" --arg event "$event" '
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

    def percentile($p):
      sort as $values
      | length as $count
      | if $count == 0 then null
        else
          ((($p * $count) | ceil) - 1) as $index
          | $values[$index]
        end;

    def job_seconds:
      seconds_between(.startedAt; .completedAt);

    def runner_seconds:
      [(.jobs // [])[] | job_seconds // 0] | add // 0;

    def longest_job:
      [(.jobs // [])[]
        | {name: (.name // "unknown"), seconds: (job_seconds)}]
      | sort_by(.seconds // -1)
      | reverse
      | .[0] // {name: "n/a", seconds: null};

    (.runs // []) as $all_runs
    | [$all_runs[]
        | select(.conclusion == "success")
        | select($event == "" or .event == $event)
        | . + {
            wall_seconds: seconds_between(.createdAt; .updatedAt),
            runner_seconds: runner_seconds,
            longest_job: longest_job
          }] as $runs
    | ($runs | map(.wall_seconds // 0)) as $wall_values
    | ($runs | map(.runner_seconds // 0)) as $runner_values
    | [
        "Workflow Duration Trend",
        "Workflow | \($label)",
        "Event filter | \(if $event == "" then "all" else $event end)",
        "Runs | \($runs | length)",
        "Wall p50 | \(($wall_values | percentile(0.5)) | format_seconds)",
        "Wall p90 | \(($wall_values | percentile(0.9)) | format_seconds)",
        "Runner p50 | \(($runner_values | percentile(0.5)) | format_seconds)",
        "Runner p90 | \(($runner_values | percentile(0.9)) | format_seconds)",
        "",
        "Run | Event | Wall | Runner | Longest job",
        "--- | --- | --- | --- | ---"
      ]
      + ($runs
          | sort_by(.updatedAt // .createdAt // "")
          | reverse
          | map("\(.databaseId // .id // "n/a") | \(.event // "n/a") | \(.wall_seconds | format_seconds) | \(.runner_seconds | format_seconds) | \(.longest_job.name) (\(.longest_job.seconds | format_seconds))"))
      | .[]
  ' "$runs_file"
}

fetch_live_runs() {
  local output_file="$1"
  require_command gh

  [ -n "$workflow" ] || fail '--workflow is required unless --runs-json is used'

  local args
  args=(run list --workflow "$workflow" --status success --limit "$limit" --json databaseId,workflowName,event,status,conclusion,createdAt,updatedAt,headBranch)
  if [ -n "$event_filter" ]; then
    args+=(--event "$event_filter")
  fi
  if [ -n "$branch" ]; then
    args+=(--branch "$branch")
  fi

  local runs_json
  runs_json="$(gh "${args[@]}")"

  local first=true
  printf '{"runs":[' > "$output_file"
  while IFS= read -r run_json; do
    [ -n "$run_json" ] || continue

    local run_id jobs_json merged_json
    run_id="$(jq -r '.databaseId' <<<"$run_json")"
    jobs_json="$(gh run view "$run_id" --json jobs)"
    merged_json="$(jq -c -n --argjson run "$run_json" --argjson jobs "$jobs_json" '$run + {jobs: ($jobs.jobs // [])}')"

    if [ "$first" = "true" ]; then
      first=false
    else
      printf ',' >> "$output_file"
    fi
    printf '%s' "$merged_json" >> "$output_file"
  done < <(jq -c '.[]' <<<"$runs_json")
  printf ']}' >> "$output_file"
}

main() {
  require_command jq

  if [ -n "$runs_json_file" ]; then
    [ -f "$runs_json_file" ] || fail "runs JSON file not found: $runs_json_file"
    summarize_runs "$runs_json_file" "${workflow:-fixture}" "$event_filter"
    exit 0
  fi

  local temp_file
  temp_file="$(mktemp)"
  trap 'rm -f "${temp_file:-}"' EXIT

  fetch_live_runs "$temp_file"
  summarize_runs "$temp_file" "$workflow" "$event_filter"
}

main "$@"
