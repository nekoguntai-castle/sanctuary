#!/usr/bin/env bash
# Regression tests for scripts/ops/sanctuary-backup.sh and the matching
# install-sanctuary-backup.sh. Tests stub `docker` on PATH so pg_dump is
# never actually invoked; they exercise argument parsing, rotation logic,
# and the systemd unit content.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_SCRIPT="$ROOT_DIR/scripts/ops/sanctuary-backup.sh"
INSTALL_SCRIPT="$ROOT_DIR/scripts/ops/install-sanctuary-backup.sh"
TEST_TMP=""

cleanup() {
  if [ -n "$TEST_TMP" ] && [ -d "$TEST_TMP" ]; then
    rm -rf "$TEST_TMP"
  fi
}

fail() {
  echo -e "${RED}FAIL:${NC} $*" >&2
  exit 1
}

assert_eq() {
  if [ "$1" != "$2" ]; then
    fail "${3:-values differ}: expected '$1', got '$2'"
  fi
}

assert_file_contains() {
  grep -Fq -- "$2" "$1" || fail "expected $1 to contain: $2"
}

assert_file_not_contains() {
  if grep -Fq -- "$2" "$1"; then
    fail "expected $1 NOT to contain: $2"
  fi
}

assert_exists() {
  [ -e "$1" ] || fail "expected to exist: $1"
}

assert_missing() {
  [ ! -e "$1" ] || fail "expected NOT to exist: $1"
}

# Stage a fake `docker` on PATH that simulates a running postgres container
# and emits canned output for `pg_dump`. Pretty much all the script's
# external surface goes through `docker`, so this is the seam.
stage_fake_docker() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'FAKE'
#!/usr/bin/env bash
case "$1" in
  ps)
    echo "sanctuary-postgres-1"
    ;;
  exec)
    # docker exec <container> pg_dump -U <user> <db>
    shift; shift  # drop "exec <container>"
    if [ "$1" = "pg_dump" ]; then
      printf 'CREATE TABLE fake (id INT);\n'
      exit 0
    fi
    echo "fake docker: unexpected exec args: $*" >&2
    exit 99
    ;;
  *)
    echo "fake docker: unhandled subcommand: $*" >&2
    exit 99
    ;;
esac
FAKE
  chmod +x "$bin_dir/docker"
}

run_backup() {
  local bin_dir="$TEST_TMP/bin"
  PATH="$bin_dir:$PATH" HOME="$TEST_TMP" "$BACKUP_SCRIPT" "$@"
}

test_writes_dump_and_creates_dirs() {
  local out="$TEST_TMP/out"
  run_backup --output-dir "$out" \
             --keep-daily 7 --keep-weekly 4 --weekly-day 7 \
             > "$TEST_TMP/run.log" 2>&1 \
    || { cat "$TEST_TMP/run.log"; fail "run failed"; }

  assert_exists "$out/daily"
  assert_exists "$out/weekly"
  local count
  count=$(find "$out/daily" -name 'sanctuary-*.sql.gz' -type f | wc -l)
  assert_eq 1 "$count" "expected one daily backup"

  # The dump should be a real gzip stream containing our fake payload.
  local first
  first=$(find "$out/daily" -name 'sanctuary-*.sql.gz' -type f | head -1)
  gzip -t "$first" 2>/dev/null || fail "dump is not a valid gzip stream"
  zcat "$first" | grep -Fq 'CREATE TABLE fake' \
    || fail "dump does not contain expected payload"
}

test_rotates_dailies_keeping_only_n() {
  local out="$TEST_TMP/out2"
  mkdir -p "$out/daily" "$out/weekly"
  # Pre-seed with 5 old daily files. Filenames are sortable.
  for ts in 20250101-000000 20250102-000000 20250103-000000 20250104-000000 20250105-000000; do
    echo "old" | gzip > "$out/daily/sanctuary-${ts}.sql.gz"
  done

  run_backup --output-dir "$out" --keep-daily 3 --keep-weekly 4 --weekly-day 0 2>/dev/null \
    || true  # weekly-day 0 is invalid; we expect the run to still complete dump+rotate before
  # Re-run with valid weekly-day so we know rotation actually executed.
  run_backup --output-dir "$out" --keep-daily 3 --keep-weekly 4 --weekly-day 7 \
    > /dev/null 2>&1

  local count
  count=$(find "$out/daily" -name 'sanctuary-*.sql.gz' -type f | wc -l)
  assert_eq 3 "$count" "expected 3 dailies after rotation"
  # Oldest two pre-seeded files must be gone.
  assert_missing "$out/daily/sanctuary-20250101-000000.sql.gz"
  assert_missing "$out/daily/sanctuary-20250102-000000.sql.gz"
  # Newest pre-seeded files should still be there.
  assert_exists "$out/daily/sanctuary-20250104-000000.sql.gz"
  assert_exists "$out/daily/sanctuary-20250105-000000.sql.gz"
}

test_rejects_invalid_weekly_day() {
  local out="$TEST_TMP/out3"
  if run_backup --output-dir "$out" --weekly-day 8 > "$TEST_TMP/badrun.log" 2>&1; then
    fail "expected rejection for weekly-day=8"
  fi
  grep -Fq 'weekly-day' "$TEST_TMP/badrun.log" \
    || fail "error message should mention weekly-day"
}

test_dry_run_does_not_write() {
  local out="$TEST_TMP/dry"
  run_backup --output-dir "$out" --dry-run --weekly-day 7 \
    > "$TEST_TMP/dry.log" 2>&1
  # Dry-run is informational; no backup files should be written.
  if find "$out" -type f 2>/dev/null | grep -q .; then
    fail "dry-run wrote files under $out"
  fi
}

test_install_writes_systemd_units() {
  local out="$TEST_TMP/install"
  local units="$out/units"
  HOME="$TEST_TMP" "$INSTALL_SCRIPT" \
    --service-name sanctuary-backup-test \
    --output-dir "$TEST_TMP/install-backups" \
    --keep-daily 5 \
    --keep-weekly 2 \
    --on-calendar 'Mon..Sun *-*-* 02:30:00' \
    --systemd-user-dir "$units" \
    --skip-systemctl > /dev/null

  assert_exists "$units/sanctuary-backup-test.service"
  assert_exists "$units/sanctuary-backup-test.timer"
  assert_file_contains "$units/sanctuary-backup-test.service" "ExecStart=$BACKUP_SCRIPT"
  assert_file_contains "$units/sanctuary-backup-test.service" "--keep-daily 5"
  assert_file_contains "$units/sanctuary-backup-test.service" "--output-dir $TEST_TMP/install-backups"
  assert_file_contains "$units/sanctuary-backup-test.timer" 'OnCalendar=Mon..Sun *-*-* 02:30:00'
  assert_file_contains "$units/sanctuary-backup-test.timer" "Unit=sanctuary-backup-test.service"
  # The timer must explicitly target the right service unit; bare default
  # would resolve to <name>.service via a happy accident only.
  assert_file_not_contains "$units/sanctuary-backup-test.service" "Type=simple"
}

test_install_rejects_invalid_calendar_arg() {
  local out="$TEST_TMP/install-bad"
  if HOME="$TEST_TMP" "$INSTALL_SCRIPT" \
       --service-name sanctuary-backup-test \
       --on-calendar '' \
       --systemd-user-dir "$out" \
       --skip-systemctl > "$TEST_TMP/badinstall.log" 2>&1; then
    fail "expected rejection for empty --on-calendar"
  fi
}

main() {
  TEST_TMP="$(mktemp -d)"
  trap cleanup EXIT
  bash -n "$BACKUP_SCRIPT"
  bash -n "$INSTALL_SCRIPT"
  stage_fake_docker "$TEST_TMP/bin"

  test_writes_dump_and_creates_dirs
  test_rotates_dailies_keeping_only_n
  test_rejects_invalid_weekly_day
  test_dry_run_does_not_write
  test_install_writes_systemd_units
  test_install_rejects_invalid_calendar_arg

  echo -e "${GREEN}sanctuary-backup regression checks passed${NC}"
}

main "$@"
