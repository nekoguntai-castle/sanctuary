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

  grep -Fq -- "$expected" "$output_file" || fail "expected output to contain: ${expected}"
}

assert_file_contains() {
  local expected="$1"
  local file="$2"

  grep -Fq -- "$expected" "$file" || fail "expected ${file} to contain: ${expected}"
}

assert_file_equals() {
  local expected="$1"
  local file="$2"
  local actual
  actual="$(cat "$file")"

  [ "$actual" = "$expected" ] || fail "expected ${file} to equal ${expected}, got ${actual}"
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

  local fake_vitest_bin="$TEST_TEMP_DIR/fake-vitest"
  local captured_args="$TEST_TEMP_DIR/vitest-args"
  local captured_reports_dir="$TEST_TEMP_DIR/coverage-reports-dir"
  cat >"$fake_vitest_bin" <<'FAKE_VITEST'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >"$CAPTURED_VITEST_ARGS"
printf '%s\n' "${SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR:-}" >"$CAPTURED_COVERAGE_REPORTS_DIR"
mkdir -p .vitest-reports
: > .vitest-reports/blob-1-2.json
FAKE_VITEST
  chmod +x "$fake_vitest_bin"

  (
    cd "$TEST_TEMP_DIR"
    CAPTURED_COVERAGE_REPORTS_DIR="$captured_reports_dir" \
      CAPTURED_VITEST_ARGS="$captured_args" \
      VITEST_BIN="$fake_vitest_bin" \
      bash "$SHARD_SCRIPT" 1 2
  )
  assert_file_contains '--pool' "$captured_args"
  assert_file_contains 'forks' "$captured_args"
  assert_file_contains '--maxWorkers=1' "$captured_args"
  assert_file_contains '--no-file-parallelism' "$captured_args"
  assert_file_contains '--shard' "$captured_args"
  assert_file_contains '1/2' "$captured_args"
  assert_file_equals 'coverage-shards/shard-1-2' "$captured_reports_dir"

  assert_fails_with 'SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR must be a safe relative path' \
    env VITEST_BIN="$fake_vitest_bin" \
      SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR=/tmp/not-safe \
      bash "$SHARD_SCRIPT" 1 2

  local retry_vitest_bin="$TEST_TEMP_DIR/retry-vitest"
  local retry_count="$TEST_TEMP_DIR/retry-count"
  cat >"$retry_vitest_bin" <<'RETRY_VITEST'
#!/usr/bin/env bash
set -euo pipefail
attempt=1
if [ -f "$CAPTURED_VITEST_ATTEMPTS" ]; then
  attempt="$(($(cat "$CAPTURED_VITEST_ATTEMPTS") + 1))"
fi
printf '%s' "$attempt" >"$CAPTURED_VITEST_ATTEMPTS"
if [ "$attempt" -eq 1 ]; then
  exit 139
fi
mkdir -p .vitest-reports
: > .vitest-reports/blob-1-2.json
RETRY_VITEST
  chmod +x "$retry_vitest_bin"

  (
    cd "$TEST_TEMP_DIR"
    CAPTURED_VITEST_ATTEMPTS="$retry_count" VITEST_BIN="$retry_vitest_bin" bash "$SHARD_SCRIPT" 1 2
  )
  assert_file_equals '2' "$retry_count"

  local ipc_vitest_bin="$TEST_TEMP_DIR/ipc-vitest"
  local ipc_count="$TEST_TEMP_DIR/ipc-count"
  cat >"$ipc_vitest_bin" <<'IPC_VITEST'
#!/usr/bin/env bash
set -euo pipefail
attempt=1
if [ -f "$CAPTURED_VITEST_ATTEMPTS" ]; then
  attempt="$(($(cat "$CAPTURED_VITEST_ATTEMPTS") + 1))"
fi
printf '%s' "$attempt" >"$CAPTURED_VITEST_ATTEMPTS"
if [ "$attempt" -eq 1 ]; then
  echo 'Error: write EPIPE while terminating Vitest worker' >&2
  exit 1
fi
mkdir -p .vitest-reports
: > .vitest-reports/blob-1-2.json
IPC_VITEST
  chmod +x "$ipc_vitest_bin"

  (
    cd "$TEST_TEMP_DIR"
    CAPTURED_VITEST_ATTEMPTS="$ipc_count" VITEST_BIN="$ipc_vitest_bin" bash "$SHARD_SCRIPT" 1 2
  )
  assert_file_equals '2' "$ipc_count"

  local fail_vitest_bin="$TEST_TEMP_DIR/fail-vitest"
  local fail_count="$TEST_TEMP_DIR/fail-count"
  local fail_output="$TEST_TEMP_DIR/fail-output"
  cat >"$fail_vitest_bin" <<'FAIL_VITEST'
#!/usr/bin/env bash
set -euo pipefail
attempt=1
if [ -f "$CAPTURED_VITEST_ATTEMPTS" ]; then
  attempt="$(($(cat "$CAPTURED_VITEST_ATTEMPTS") + 1))"
fi
printf '%s' "$attempt" >"$CAPTURED_VITEST_ATTEMPTS"
echo 'non-retryable-vitest-failure' >&2
exit 1
FAIL_VITEST
  chmod +x "$fail_vitest_bin"

  if (
    cd "$TEST_TEMP_DIR"
    CAPTURED_VITEST_ATTEMPTS="$fail_count" VITEST_BIN="$fail_vitest_bin" bash "$SHARD_SCRIPT" 1 2
  ) >"$fail_output" 2>&1; then
    fail 'expected non-139 Vitest failure to fail'
  fi
  assert_file_contains 'non-retryable-vitest-failure' "$fail_output"
  assert_file_equals '1' "$fail_count"

  assert_fails_with 'blob report directory does not exist' bash "$MERGE_SCRIPT" "$TEST_TEMP_DIR/missing"
  mkdir "$TEST_TEMP_DIR/empty-reports"
  assert_fails_with 'no Vitest blob reports found' bash "$MERGE_SCRIPT" "$TEST_TEMP_DIR/empty-reports"

  echo 'frontend coverage script regression checks passed'
}

main "$@"
