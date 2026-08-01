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

stat_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

assert_mode() {
  local expected="$1"
  local path="$2"
  local actual
  actual="$(stat_mode "$path")"
  assert_eq "$expected" "$actual" "unexpected mode for $path"
}

file_digest() {
  sha256sum "$1" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$1" | awk '{print $1}'
}

systemd_exec_arg() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//%/%%}"
  printf '"%s"' "$value"
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
      if [ -n "${FAKE_DOCKER_SLEEP:-}" ]; then
        sleep "$FAKE_DOCKER_SLEEP"
      fi
      printf 'CREATE TABLE fake (id INT);\n'
      if [ "${FAKE_DOCKER_FAIL_AFTER_OUTPUT:-false}" = true ]; then
        exit 42
      fi
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

stage_fake_date() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/date" <<'FAKE'
#!/usr/bin/env bash
if [ "${FAKE_DATE_TIMESTAMP:-}" != "" ] && [ "${1:-}" = "-u" ] && [ "${2:-}" = "+%Y%m%d-%H%M%S" ]; then
  printf '%s\n' "$FAKE_DATE_TIMESTAMP"
  exit 0
fi
if [ "${FAKE_DATE_TIMESTAMP:-}" != "" ] && [ "${1:-}" = "-u" ] && [ "${2:-}" = "+%Y-%m-%dT%H:%M:%SZ" ]; then
  printf '2026-01-01T00:00:00Z\n'
  exit 0
fi
if [ "${FAKE_DATE_DOW:-}" != "" ] && [ "${1:-}" = "+%u" ]; then
  printf '%s\n' "$FAKE_DATE_DOW"
  exit 0
fi
exec /usr/bin/date "$@"
FAKE
  chmod +x "$bin_dir/date"
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

test_permissions_under_permissive_umask() {
  local out="$TEST_TMP/permissions"
  (umask 000; run_backup --output-dir "$out" --weekly-day 7 > "$TEST_TMP/permissions.log" 2>&1) \
    || { cat "$TEST_TMP/permissions.log"; fail "permission run failed"; }

  assert_mode 700 "$out"
  assert_mode 700 "$out/daily"
  assert_mode 700 "$out/weekly"
  assert_mode 600 "$out/.sanctuary-backup.lock"

  local first
  first=$(find "$out/daily" -name 'sanctuary-*.sql.gz' -type f | head -1)
  assert_mode 600 "$first"
}

test_rotates_dailies_keeping_only_n() {
  local out="$TEST_TMP/out2"
  mkdir -p "$out/daily" "$out/weekly"
  # Pre-seed with 5 old daily files. Filenames are sortable.
  for ts in 20250101-000000 20250102-000000 20250103-000000 20250104-000000 20250105-000000; do
    echo "old" | gzip > "$out/daily/sanctuary-${ts}.sql.gz"
  done
  echo "incomplete" > "$out/daily/.sanctuary-20250100-000000.sql.gz.tmp"

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
  assert_exists "$out/daily/.sanctuary-20250100-000000.sql.gz.tmp"
}

test_same_second_no_clobber_keeps_existing_snapshot() {
  local out="$TEST_TMP/same-second"
  local target="$out/daily/sanctuary-20260101-000000.sql.gz"

  FAKE_DATE_TIMESTAMP=20260101-000000 run_backup --output-dir "$out" --weekly-day 7 \
    > "$TEST_TMP/same-second-first.log" 2>&1 \
    || { cat "$TEST_TMP/same-second-first.log"; fail "first same-second run failed"; }
  local before
  before="$(file_digest "$target")"

  if FAKE_DATE_TIMESTAMP=20260101-000000 run_backup --output-dir "$out" --weekly-day 7 \
      > "$TEST_TMP/same-second-second.log" 2>&1; then
    fail "expected second same-second run to fail"
  fi
  assert_eq "$before" "$(file_digest "$target")" "same-second run changed existing snapshot"
  assert_file_contains "$TEST_TMP/same-second-second.log" "backup already exists"
}

test_failed_dump_leaves_no_published_or_temp_files() {
  local out="$TEST_TMP/failed-dump"

  if FAKE_DATE_TIMESTAMP=20260102-000000 FAKE_DOCKER_FAIL_AFTER_OUTPUT=true \
      run_backup --output-dir "$out" --weekly-day 7 > "$TEST_TMP/failed-dump.log" 2>&1; then
    fail "expected failed dump to fail"
  fi

  if find "$out/daily" -name 'sanctuary-*.sql.gz' -type f 2>/dev/null | grep -q .; then
    fail "failed dump published a backup"
  fi
  if find "$out/daily" -name '.sanctuary-*' -type f 2>/dev/null | grep -q .; then
    fail "failed dump left a hidden temporary file"
  fi
}

test_lock_contention_fails_without_touching_snapshot() {
  local out="$TEST_TMP/contention"

  FAKE_DATE_TIMESTAMP=20260103-000000 FAKE_DOCKER_SLEEP=2 \
    run_backup --output-dir "$out" --weekly-day 7 > "$TEST_TMP/contention-first.log" 2>&1 &
  local first_pid=$!

  for _ in {1..50}; do
    [ -e "$out/.sanctuary-backup.lock" ] && break
    sleep 0.1
  done

  if FAKE_DATE_TIMESTAMP=20260103-000000 run_backup --output-dir "$out" --weekly-day 7 \
      > "$TEST_TMP/contention-second.log" 2>&1; then
    kill "$first_pid" 2>/dev/null || true
    fail "expected contending backup to fail"
  fi
  assert_file_contains "$TEST_TMP/contention-second.log" "another backup is already running"
  wait "$first_pid" || { cat "$TEST_TMP/contention-first.log"; fail "first backup failed"; }

  local count
  count=$(find "$out/daily" -name 'sanctuary-*.sql.gz' -type f | wc -l)
  assert_eq 1 "$count" "expected one daily backup after contention"
}

test_requires_flock_before_dumping() {
  local out="$TEST_TMP/no-flock"
  local bin_dir="$TEST_TMP/no-flock-bin"
  local cmd
  mkdir -p "$bin_dir"
  for cmd in date mkdir chmod; do
    ln -s "$(command -v "$cmd")" "$bin_dir/$cmd"
  done

  if PATH="$bin_dir" HOME="$TEST_TMP" "$BASH" "$BACKUP_SCRIPT" \
      --output-dir "$out" > "$TEST_TMP/no-flock.log" 2>&1; then
    fail "expected missing flock to fail"
  fi

  assert_file_contains "$TEST_TMP/no-flock.log" "flock is required"
  if find "$out/daily" -name 'sanctuary-*.sql.gz' -type f 2>/dev/null | grep -q .; then
    fail "missing flock run created a backup"
  fi
}

test_weekly_copy_uses_published_basename_and_mode() {
  local out="$TEST_TMP/weekly"
  local basename="sanctuary-20260104-000000.sql.gz"

  FAKE_DATE_TIMESTAMP=20260104-000000 FAKE_DATE_DOW=3 \
    run_backup --output-dir "$out" --weekly-day 3 > "$TEST_TMP/weekly.log" 2>&1 \
    || { cat "$TEST_TMP/weekly.log"; fail "weekly run failed"; }

  assert_exists "$out/daily/$basename"
  assert_exists "$out/weekly/$basename"
  assert_mode 600 "$out/weekly/$basename"
  assert_eq "$(file_digest "$out/daily/$basename")" "$(file_digest "$out/weekly/$basename")" \
    "weekly copy should match published daily"
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
  assert_file_contains "$units/sanctuary-backup-test.service" "ExecStart=$(systemd_exec_arg "$BACKUP_SCRIPT")"
  assert_file_contains "$units/sanctuary-backup-test.service" "$(systemd_exec_arg "--keep-daily") $(systemd_exec_arg "5")"
  assert_file_contains "$units/sanctuary-backup-test.service" "$(systemd_exec_arg "--output-dir") $(systemd_exec_arg "$TEST_TMP/install-backups")"
  assert_file_contains "$units/sanctuary-backup-test.timer" 'OnCalendar=Mon..Sun *-*-* 02:30:00'
  assert_file_contains "$units/sanctuary-backup-test.timer" "Unit=sanctuary-backup-test.service"
  # The timer must explicitly target the right service unit; bare default
  # would resolve to <name>.service via a happy accident only.
  assert_file_not_contains "$units/sanctuary-backup-test.service" "Type=simple"

  if command -v systemd-analyze >/dev/null 2>&1; then
    systemd-analyze verify "$units/sanctuary-backup-test.service" "$units/sanctuary-backup-test.timer" \
      > "$TEST_TMP/systemd-analyze.log" 2>&1 \
      || { cat "$TEST_TMP/systemd-analyze.log"; fail "systemd-analyze verify failed"; }
  fi
}

test_install_quotes_special_execstart_args() {
  local out="$TEST_TMP/install-special"
  local units="$out/units"
  local output_dir="$TEST_TMP/install backups/with % percent \"quote\" and \\ slash"

  HOME="$TEST_TMP" "$INSTALL_SCRIPT" \
    --service-name sanctuary-backup-special \
    --output-dir "$output_dir" \
    --postgres-container 'sanctuary postgres % "container" \ name' \
    --db-name 'sanctuary db % name' \
    --db-user 'sanctuary user "quoted"' \
    --systemd-user-dir "$units" \
    --skip-systemctl > /dev/null

  assert_file_contains "$units/sanctuary-backup-special.service" "$(systemd_exec_arg "$output_dir")"
  assert_file_contains "$units/sanctuary-backup-special.service" "$(systemd_exec_arg 'sanctuary postgres % "container" \ name')"
  assert_file_contains "$units/sanctuary-backup-special.service" "$(systemd_exec_arg 'sanctuary user "quoted"')"
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

test_install_rejects_control_characters() {
  local out="$TEST_TMP/install-control"
  if HOME="$TEST_TMP" "$INSTALL_SCRIPT" \
       --service-name sanctuary-backup-test \
       --output-dir $'bad\npath' \
       --systemd-user-dir "$out" \
       --skip-systemctl > "$TEST_TMP/control-install.log" 2>&1; then
    fail "expected rejection for control characters"
  fi
  assert_file_contains "$TEST_TMP/control-install.log" "control characters"
}

main() {
  TEST_TMP="$(mktemp -d)"
  trap cleanup EXIT
  bash -n "$BACKUP_SCRIPT"
  bash -n "$INSTALL_SCRIPT"
  stage_fake_docker "$TEST_TMP/bin"
  stage_fake_date "$TEST_TMP/bin"

  test_writes_dump_and_creates_dirs
  test_permissions_under_permissive_umask
  test_rotates_dailies_keeping_only_n
  test_same_second_no_clobber_keeps_existing_snapshot
  test_failed_dump_leaves_no_published_or_temp_files
  test_lock_contention_fails_without_touching_snapshot
  test_requires_flock_before_dumping
  test_weekly_copy_uses_published_basename_and_mode
  test_rejects_invalid_weekly_day
  test_dry_run_does_not_write
  test_install_writes_systemd_units
  test_install_quotes_special_execstart_args
  test_install_rejects_invalid_calendar_arg
  test_install_rejects_control_characters

  echo -e "${GREEN}sanctuary-backup regression checks passed${NC}"
}

main "$@"
