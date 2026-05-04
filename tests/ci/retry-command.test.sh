#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RETRY_SCRIPT="$ROOT_DIR/scripts/ci/retry-command.sh"
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

assert_file_equals() {
  local expected="$1"
  local file="$2"
  local actual
  actual="$(cat "$file")"
  [ "$actual" = "$expected" ] || fail "expected ${file} to contain ${expected}, got ${actual}"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$RETRY_SCRIPT"

  assert_fails_with 'expected a label and command' bash "$RETRY_SCRIPT"
  assert_fails_with 'SANCTUARY_RETRY_ATTEMPTS must be a positive integer' env SANCTUARY_RETRY_ATTEMPTS=0 bash "$RETRY_SCRIPT" test true
  assert_fails_with 'SANCTUARY_RETRY_DELAY_SECONDS must be a non-negative integer' env SANCTUARY_RETRY_DELAY_SECONDS=-1 bash "$RETRY_SCRIPT" test true

  local counter="$TEST_TEMP_DIR/counter"
  printf '0' >"$counter"
  SANCTUARY_RETRY_DELAY_SECONDS=0 bash "$RETRY_SCRIPT" immediate bash -c "
    count=\$(cat '$counter')
    printf '%s' \"\$((count + 1))\" > '$counter'
  "
  assert_file_equals '1' "$counter"

  printf '0' >"$counter"
  SANCTUARY_RETRY_DELAY_SECONDS=0 SANCTUARY_RETRY_ATTEMPTS=3 bash "$RETRY_SCRIPT" eventual bash -c "
    count=\$(cat '$counter')
    count=\$((count + 1))
    printf '%s' \"\$count\" > '$counter'
    [ \"\$count\" -ge 3 ]
  "
  assert_file_equals '3' "$counter"

  printf '0' >"$counter"
  if SANCTUARY_RETRY_DELAY_SECONDS=0 SANCTUARY_RETRY_ATTEMPTS=2 bash "$RETRY_SCRIPT" failure bash -c "
    count=\$(cat '$counter')
    printf '%s' \"\$((count + 1))\" > '$counter'
    exit 42
  "; then
    fail 'expected final failure status to propagate'
  else
    status="$?"
    [ "$status" -eq 42 ] || fail "expected status 42, got ${status}"
  fi
  assert_file_equals '2' "$counter"

  echo 'retry-command regression checks passed'
}

main "$@"
