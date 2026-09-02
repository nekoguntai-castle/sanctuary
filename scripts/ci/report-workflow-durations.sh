#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/forgejo-report-api.sh
source "$SCRIPT_DIR/forgejo-report-api.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/ci/report-workflow-durations.sh RUN_ID

Print a compact duration report for a Forgejo Actions run. Live mode uses
read-only Forgejo run/task API calls; RUN_ID is the database run ID.
USAGE
}

fail() {
  echo "report-workflow-durations: $*" >&2
  exit 1
}

if [ "${1:-}" = '-h' ] || [ "${1:-}" = '--help' ]; then
  usage
  exit 0
fi

run_id="${1:-}"
[ "$#" -eq 1 ] && [[ "$run_id" =~ ^[1-9][0-9]*$ ]] || {
  usage >&2
  fail 'RUN_ID must be a positive integer'
}

command -v curl >/dev/null 2>&1 || fail 'required command not found: curl'
command -v jq >/dev/null 2>&1 || fail 'required command not found: jq'
command -v python3 >/dev/null 2>&1 || fail 'required command not found: python3'
forgejo_report_resolve_context || fail 'could not resolve Forgejo API context'

temp_dir="$("$SCRIPT_DIR/create-registered-staging.sh" report-workflow-durations)" \
  || fail 'could not create registered report staging'
run_file="$temp_dir/run.json"
tasks_file="$temp_dir/tasks.json"
report_tasks_file="$temp_dir/report-tasks.json"
page_file="$temp_dir/tasks-page.json"
jobs_file="$temp_dir/jobs.json"

forgejo_report_get "actions/runs/$run_id" "$run_file" || fail 'could not fetch workflow run'
run_number="$(jq -er '.index_in_repo | select(type == "number" and . > 0)' "$run_file")" \
  || fail 'workflow run response has no valid index_in_repo'
run_status="$(jq -er '.status | select(type == "string")' "$run_file")" \
  || fail 'workflow run response has no valid status'
case "$run_status" in
  success|failure|cancelled|skipped) ;;
  *) fail "workflow run is not complete (status: $run_status)" ;;
esac

forgejo_report_get "actions/runs/$run_id/jobs" "$jobs_file" \
  || fail 'could not fetch workflow run jobs'
jq -e '
  type == "array" and length > 0 and
  all(.[];
    (.task_id | type == "number") and
    (.task_id >= 0) and
    (.task_id == (.task_id | floor))
  ) and
  all(.[] | select(.task_id == 0);
    .status == "skipped" or .status == "blocked" or .status == "cancelled") and
  ([.[] | select(.task_id > 0) | .task_id] | unique | length) ==
    ([.[] | select(.task_id > 0)] | length)
' "$jobs_file" >/dev/null || fail 'workflow jobs response has invalid or duplicate task IDs'
expected_count="$(jq '[.[] | select(.task_id > 0)] | length' "$jobs_file")"
printf '[]\n' > "$tasks_file"

page=1
complete=false
page_limit=100
if [ "$expected_count" -eq 0 ]; then
  complete=true
fi
while [ "$page" -le "$page_limit" ]; do
  [ "$complete" = false ] || break
  forgejo_report_get "actions/tasks?page=$page&limit=50" "$page_file" \
    || fail "could not fetch workflow tasks page $page"
  jq -e '
    (.total_count | type == "number") and .total_count >= 0 and
    (.workflow_runs | type == "array") and
    (.workflow_runs | length) <= 50
  ' "$page_file" >/dev/null \
    || fail "workflow tasks page $page is malformed"

  jq --slurpfile jobs "$jobs_file" '
    [.workflow_runs[] |
      select(.id as $id | any($jobs[0][]; .task_id == $id))]
  ' "$page_file" > "$temp_dir/matches.json"
  if [ "$(jq 'length' "$temp_dir/matches.json")" -gt 0 ]; then
    jq -s '.[0] + .[1] | unique_by(.id)' \
      "$tasks_file" "$temp_dir/matches.json" > "$temp_dir/tasks-next.json"
    mv "$temp_dir/tasks-next.json" "$tasks_file"
  fi

  row_count="$(jq '.workflow_runs | length' "$page_file")"
  if [ "$(jq 'length' "$tasks_file")" -eq "$expected_count" ]; then
    complete=true
    break
  fi
  if [ "$row_count" -lt 50 ]; then
    fail "workflow task listing ended before all $expected_count run jobs were found"
  fi
  page=$((page + 1))
done

[ "$complete" = true ] \
  || fail "task pagination could not find all $expected_count run jobs within $page_limit pages"
jq -e --argjson target "$run_number" \
  'all(.[]; .run_number == $target)' "$tasks_file" >/dev/null \
  || fail 'workflow task IDs resolved to a different run number'
jq --argjson target "$run_number" --slurpfile jobs "$jobs_file" '
  . + [
    $jobs[0][] |
    select(.task_id == 0) |
    {
      id: ("unstarted-job-" + (.id | tostring)),
      name,
      run_number: $target,
      status,
      run_started_at: null,
      updated_at: null
    }
  ]
' "$tasks_file" > "$report_tasks_file"

python3 - "$report_tasks_file" <<'PY'
import json
import sys
from datetime import datetime


def parse_time(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def duration(task):
    started = parse_time(task.get("run_started_at"))
    stopped = parse_time(task.get("updated_at"))
    if started is None or stopped is None:
        return None
    try:
        seconds = int((stopped - started).total_seconds())
    except TypeError:
        return None
    return seconds if seconds >= 0 else None


def format_seconds(value):
    return "n/a" if value is None else f"{value // 60}m {value % 60}s"


def escape(value):
    return str(value or "n/a").replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


with open(sys.argv[1], encoding="utf-8") as handle:
    tasks = json.load(handle)
terminal_statuses = {"success", "failure", "cancelled", "skipped"}


def is_final_task(task):
    status = task.get("status")
    if status in terminal_statuses:
        return True
    return status == "blocked" and str(task.get("id", "")).startswith("unstarted-job-")


if any(not is_final_task(task) for task in tasks):
    raise SystemExit("report-workflow-durations: completed run contains a nonterminal task")
rows = [
    {
        "name": escape(task.get("name")),
        "status": escape(task.get("status")),
        "seconds": duration(task),
    }
    for task in tasks
]
rows.sort(key=lambda row: (row["seconds"] is not None, row["seconds"] or -1, row["name"]), reverse=True)
print("Duration | Conclusion | Job")
print("--- | --- | ---")
for row in rows:
    print(f"{format_seconds(row['seconds'])} | {row['status']} | {row['name']}")
PY
