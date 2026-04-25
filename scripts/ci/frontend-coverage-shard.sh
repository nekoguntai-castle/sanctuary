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

  local vitest_bin="${VITEST_BIN:-./node_modules/.bin/vitest}"
  if [ ! -x "$vitest_bin" ]; then
    fail "Vitest binary not found at ${vitest_bin}; run npm ci first"
  fi

  local expected_blob=".vitest-reports/blob-${shard_index}-${shard_total}.json"
  mkdir -p .vitest-reports
  rm -f "$expected_blob"
  rm -rf coverage-shards

  "$vitest_bin" run \
    --coverage \
    --config vitest.coverage-shard.config.ts \
    --shard "${shard_index}/${shard_total}"

  if [ ! -f "$expected_blob" ]; then
    fail "expected Vitest blob report at ${expected_blob}"
  fi
}

main "$@"
