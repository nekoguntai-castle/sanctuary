#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/forgejo-report-api.sh
source "$SCRIPT_DIR/forgejo-report-api.sh"

usage() {
  cat <<'USAGE'
Usage:
  scripts/ci/report-timing-notices.sh --run RUN_ID [--job-filter TEXT]
  scripts/ci/report-timing-notices.sh --log-file FILE

Parse CI timing notices/errors emitted by scripts/ci/time-command.sh and print
a duration table. Live mode reads the Forgejo run-log archive; fixture mode
reads a raw Actions log file.
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
    [[ "$run_id" =~ ^[1-9][0-9]*$ ]] || fail '--run must be a positive integer'
    require_command curl
    require_command python3
    forgejo_report_resolve_context || fail 'could not resolve Forgejo API context'

    local archive="$temp_dir/run-logs.zip"
    forgejo_report_get "actions/runs/$run_id/logs" "$archive" 268435456 application/zip \
      || fail "could not fetch logs for workflow run $run_id"
    [ "$(wc -c < "$archive")" -le 268435456 ] \
      || fail 'workflow log archive exceeds the 256 MiB safety bound'

    if ! python3 - "$archive" "$job_filter" > "$combined_log" <<'PY'
import re
import sys
import zipfile

archive_path = sys.argv[1]
job_filter = sys.argv[2]
member_re = re.compile(r"^(.+)-([0-9]+)-attempt-([0-9]+)\.log$")
selected = 0
expanded_bytes = 0
maximum_expanded_bytes = 512 * 1024 * 1024

try:
    archive = zipfile.ZipFile(archive_path)
except (OSError, zipfile.BadZipFile) as exc:
    print(f"report-timing-notices: invalid Forgejo log archive: {exc}", file=sys.stderr)
    raise SystemExit(2)

with archive:
    for info in archive.infolist():
        if "/" in info.filename or "\\" in info.filename:
            continue
        match = member_re.fullmatch(info.filename)
        if not match:
            continue
        job_name = match.group(1)
        if job_filter and job_filter not in job_name:
            continue
        expanded_bytes += info.file_size
        if expanded_bytes > maximum_expanded_bytes:
            print("report-timing-notices: expanded logs exceed the 512 MiB safety bound", file=sys.stderr)
            raise SystemExit(2)
        selected += 1
        for line in archive.read(info).decode("utf-8", errors="replace").splitlines():
            print(f"{job_name}\tarchive\t{line}")

if selected == 0:
    print("report-timing-notices: no matching Forgejo job logs found", file=sys.stderr)
    raise SystemExit(3)
PY
    then
      fail "could not read matching logs for workflow run $run_id"
    fi
  else
    usage >&2
    exit 1
  fi

  parse_logs "$combined_log" "$parsed"
  print_report "$parsed"
}

main "$@"
