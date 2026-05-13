#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/ci/report-timing-notices.sh --run RUN_ID [--job-filter TEXT]
  scripts/ci/report-timing-notices.sh --log-file FILE

Parse CI timing notices/errors emitted by scripts/ci/time-command.sh and print
a duration table. Live mode fetches matching job logs with gh; fixture mode
reads a raw GitHub Actions log file.
USAGE
}

fail() {
  echo "report-timing-notices: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

format_seconds() {
  local seconds="$1"
  printf '%dm %ds' "$((seconds / 60))" "$((seconds % 60))"
}

run_id=''
job_filter=''
log_file=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --run)
      [ "$#" -ge 2 ] || fail '--run requires a value'
      run_id="$2"
      shift 2
      ;;
    --job-filter)
      [ "$#" -ge 2 ] || fail '--job-filter requires a value'
      job_filter="$2"
      shift 2
      ;;
    --log-file)
      [ "$#" -ge 2 ] || fail '--log-file requires a value'
      log_file="$2"
      shift 2
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

parse_logs() {
  local input_file="$1"
  local parsed_file="$2"

  while IFS= read -r line; do
    line="$(printf '%s' "$line" | sed -E 's/\x1B\[[0-9;]*[[:alpha:]]//g')"

    local label seconds job
    label="$(printf '%s\n' "$line" | sed -nE 's/^(([^\t]*\t){2})?.*(##\[(notice|error)\]|::(notice|error) title=CI timing::)(.*) completed in .*\(([0-9]+)s\).*$/\6/p')"
    seconds="$(printf '%s\n' "$line" | sed -nE 's/^(([^\t]*\t){2})?.*(##\[(notice|error)\]|::(notice|error) title=CI timing::).* completed in .*\(([0-9]+)s\).*$/\6/p')"

    if [ -z "$label" ] || [ -z "$seconds" ]; then
      continue
    fi

    if [[ "$line" == *$'\t'* ]]; then
      job="${line%%$'\t'*}"
    else
      job='n/a'
    fi

    printf '%s\t%s\t%s\n' "$seconds" "$job" "$label" >> "$parsed_file"
  done < "$input_file"
}

print_report() {
  local parsed_file="$1"

  if [ ! -s "$parsed_file" ]; then
    fail 'no CI timing notices found'
  fi

  echo 'Seconds | Duration | Job | Label'
  echo '--- | --- | --- | ---'

  sort -nr "$parsed_file" | while IFS=$'\t' read -r seconds job label; do
    printf '%s | %s | %s | %s\n' "$seconds" "$(format_seconds "$seconds")" "$job" "$label"
  done
}

main() {
  require_command sed
  require_command sort

  if [ -n "$log_file" ] && [ -n "$run_id" ]; then
    fail 'use either --run or --log-file, not both'
  fi

  local temp_dir combined_log parsed
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "${temp_dir:-}"' EXIT
  combined_log="$temp_dir/combined.log"
  parsed="$temp_dir/parsed.tsv"

  if [ -n "$log_file" ]; then
    [ -f "$log_file" ] || fail "log file not found: $log_file"
    cp "$log_file" "$combined_log"
  elif [ -n "$run_id" ]; then
    require_command gh
    require_command jq

    gh run view "$run_id" --json jobs --jq '.jobs[] | [.databaseId, .name] | @tsv' |
      while IFS=$'\t' read -r job_id job_name; do
        [ -n "$job_id" ] || continue
        if [ -n "$job_filter" ] && [[ "$job_name" != *"$job_filter"* ]]; then
          continue
        fi
        gh run view --job "$job_id" --log >> "$combined_log"
      done
  else
    usage >&2
    exit 1
  fi

  parse_logs "$combined_log" "$parsed"
  print_report "$parsed"
}

main "$@"
