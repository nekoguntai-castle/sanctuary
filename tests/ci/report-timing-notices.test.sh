#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TIMING_SCRIPT="$ROOT_DIR/scripts/ci/report-timing-notices.sh"
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

assert_contains() {
  local file="$1"
  local expected="$2"

  grep -Fq -- "$expected" "$file" || fail "expected output to contain: $expected"
}

assert_fails_with() {
  local expected="$1"
  shift

  local output_file="$TEST_TEMP_DIR/failure-output"
  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi

  assert_contains "$output_file" "$expected"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  local log_file output_file
  log_file="$TEST_TEMP_DIR/github.log"
  output_file="$TEST_TEMP_DIR/output"

  cat > "$log_file" <<'LOG'
Full Browser E2E Tests (wallet-experience)	Install frontend dependencies	2026-04-30T02:47:56Z ##[notice]browser npm ci completed in 0m 23s (23s)
Full Browser E2E Tests (wallet-experience)	Run browser-flow E2E tests	2026-04-30T02:50:10Z ##[notice]browser-flow E2E wallet-experience completed in 1m 7s (67s)
Quick Browser Smoke	Run browser smoke	2026-04-30T02:50:10Z ::notice title=CI timing::quick browser smoke completed in 0m 8s (8s)
LOG

  bash "$TIMING_SCRIPT" --log-file "$log_file" > "$output_file"

  assert_contains "$output_file" 'Seconds | Duration | Job | Label'
  assert_contains "$output_file" '67 | 1m 7s | Full Browser E2E Tests (wallet-experience) | browser-flow E2E wallet-experience'
  assert_contains "$output_file" '23 | 0m 23s | Full Browser E2E Tests (wallet-experience) | browser npm ci'
  assert_contains "$output_file" '8 | 0m 8s | Quick Browser Smoke | quick browser smoke'

  local empty_log_file
  empty_log_file="$TEST_TEMP_DIR/empty.log"
  : > "$empty_log_file"
  assert_fails_with 'no CI timing notices found' bash "$TIMING_SCRIPT" --log-file "$empty_log_file"

  echo 'report-timing-notices tests passed.'
}

main "$@"
