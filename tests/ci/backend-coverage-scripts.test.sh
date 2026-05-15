#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MERGE_SCRIPT="$ROOT_DIR/scripts/ci/backend-coverage-merge.sh"
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

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$MERGE_SCRIPT"

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
