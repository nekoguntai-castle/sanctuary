#!/usr/bin/env bash
# Run independent shell test commands concurrently, one log per command.
#
# Usage:
#   scripts/ci/run-parallel-suites.sh LOG_DIR < COMMANDS
#
# COMMANDS holds one command per line; blank lines and `#` comments are skipped.
# Every command runs to completion under `bash -euo pipefail -c`, with at most
# SANCTUARY_PARALLEL_SUITES_JOBS (default 4) at once. Each command's combined
# output goes to its own log, so parallel output never interleaves. The summary
# names every failed command and prints its log, and the run fails if any
# command failed or if fewer commands finished than were read.
#
# Only commands that share no fixed paths, locks, ports or checkout writes may
# be listed (R7 of tasks/ci-speedup-analysis-2026-09-29.md). Anything they all
# need, such as a dependency install, must run before this script.
set -euo pipefail

if [ "${1:-}" = '--one' ]; then
  # Internal: run one command, recording its exit status beside its log.
  [ "$#" -eq 4 ] || { echo 'run-parallel-suites: --one needs LOG_DIR INDEX COMMAND' >&2; exit 2; }
  log_dir="$2"
  index="$3"
  command_line="$4"
  status=0
  bash -euo pipefail -c "$command_line" >"$log_dir/$index.log" 2>&1 </dev/null || status=$?
  printf '%s\n' "$status" >"$log_dir/$index.status"
  exit 0
fi

if [ "$#" -ne 1 ]; then
  echo 'Usage: run-parallel-suites.sh LOG_DIR < COMMANDS' >&2
  exit 2
fi

log_dir="$1"
jobs="${SANCTUARY_PARALLEL_SUITES_JOBS:-4}"
case "$jobs" in
  '' | *[!0-9]* | 0)
    echo "run-parallel-suites: SANCTUARY_PARALLEL_SUITES_JOBS must be a positive integer, got '${jobs}'" >&2
    exit 2
    ;;
esac

commands=()
while IFS= read -r line || [ -n "$line" ]; do
  trimmed="${line#"${line%%[![:space:]]*}"}"
  case "$trimmed" in
    '' | '#'*) continue ;;
  esac
  commands+=("$trimmed")
done

if [ "${#commands[@]}" -eq 0 ]; then
  echo 'run-parallel-suites: no commands were given' >&2
  exit 1
fi

mkdir -p "$log_dir"
# Stale results from an earlier run in the same directory must not count.
for index in "${!commands[@]}"; do
  rm -f "$log_dir/$index.log" "$log_dir/$index.status"
done

script_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
start_epoch="$(date +%s)"
# xargs exits non-zero only on its own failure here: each --one invocation
# records the command's status in a file and exits 0.
for index in "${!commands[@]}"; do
  printf '%s\0%s\0' "$index" "${commands[$index]}"
done | xargs -0 -n 2 -P "$jobs" bash "$script_path" --one "$log_dir"

failed=()
missing=()
for index in "${!commands[@]}"; do
  status_file="$log_dir/$index.status"
  if [ ! -f "$status_file" ]; then
    missing+=("$index")
  elif [ "$(cat "$status_file")" != '0' ]; then
    failed+=("$index")
  fi
done

total="${#commands[@]}"
finished=$((total - ${#missing[@]}))
elapsed=$(( $(date +%s) - start_epoch ))
echo "run-parallel-suites: ${finished}/${total} commands finished, ${#failed[@]} failed, ${elapsed}s with ${jobs} jobs"

for index in "${failed[@]}"; do
  echo "::group::FAILED (exit $(cat "$log_dir/$index.status")): ${commands[$index]}"
  cat "$log_dir/$index.log"
  echo '::endgroup::'
done
for index in "${failed[@]}"; do
  echo "run-parallel-suites: FAILED: ${commands[$index]} (log: $log_dir/$index.log)" >&2
done
for index in "${missing[@]}"; do
  echo "run-parallel-suites: DID NOT FINISH: ${commands[$index]}" >&2
done

[ "${#failed[@]}" -eq 0 ] && [ "${#missing[@]}" -eq 0 ]
