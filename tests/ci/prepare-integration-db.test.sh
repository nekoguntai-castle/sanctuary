#!/usr/bin/env bash
# Regression checks for scripts/ci/prepare-integration-db.sh that do NOT require
# a database (so they run in the dependency-free CI classifier lane). The
# happy-path (wait -> migrate -> assert) is exercised live by the backend
# integration lanes in test.yml.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/prepare-integration-db.sh"
REAL_NODE="$(command -v node)"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/prepare-integration-db.XXXXXX")"
STUB_BIN="$TEST_TMP/bin"
TEST_FAILURES=0

mkdir -p "$STUB_BIN"
trap 'rm -rf -- "$TEST_TMP"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_status() {
  # Runs the script with the given env assignments (passed as VAR=value args)
  # and echoes its exit status without aborting this test under `set -e`.
  local status
  set +e
  env "$@" bash "$SCRIPT" >/dev/null 2>&1
  status=$?
  set -e
  echo "$status"
}

record_failure() {
  echo "FAIL: $*" >&2
  TEST_FAILURES=$((TEST_FAILURES + 1))
}

expect_equal() {
  local expected="$1"
  local actual="$2"
  local description="$3"
  [ "$actual" = "$expected" ] || record_failure "$description: expected '$expected', got '$actual'"
}

create_stubs() {
  cat > "$STUB_BIN/node" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  */integration-db-guard.mjs)
    exec "$REAL_NODE" "$@"
    ;;
  */check-integration-db.mjs)
    case "$2" in
      wait) exit "${WAIT_STATUS:-0}" ;;
      assert)
        count_file="$TEST_CASE/assert.count"
        count=0
        [ ! -f "$count_file" ] || count="$(<"$count_file")"
        count=$((count + 1))
        printf '%s\n' "$count" > "$count_file"
        if [ "$count" -le "${ASSERT_FAILURES:-0}" ]; then exit 1; fi
        exit "${ASSERT_STATUS:-0}"
        ;;
    esac
    ;;
esac
exec "$REAL_NODE" "$@"
STUB
  cat > "$STUB_BIN/npx" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 3 ] && [ "$1 $2 $3" = "prisma migrate deploy" ] || exit 97
printf '%s\t%s\n' "${DATABASE_URL-<unset>}" "${TEST_DATABASE_URL-<unset>}" >> "$TEST_CASE/migrate.env"
count_file="$TEST_CASE/migrate.count"
count=0
[ ! -f "$count_file" ] || count="$(<"$count_file")"
printf '%s\n' "$((count + 1))" > "$count_file"
exit "${MIGRATE_STATUS:-0}"
STUB
  cat > "$STUB_BIN/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$STUB_BIN/node" "$STUB_BIN/npx" "$STUB_BIN/sleep"
}

run_stubbed() {
  local case_name="$1"
  local clear_database_url="$2"
  shift 2
  local case_dir="$TEST_TMP/$case_name"
  mkdir -p "$case_dir"
  local status
  if [ "$clear_database_url" = true ]; then
    if env -u DATABASE_URL PATH="$STUB_BIN:$PATH" REAL_NODE="$REAL_NODE" TEST_CASE="$case_dir" "$@" \
      bash "$SCRIPT" > "$case_dir/output.log" 2>&1; then
      status=0
    else
      status=$?
    fi
  elif env PATH="$STUB_BIN:$PATH" REAL_NODE="$REAL_NODE" TEST_CASE="$case_dir" "$@" \
    bash "$SCRIPT" > "$case_dir/output.log" 2>&1; then
    status=0
  else
    status=$?
  fi
  printf '%s\n' "$status"
}

file_line() {
  local file="$1"
  local line="$2"
  sed -n "${line}p" "$file"
}

line_count() {
  local file="$1"
  [ ! -f "$file" ] && { echo 0; return; }
  wc -l < "$file" | tr -d ' '
}

[ -f "$SCRIPT" ] || fail "missing $SCRIPT"
[ -x "$SCRIPT" ] || fail "$SCRIPT is not executable"
create_stubs

# Non-integer attempt count is rejected before any DB work (exit 2).
status="$(run_status SANCTUARY_DB_MIGRATE_ATTEMPTS=abc DATABASE_URL=postgresql://u:p@127.0.0.1:1/db)"
[ "$status" = "2" ] || fail "expected exit 2 for non-integer SANCTUARY_DB_MIGRATE_ATTEMPTS, got $status"

# Zero attempts is rejected too (exit 2).
status="$(run_status SANCTUARY_DB_MIGRATE_ATTEMPTS=0 DATABASE_URL=postgresql://u:p@127.0.0.1:1/db)"
[ "$status" = "2" ] || fail "expected exit 2 for zero SANCTUARY_DB_MIGRATE_ATTEMPTS, got $status"

test_url='postgresql://test:test@localhost:5432/integration_test'
status="$(run_stubbed different-databases false \
  TEST_DATABASE_URL="$test_url" \
  DATABASE_URL='postgresql://prod:prod@prod.example.invalid:5432/sanctuary')"
expect_equal 0 "$status" 'different-URL setup should otherwise succeed'
expected_pair="$test_url$(printf '\t')$test_url"
actual_pair="$(file_line "$TEST_TMP/different-databases/migrate.env" 1)"
expect_equal "$expected_pair" "$actual_pair" 'migration must receive only the guarded URL'

status="$(run_stubbed missing-inherited-database-url true TEST_DATABASE_URL="$test_url")"
expect_equal 0 "$status" 'TEST_DATABASE_URL-only setup should succeed'
actual_pair="$(file_line "$TEST_TMP/missing-inherited-database-url/migrate.env" 1)"
expect_equal "$expected_pair" "$actual_pair" 'migration must not use Prisma fallback when DATABASE_URL is absent'

status="$(run_stubbed failed-migration-existing-schema false \
  TEST_DATABASE_URL="$test_url" DATABASE_URL="$test_url" MIGRATE_STATUS=42)"
expect_equal 42 "$status" 'failed migration with existing schema must retain its failure status'
expect_equal 1 "$(line_count "$TEST_TMP/failed-migration-existing-schema/migrate.env")" \
  'failed migration with existing schema must not be retried'
expect_equal 0 "$(line_count "$TEST_TMP/failed-migration-existing-schema/assert.count")" \
  'failed migration with existing schema must not be accepted by an assertion'

status="$(run_stubbed failed-migration-missing-schema false \
  TEST_DATABASE_URL="$test_url" DATABASE_URL="$test_url" MIGRATE_STATUS=42 ASSERT_FAILURES=9)"
expect_equal 42 "$status" 'failed migration with missing schema must fail immediately'
expect_equal 1 "$(line_count "$TEST_TMP/failed-migration-missing-schema/migrate.env")" \
  'failed migration with missing schema must not be retried'
expect_equal 0 "$(line_count "$TEST_TMP/failed-migration-missing-schema/assert.count")" \
  'failed migration with missing schema must not reach an assertion'

status="$(run_stubbed retry-eventual-success false \
  TEST_DATABASE_URL="$test_url" DATABASE_URL="$test_url" ASSERT_FAILURES=1)"
expect_equal 0 "$status" 'successful migration should retry until schema assertion succeeds'
expect_equal 2 "$(line_count "$TEST_TMP/retry-eventual-success/migrate.env")" \
  'eventual success should use two migration attempts'
expect_equal 2 "$(cat "$TEST_TMP/retry-eventual-success/assert.count")" \
  'eventual success should use two assertions'

status="$(run_stubbed retry-exhausted false \
  TEST_DATABASE_URL="$test_url" DATABASE_URL="$test_url" ASSERT_FAILURES=9 SANCTUARY_DB_MIGRATE_ATTEMPTS=3)"
expect_equal 1 "$status" 'successful migrations with missing schema should fail at the bound'
expect_equal 3 "$(line_count "$TEST_TMP/retry-exhausted/migrate.env")" \
  'schema assertion failures should retry exactly to the configured bound'

if [ "$TEST_FAILURES" -ne 0 ]; then
  echo "prepare-integration-db.test.sh: $TEST_FAILURES regression check(s) failed" >&2
  exit 1
fi

echo "prepare-integration-db.test.sh: all checks passed"
