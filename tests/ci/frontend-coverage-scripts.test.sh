#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHARD_SCRIPT="$ROOT_DIR/scripts/ci/frontend-coverage-shard.sh"
MERGE_SCRIPT="$ROOT_DIR/scripts/ci/frontend-coverage-merge.sh"
TEST_TEMP_DIR=''

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}

assert_fails_with() {
  local expected="$1"
  shift

  local output_file="$TEST_TEMP_DIR/output"
  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi

  grep -Fq "$expected" "$output_file" || fail "expected output to contain: ${expected}"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$SHARD_SCRIPT"
  bash -n "$MERGE_SCRIPT"

  assert_fails_with 'expected shard index and shard total' bash "$SHARD_SCRIPT"
  assert_fails_with 'shard index must be a positive integer' bash "$SHARD_SCRIPT" 0 2
  assert_fails_with 'shard total must be a positive integer' bash "$SHARD_SCRIPT" 1 nope
  assert_fails_with 'shard index must be less than or equal to shard total' bash "$SHARD_SCRIPT" 3 2

  assert_fails_with 'blob report directory does not exist' bash "$MERGE_SCRIPT" "$TEST_TEMP_DIR/missing"
  mkdir "$TEST_TEMP_DIR/empty-reports"
  assert_fails_with 'no Vitest blob reports found' bash "$MERGE_SCRIPT" "$TEST_TEMP_DIR/empty-reports"

  echo 'frontend coverage script regression checks passed'
}

main "$@"
