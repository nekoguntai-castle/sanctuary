#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_SCRIPT="$ROOT_DIR/scripts/ci/with-runner-lock.sh"
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

  bash -n "$LOCK_SCRIPT"

  assert_fails_with 'expected a lock name and command' bash "$LOCK_SCRIPT"
  assert_fails_with 'lock name may contain only' bash "$LOCK_SCRIPT" '../bad' true
  assert_fails_with 'must be a positive integer' env SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS=0 bash "$LOCK_SCRIPT" test true

  local lock_dir="$TEST_TEMP_DIR/locks"
  local marker="$TEST_TEMP_DIR/marker"
  SANCTUARY_RUNNER_LOCK_DIR="$lock_dir" bash "$LOCK_SCRIPT" test-lock bash -c "printf ok > '$marker'"

  [ -f "$marker" ] || fail 'expected command to run under lock'
  [ "$(cat "$marker")" = 'ok' ] || fail 'expected locked command output marker'
  [ -f "$lock_dir/test-lock.lock" ] || fail 'expected lock file to be created'
  [ "$(stat -c '%a' "$lock_dir")" = '1777' ] || fail 'expected lock directory to be sticky and cross-user writable'
  [ "$(stat -c '%a' "$lock_dir/test-lock.lock")" = '666' ] || fail 'expected lock file to be cross-user writable'

  if SANCTUARY_RUNNER_LOCK_DIR="$lock_dir" bash "$LOCK_SCRIPT" test-lock bash -c 'exit 42'; then
    fail 'expected locked command failure to propagate'
  else
    status="$?"
    [ "$status" -eq 42 ] || fail "expected exit status 42, got ${status}"
  fi

  echo 'runner lock regression checks passed'
}

main "$@"
