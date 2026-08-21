#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/ci/report-workflow-trends.sh --workflow WORKFLOW [--event EVENT] [--branch BRANCH] [--limit N] [--json-out FILE]
  scripts/ci/report-workflow-trends.sh --runs-json FILE [--event EVENT] [--json-out FILE]

Summarize recent Forgejo Actions workflow durations as p50/p90 wall time and,
when job timestamps are available, runner time. Live mode uses GET-only Forgejo
API calls. It reads FORGEJO_API_URL, FORGEJO_REPOSITORY, and FORGEJO_TOKEN,
falling back to the equivalent GITHUB_* Actions variables. Fixture mode reads:

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
json_output_file=''

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
    --json-out)
      [ "$#" -ge 2 ] || fail '--json-out requires a value'
      json_output_file="$2"
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

is_positive_integer "$limit" || fail '--limit must be a positive integer'

build_summary() {
  local runs_file="$1"
  local label="$2"
  local event="$3"

  jq -c --arg workflow_label "$label" --arg event "$event" --arg branch "$branch" '
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
      [(.jobs // [])[] | job_seconds | select(. != null)]
      | if length == 0 then null else add end;

    def longest_job:
      [(.jobs // [])[]
        | {name: (.name // "unknown"), seconds: (job_seconds)}
        | select(.seconds != null)]
      | sort_by(.seconds // -1)
      | reverse
      | .[0] // {name: "n/a", seconds: null};

    (.runs // []) as $all_runs
    | [$all_runs[]
        | select(.conclusion == "success")
        | select($event == "" or .event == $event)
        | . + {
            wall_seconds: (.wallSeconds // seconds_between(.createdAt; .updatedAt)),
            runner_seconds: runner_seconds,
            longest_job: longest_job
          }] as $runs
    | ($runs | map(.wall_seconds) | map(select(. != null))) as $wall_values
    | ($runs | map(.runner_seconds) | map(select(. != null))) as $runner_values
    | {
        schema_version: 1,
        workflow: $workflow_label,
        event_filter: (if $event == "" then null else $event end),
        branch_filter: (if $branch == "" then null else $branch end),
        sample_count: ($runs | length),
        metrics: {
          wall_seconds: {
            p50: ($wall_values | percentile(0.5)),
            p90: ($wall_values | percentile(0.9))
          },
          runner_seconds: {
            p50: ($runner_values | percentile(0.5)),
            p90: ($runner_values | percentile(0.9)),
            available: (($runner_values | length) > 0)
          }
        },
        runs: ($runs
          | sort_by(.updatedAt // .createdAt // "")
          | reverse
          | map({
              id: (.databaseId // .id // null),
              event: (.event // null),
              ref: (.ref // null),
              wall_seconds,
              runner_seconds,
              longest_job
            }))
      }
  ' "$runs_file"
}

render_summary() {
  local summary_file="$1"

  jq -r '
    def format_seconds:
      if . == null then "n/a"
      else
        (floor as $seconds
          | "\(($seconds / 60) | floor)m \(($seconds % 60))s")
      end;

    [
      "Workflow Duration Trend",
      "Workflow | \(.workflow)",
      "Event filter | \(.event_filter // "all")",
      "Branch filter | \(.branch_filter // "all")",
      "Runs | \(.sample_count)",
      "Wall p50 | \(.metrics.wall_seconds.p50 | format_seconds)",
      "Wall p90 | \(.metrics.wall_seconds.p90 | format_seconds)",
      "Runner p50 | \(.metrics.runner_seconds.p50 | format_seconds)",
      "Runner p90 | \(.metrics.runner_seconds.p90 | format_seconds)",
      "",
      "Run | Event | Wall | Runner | Longest job",
      "--- | --- | --- | --- | ---"
    ]
    + (.runs
        | map("\(.id // "n/a") | \(.event // "n/a") | \(.wall_seconds | format_seconds) | \(.runner_seconds | format_seconds) | \(.longest_job.name) (\(.longest_job.seconds | format_seconds))"))
    | .[]
  ' "$summary_file"
}

summarize_runs() {
  local runs_file="$1"
  local label="$2"
  local event="$3"
  local summary_file
  summary_file="$(mktemp)"

  build_summary "$runs_file" "$label" "$event" > "$summary_file"
  render_summary "$summary_file"

  if [ -n "$json_output_file" ]; then
    mkdir -p "$(dirname "$json_output_file")"
    jq '.' "$summary_file" > "$json_output_file"
  fi

  rm -f "$summary_file"
}

fetch_live_runs() {
  local output_file="$1"

  [ -n "$workflow" ] || fail '--workflow is required unless --runs-json is used'
  require_command curl

  local token api_base repository owner repo workflow_query runs_url
  token="${FORGEJO_TOKEN:-${GITHUB_TOKEN:-}}"
  [ -n "$token" ] || fail 'no API token in FORGEJO_TOKEN / GITHUB_TOKEN'

  api_base="${FORGEJO_API_URL:-${GITHUB_API_URL:-}}"
  [ -n "$api_base" ] || fail 'no API URL in FORGEJO_API_URL / GITHUB_API_URL'
  api_base="${api_base%/}"
  case "$api_base" in
    */api/v1) ;;
    *) api_base="$api_base/api/v1" ;;
  esac

  repository="${FORGEJO_REPOSITORY:-${GITHUB_REPOSITORY:-}}"
  case "$repository" in
    */*) ;;
    *) fail 'repository must be owner/name in FORGEJO_REPOSITORY / GITHUB_REPOSITORY' ;;
  esac
  owner="${repository%%/*}"
  repo="${repository#*/}"

  workflow_query="$(jq -rn --arg value "$workflow" '$value | @uri')"
  runs_url="$api_base/repos/$owner/$repo/actions/runs?page=1&limit=50&status=success&workflow_id=$workflow_query"

  local runs_json selected_runs
  runs_json="$(curl -fsS -H "Authorization: token $token" -H 'Accept: application/json' "$runs_url")"
  selected_runs="$(jq -c \
    --arg workflow "$workflow" \
    --arg event "$event_filter" \
    --arg branch "$branch" \
    --argjson limit "$limit" '
      def effective_event:
        if (.trigger_event // "") != "" then .trigger_event else (.event // "") end;
      [(.workflow_runs // [])[]
        | . + {effective_event: effective_event}
        | select(.workflow_id == $workflow)
        | select(.status == "success")
        | select($event == "" or .effective_event == $event)
        | select($branch == "" or .prettyref == $branch or .prettyref == ("refs/heads/" + $branch))]
      | sort_by(.id)
      | reverse
      | .[0:$limit]
    ' <<<"$runs_json")"

  jq -c '
    {
      runs: [.[]
        | {
          databaseId: .id,
          event: .effective_event,
          ref: (.prettyref // null),
          conclusion: .status,
          createdAt: (.started // .created // null),
          updatedAt: (.stopped // .updated // null),
          wallSeconds: (if (.duration // 0) > 0 then (.duration / 1000000000) else null end),
          jobs: []
        }]
    }
  ' <<<"$selected_runs" > "$output_file"
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
