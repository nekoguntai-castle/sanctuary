#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MERGE_SCRIPT="$ROOT_DIR/scripts/ci/backend-coverage-merge.sh"
SHARD_SCRIPT="$ROOT_DIR/scripts/ci/backend-coverage-shard.sh"
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

  bash -n "$MERGE_SCRIPT"
  bash -n "$SHARD_SCRIPT"

  # A crashed first attempt that already created the shard's coverage report
  # directory (and blob, and a scratch .tmp-* artifact) before segfaulting
  # must have those attempt artifacts renamed aside -- never deleted -- so
  # the retry attempt starts clean without losing crash diagnostics.
  local stale_dir_vitest_bin="$TEST_TEMP_DIR/stale-dir-vitest"
  local stale_dir_count="$TEST_TEMP_DIR/stale-dir-count"
  cat >"$stale_dir_vitest_bin" <<'STALE_DIR_VITEST'
#!/usr/bin/env bash
set -euo pipefail
attempt=1
if [ -f "$CAPTURED_VITEST_ATTEMPTS" ]; then
  attempt="$(($(cat "$CAPTURED_VITEST_ATTEMPTS") + 1))"
fi
printf '%s' "$attempt" >"$CAPTURED_VITEST_ATTEMPTS"
if [ "$attempt" -eq 1 ]; then
  mkdir -p coverage-shards/shard-1-2
  printf 'attempt-1-partial-coverage\n' > coverage-shards/shard-1-2/partial-coverage.json
  mkdir -p .vitest-reports
  printf 'attempt-1-partial-blob\n' > .vitest-reports/blob-1-2.json
  printf 'attempt-1-scratch\n' > coverage-shards/.tmp-scratch
  exit 139
fi
mkdir -p .vitest-reports
printf 'attempt-2-final-blob\n' > .vitest-reports/blob-1-2.json
STALE_DIR_VITEST
  chmod +x "$stale_dir_vitest_bin"

  (
    cd "$TEST_TEMP_DIR"
    CAPTURED_VITEST_ATTEMPTS="$stale_dir_count" VITEST_BIN="$stale_dir_vitest_bin" \
      bash "$SHARD_SCRIPT" 1 2
  )
  assert_file_equals '2' "$stale_dir_count"

  [ ! -e "$TEST_TEMP_DIR/coverage-shards/shard-1-2" ] || \
    fail 'expected the crashed attempt report directory not to remain at its original path'
  [ -d "$TEST_TEMP_DIR/coverage-shards/shard-1-2-attempt-1-failed" ] || \
    fail 'expected the crashed attempt report directory to be renamed aside, not deleted'
  assert_file_contains 'attempt-1-partial-coverage' \
    "$TEST_TEMP_DIR/coverage-shards/shard-1-2-attempt-1-failed/partial-coverage.json"

  [ -f "$TEST_TEMP_DIR/.vitest-reports/blob-1-2.json.attempt-1-failed" ] || \
    fail 'expected the crashed attempt blob report to be renamed aside, not deleted'
  assert_file_contains 'attempt-1-partial-blob' \
    "$TEST_TEMP_DIR/.vitest-reports/blob-1-2.json.attempt-1-failed"
  assert_file_contains 'attempt-2-final-blob' "$TEST_TEMP_DIR/.vitest-reports/blob-1-2.json"

  [ -f "$TEST_TEMP_DIR/coverage-shards/.tmp-scratch.attempt-1-failed" ] || \
    fail 'expected the crashed attempt .tmp-* scratch artifact to be renamed aside, not deleted'
  assert_file_contains 'attempt-1-scratch' \
    "$TEST_TEMP_DIR/coverage-shards/.tmp-scratch.attempt-1-failed"

  rm -rf "$TEST_TEMP_DIR/.vitest-reports" "$TEST_TEMP_DIR/coverage-shards" \
    "$TEST_TEMP_DIR/.tmp"

  # A coverage report directory that already existed before the shard script
  # ran at all (not created by a retry attempt) must still be refused.
  mkdir -p "$TEST_TEMP_DIR/coverage-shards/shard-1-2"
  local pre_existing_output="$TEST_TEMP_DIR/pre-existing-output"
  if (
    cd "$TEST_TEMP_DIR"
    VITEST_BIN="$stale_dir_vitest_bin" bash "$SHARD_SCRIPT" 1 2
  ) >"$pre_existing_output" 2>&1; then
    fail 'expected pre-existing backend coverage report directory to be refused'
  fi
  assert_file_contains 'refusing stale backend coverage report directory' "$pre_existing_output"

  rm -rf "$TEST_TEMP_DIR/.vitest-reports" "$TEST_TEMP_DIR/coverage-shards" \
    "$TEST_TEMP_DIR/.tmp"

  assert_fails_with 'blob report directory does not exist' bash "$MERGE_SCRIPT" "$TEST_TEMP_DIR/missing"
  mkdir "$TEST_TEMP_DIR/empty-reports"
  assert_fails_with 'no Vitest blob reports found' bash "$MERGE_SCRIPT" "$TEST_TEMP_DIR/empty-reports"

  local reports_with_stale_blob="$TEST_TEMP_DIR/reports-with-stale-blob"
  local merge_vitest_bin="$TEST_TEMP_DIR/merge-vitest"
  local captured_merge_reports_dir="$TEST_TEMP_DIR/merge-reports-dir"
  mkdir "$reports_with_stale_blob"
  : >"$reports_with_stale_blob/blob-1-2.json"
  : >"$reports_with_stale_blob/blob-2-2.json"
  : >"$reports_with_stale_blob/blob.json"
  cat >"$merge_vitest_bin" <<'MERGE_VITEST'
#!/usr/bin/env bash
set -euo pipefail

reports_arg=''
previous_arg=''
for arg in "$@"; do
  if [ "$previous_arg" = "--mergeReports" ]; then
    reports_arg="$arg"
    break
  fi
  previous_arg="$arg"
done

if [ -z "$reports_arg" ]; then
  echo 'missing --mergeReports argument' >&2
  exit 1
fi

printf '%s' "$reports_arg" >"$CAPTURED_MERGE_REPORTS_DIR"

if [ "$reports_arg" = "$ORIGINAL_REPORTS_DIR" ]; then
  echo 'merge reused original report directory' >&2
  exit 1
fi

if [ -e "$reports_arg/blob.json" ]; then
  echo 'stale blob.json was copied into merge directory' >&2
  exit 1
fi

[ -f "$reports_arg/blob-1-2.json" ] || { echo 'missing blob-1-2.json' >&2; exit 1; }
[ -f "$reports_arg/blob-2-2.json" ] || { echo 'missing blob-2-2.json' >&2; exit 1; }

mkdir -p coverage
printf '{}\n' >coverage/coverage-summary.json
MERGE_VITEST
  chmod +x "$merge_vitest_bin"

  (
    cd "$TEST_TEMP_DIR"
    CAPTURED_MERGE_REPORTS_DIR="$captured_merge_reports_dir" \
      ORIGINAL_REPORTS_DIR="$reports_with_stale_blob" \
      VITEST_BIN="$merge_vitest_bin" \
      bash "$MERGE_SCRIPT" "$reports_with_stale_blob"
  )
  [ "$(cat "$captured_merge_reports_dir")" != "$reports_with_stale_blob" ] || \
    fail 'expected merge script to use a sanitized report directory'

  echo 'backend coverage script regression checks passed'
}

main "$@"
