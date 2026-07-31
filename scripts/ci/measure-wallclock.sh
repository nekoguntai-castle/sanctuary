#!/usr/bin/env bash
# Capture wall-clock baselines for Sanctuary's CI workflows so future
# parallelism / multi-worker / cache changes can be evaluated against a
# known-state-of-the-runner reference.
#
# Uses the authoritative Forgejo Actions REST API. GitHub is a passive mirror
# and does not execute Sanctuary CI.
#
# Usage:
#   scripts/ci/measure-wallclock.sh --workflow test.yml [--event pull_request]
#                                   [--branch main] [--limit 20]
#                                   [--out reports/wallclock-test.csv]
#
# Output: CSV with columns
#   run_id,run_number,workflow,event,commit_sha,status,started,stopped,
#   wallclock_seconds,task_count,failed_task_count
# plus a stderr-side summary (count, p50, p90, max) so the script is
# useful both as a one-shot probe and as an artifact-producer in CI.
#
# Auth: reads SANCTUARY_FORGE_TOKEN (or FORGEJO_TOKEN). The token only needs
# read:repository.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

usage() {
  cat <<'EOF'
Usage: measure-wallclock.sh --workflow WORKFLOW [--event EVENT] [--branch BRANCH] [--limit N] [--out FILE]
EOF
}

workflow=""
event=""
branch=""
limit=20
out=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --workflow) workflow="$2"; shift 2 ;;
    --event)    event="$2"; shift 2 ;;
    --branch)   branch="$2"; shift 2 ;;
    --limit)    limit="$2"; shift 2 ;;
    --out)      out="$2"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *) usage >&2; printf 'measure-wallclock: unknown option %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -n "$workflow" ] || { usage >&2; exit 2; }
[[ "$limit" =~ ^[1-9][0-9]*$ ]] || {
  echo "measure-wallclock: --limit must be a positive integer" >&2
  exit 2
}

token="${SANCTUARY_FORGE_TOKEN:-${FORGEJO_TOKEN:-}}"
if [ -z "$token" ]; then
  echo "measure-wallclock: no token in SANCTUARY_FORGE_TOKEN / FORGEJO_TOKEN" >&2
  exit 2
fi

# Resolve the Forgejo API base + repository path explicitly.
api_base="${SANCTUARY_FORGE_API_URL:-${FORGEJO_URL:-}}"
[ -n "$api_base" ] || {
  echo "measure-wallclock: no Forgejo API URL in SANCTUARY_FORGE_API_URL / FORGEJO_URL" >&2
  exit 2
}
api_base="${api_base%/}"
case "$api_base" in
  */api/v1) ;;
  *) api_base="$api_base/api/v1" ;;
esac

owner="${SANCTUARY_FORGE_OWNER:-${FORGEJO_OWNER:-}}"
repo="${SANCTUARY_FORGE_REPO:-${FORGEJO_REPO:-}}"
[ -n "$owner" ] && [ -n "$repo" ] || {
  echo "measure-wallclock: cannot resolve owner/repo (set SANCTUARY_FORGE_OWNER / SANCTUARY_FORGE_REPO)" >&2
  exit 2
}

query_args=()
if [ -n "$event" ];  then query_args+=("event=$event"); fi
if [ -n "$branch" ]; then query_args+=("branch=$branch"); fi
query_args+=("limit=$limit")

query_string="$(IFS='&'; echo "${query_args[*]}")"

runs_url="$api_base/repos/$owner/$repo/actions/runs?$query_string"

ci_emit_notice "measure-wallclock: fetching $runs_url"

runs_payload="$(curl -sS -H "Authorization: token $token" -H "Accept: application/json" "$runs_url")"
runs_count="$(echo "$runs_payload" | jq -r --arg wf "$workflow" --argjson limit "$limit" \
  '[limit($limit; .workflow_runs[]? | select(.workflow_id == $wf))] | length')"

if [ "$runs_count" = "0" ]; then
  echo "measure-wallclock: no runs found for workflow=$workflow event=$event branch=$branch" >&2
  exit 1
fi

header="run_id,run_number,workflow,event,commit_sha,status,started,stopped,wallclock_seconds,task_count,failed_task_count"
if [ -n "$out" ]; then
  mkdir -p "$(dirname "$out")"
  printf '%s\n' "$header" > "$out"
fi

# Pre-fetch tasks for all relevant runs in one pass so we don't pay the
# round-trip per run. Forgejo's actions/tasks doesn't filter by run when
# given `?run=N` — we filter client-side by `run_number`.
all_tasks_payload="$(curl -sS -H "Authorization: token $token" -H "Accept: application/json" \
  "$api_base/repos/$owner/$repo/actions/tasks?limit=500" 2>/dev/null || echo '{}')"

durations_seconds=()

while IFS=$'\t' read -r run_id run_number wf event_name commit_sha status started stopped duration_ns; do
  [ -n "$run_id" ] || continue

  # Forgejo exposes a `duration` field in nanoseconds. Use it when present,
  # fall back to (stopped - started) for runs that report 0 (e.g. cancelled
  # before scheduling).
  if [ -n "$duration_ns" ] && [ "$duration_ns" != "null" ] && [ "$duration_ns" -gt 0 ] 2>/dev/null; then
    wall="$((duration_ns / 1000000000))"
  elif [ -n "$started" ] && [ "$started" != "null" ] && [ -n "$stopped" ] && [ "$stopped" != "null" ]; then
    s="$(date -u -d "$started" +%s 2>/dev/null || echo 0)"
    e="$(date -u -d "$stopped" +%s 2>/dev/null || echo 0)"
    if [ "$s" -gt 0 ] && [ "$e" -gt 0 ]; then
      wall="$((e - s))"
    else
      wall=0
    fi
  else
    wall=0
  fi

  task_count="$(echo "$all_tasks_payload" | jq -r --argjson n "$run_number" \
    '[.workflow_runs[]? | select(.run_number == $n)] | length')"
  failed_task_count="$(echo "$all_tasks_payload" | jq -r --argjson n "$run_number" \
    '[.workflow_runs[]? | select(.run_number == $n and .status == "failure")] | length')"

  durations_seconds+=("$wall")
  row="$run_id,$run_number,$wf,$event_name,$commit_sha,$status,$started,$stopped,$wall,$task_count,$failed_task_count"
  if [ -n "$out" ]; then
    printf '%s\n' "$row" >> "$out"
  fi
  printf '%s\n' "$row"
done < <(echo "$runs_payload" | jq -r --arg wf "$workflow" --argjson limit "$limit" \
  'limit($limit; .workflow_runs[]? | select(.workflow_id == $wf))
   | [.id, .index_in_repo, .workflow_id, .event, .commit_sha, .status, .started, .stopped, .duration]
   | @tsv')

# Stderr summary so this is useful from a `script` invocation as well as a
# CI step.
printf '\nworkflow=%s event=%s branch=%s n=%d\n' "$workflow" "${event:-*}" "${branch:-*}" "${#durations_seconds[@]}" >&2
printf 'wallclock seconds (sorted): %s\n' "$(printf '%s\n' "${durations_seconds[@]}" | sort -n | xargs)" >&2

if [ "${#durations_seconds[@]}" -gt 0 ]; then
  total=0
  for d in "${durations_seconds[@]}"; do total=$((total + d)); done
  mean=$((total / ${#durations_seconds[@]}))

  sorted=( $(printf '%s\n' "${durations_seconds[@]}" | sort -n) )
  p50_idx=$(( (${#sorted[@]} - 1) / 2 ))
  p90_idx=$(( (${#sorted[@]} * 9) / 10 ))
  [ "$p90_idx" -ge "${#sorted[@]}" ] && p90_idx=$(( ${#sorted[@]} - 1 ))

  printf 'mean=%ds  p50=%ds  p90=%ds  max=%ds\n' \
    "$mean" "${sorted[$p50_idx]}" "${sorted[$p90_idx]}" "${sorted[-1]}" >&2
fi

if [ -n "$out" ]; then
  ci_emit_notice "measure-wallclock: wrote $out"
fi
