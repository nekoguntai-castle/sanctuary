#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <shard-index> <shard-total>" >&2
}

fail() {
  echo "frontend-coverage-shard: $*" >&2
  exit 1
}

is_positive_integer() {
  [[ "${1:-}" =~ ^[1-9][0-9]*$ ]]
}

is_safe_relative_path() {
  case "${1:-}" in
    ''|/*|.|..|../*|*/..|*/../*)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

coverage_reports_dir_for_shard() {
  local shard_index="$1"
  local shard_total="$2"

  printf '%s' "${SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR:-coverage-shards/shard-${shard_index}-${shard_total}}"
}

run_vitest_shard_once() {
  local vitest_bin="$1"
  local shard_index="$2"
  local shard_total="$3"
  local expected_blob="$4"
  local coverage_reports_dir
  coverage_reports_dir="$(coverage_reports_dir_for_shard "$shard_index" "$shard_total")"

  is_safe_relative_path "$coverage_reports_dir" || \
    fail 'SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR must be a safe relative path'

  rm -f "$expected_blob"
  rm -rf "$coverage_reports_dir"
  mkdir -p "$(dirname "$coverage_reports_dir")"

  SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR="$coverage_reports_dir" "$vitest_bin" run \
    --pool forks \
    --maxWorkers=1 \
    --no-file-parallelism \
    --coverage \
    --config vitest.coverage-shard.config.ts \
    --shard "${shard_index}/${shard_total}"
}

is_retryable_vitest_infrastructure_failure() {
  local status="$1"
  local output_file="$2"

  if [ "$status" -eq 139 ]; then
    return 0
  fi

  [ -f "$output_file" ] || return 1

  grep -Eiq \
    '(^|[^[:alnum:]_])EPIPE([^[:alnum:]_]|$)|ERR_IPC_CHANNEL_CLOSED|IPC channel|channel closed|worker (exited unexpectedly|terminated|died)|Failed to terminate worker|Segmentation fault|core dumped' \
    "$output_file"
}

run_vitest_shard_with_native_retry() {
  local vitest_bin="$1"
  local shard_index="$2"
  local shard_total="$3"
  local expected_blob="$4"
  local attempts="${SANCTUARY_FRONTEND_COVERAGE_SEGFAULT_ATTEMPTS:-3}"

  is_positive_integer "$attempts" || fail 'SANCTUARY_FRONTEND_COVERAGE_SEGFAULT_ATTEMPTS must be a positive integer'

  local log_dir="${SANCTUARY_FRONTEND_COVERAGE_LOG_DIR:-.tmp/frontend-coverage}"
  mkdir -p "$log_dir"

  local attempt attempt_log status
  for attempt in $(seq 1 "$attempts"); do
    attempt_log="${log_dir}/shard-${shard_index}-${shard_total}-attempt-${attempt}.log"
    set +e
    run_vitest_shard_once "$vitest_bin" "$shard_index" "$shard_total" "$expected_blob" 2>&1 | tee "$attempt_log"
    status="${PIPESTATUS[0]}"
    set -e

    if [ "$status" -eq 0 ]; then
      return 0
    fi
    if ! is_retryable_vitest_infrastructure_failure "$status" "$attempt_log" || [ "$attempt" -eq "$attempts" ]; then
      return "$status"
    fi

    echo "frontend-coverage-shard: retrying shard ${shard_index}/${shard_total} after retryable Vitest infrastructure failure (attempt $((attempt + 1))/${attempts})" >&2
  done
}

main() {
  if [ "$#" -ne 2 ]; then
    usage
    fail 'expected shard index and shard total'
  fi

  local shard_index_arg="$1"
  local shard_total_arg="$2"

  is_positive_integer "$shard_index_arg" || fail 'shard index must be a positive integer'
  is_positive_integer "$shard_total_arg" || fail 'shard total must be a positive integer'

  local shard_index=$((10#$shard_index_arg))
  local shard_total=$((10#$shard_total_arg))

  if [ "$shard_index" -gt "$shard_total" ]; then
    fail 'shard index must be less than or equal to shard total'
  fi

  # Workspace-aware binary lookup: cwd first, then walk up for hoisted bins.
  local vitest_bin="${VITEST_BIN:-}"
  if [ -z "$vitest_bin" ]; then
    if [ -x "./node_modules/.bin/vitest" ]; then
      vitest_bin="./node_modules/.bin/vitest"
    elif [ -x "../node_modules/.bin/vitest" ]; then
      vitest_bin="../node_modules/.bin/vitest"
    fi
  fi
  if [ -z "$vitest_bin" ] || [ ! -x "$vitest_bin" ]; then
    fail "Vitest binary not found in ./node_modules/.bin or ../node_modules/.bin; run npm ci first"
  fi

  local expected_blob=".vitest-reports/blob-${shard_index}-${shard_total}.json"
  mkdir -p .vitest-reports
  run_vitest_shard_with_native_retry "$vitest_bin" "$shard_index" "$shard_total" "$expected_blob"

  if [ ! -f "$expected_blob" ]; then
    fail "expected Vitest blob report at ${expected_blob}"
  fi
}

main "$@"
