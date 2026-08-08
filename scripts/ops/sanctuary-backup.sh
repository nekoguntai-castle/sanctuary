#!/usr/bin/env bash
# Take a host-side pg_dump of the Sanctuary postgres database and rotate
# old snapshots. Designed to be invoked by a systemd timer (see
# scripts/ops/install-sanctuary-backup.sh) so backups land outside the
# docker volume layer — i.e. the CI cleanup_containers wipe path can no
# longer take prod data with it.
#
# Backups are stored as:
#   <output-dir>/daily/sanctuary-YYYYMMDD-HHMMSS.sql.gz
#   <output-dir>/weekly/sanctuary-YYYYMMDD-HHMMSS.sql.gz   (only on weekly day)
#
# Rotation keeps --keep-daily most recent dailies and --keep-weekly
# most recent weeklies. Each new backup is verified with gzip -t before
# rotation runs, so a corrupted dump can never push a good one out.

set -euo pipefail
umask 077

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ops/sanctuary-backup.sh [options]

Options:
  --output-dir DIR         where to write backups (default: $HOME/sanctuary-backups)
  --postgres-container N   postgres container name (default: sanctuary-postgres-1)
  --db-name NAME           database name (default: sanctuary)
  --db-user USER           postgres user (default: sanctuary)
  --keep-daily N           dailies to retain (default: 7)
  --keep-weekly N          weeklies to retain (default: 4)
  --weekly-day DAY         day-of-week for weekly snapshot, 1=Mon..7=Sun (default: 7)
  --max-age-hours N        warn if the newest daily is older than N hours
                           (default: 26 — one daily interval plus slack)
  --dry-run                show what would happen without writing or deleting
  -h, --help               show this help
EOF
}

fail() {
  echo "sanctuary-backup: $*" >&2
  # Leave the failure where an operator will actually see it. sanctuary#745:
  # the unit is StandardOutput=journal with no OnFailure=, so 44 consecutive
  # failures surfaced nothing, and the output directory looked untouched.
  # Best-effort only — a status write must never mask the real error.
  write_status failed "$*" 2>/dev/null || true
  exit 1
}

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

is_positive_integer() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 0 ]
}

is_nonneg_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

output_dir="${HOME}/sanctuary-backups"
postgres_container="sanctuary-postgres-1"
db_name="sanctuary"
db_user="sanctuary"
keep_daily=7
keep_weekly=4
weekly_day=7
max_age_hours=26
dry_run=false
tmp_path=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      output_dir="${2:-}"
      shift 2
      ;;
    --postgres-container)
      postgres_container="${2:-}"
      shift 2
      ;;
    --db-name)
      db_name="${2:-}"
      shift 2
      ;;
    --db-user)
      db_user="${2:-}"
      shift 2
      ;;
    --keep-daily)
      keep_daily="${2:-}"
      shift 2
      ;;
    --keep-weekly)
      keep_weekly="${2:-}"
      shift 2
      ;;
    --weekly-day)
      weekly_day="${2:-}"
      shift 2
      ;;
    --max-age-hours)
      max_age_hours="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      usage
      fail "unknown option: $1"
      ;;
    *)
      usage
      fail "unexpected argument: $1"
      ;;
  esac
done

[ -n "$output_dir" ] || fail "--output-dir must not be empty"
[ -n "$postgres_container" ] || fail "--postgres-container must not be empty"
[ -n "$db_name" ] || fail "--db-name must not be empty"
[ -n "$db_user" ] || fail "--db-user must not be empty"
is_positive_integer "$keep_daily" || fail "--keep-daily must be a positive integer"
is_positive_integer "$keep_weekly" || fail "--keep-weekly must be a positive integer"
is_positive_integer "$max_age_hours" || fail "--max-age-hours must be a positive integer"
if ! is_positive_integer "$weekly_day" || [ "$weekly_day" -gt 7 ]; then
  fail "--weekly-day must be 1..7 (1=Mon, 7=Sun)"
fi

daily_dir="$output_dir/daily"
weekly_dir="$output_dir/weekly"
timestamp="$(date -u '+%Y%m%d-%H%M%S')"
filename="sanctuary-${timestamp}.sql.gz"
daily_path="$daily_dir/$filename"
weekly_path="$weekly_dir/$filename"
lock_path="$output_dir/.sanctuary-backup.lock"

# %u is 1..7 in GNU date (Mon..Sun). BSD/macOS users will need GNU date.
today_dow="$(date '+%u')"


# Age in whole hours of the newest daily snapshot, or empty when none exist.
# An empty backup directory is "never run", not "stale" — a first run must not
# report a gap it cannot have caused.
newest_daily_age_hours() {
  [ -d "${daily_dir:-}" ] || return 0
  local newest_epoch="" f epoch
  for f in "$daily_dir"/sanctuary-*.sql.gz; do
    [ -e "$f" ] || continue
    epoch="$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo "")"
    [ -n "$epoch" ] || continue
    if [ -z "$newest_epoch" ] || [ "$epoch" -gt "$newest_epoch" ]; then
      newest_epoch="$epoch"
    fi
  done
  [ -n "$newest_epoch" ] || return 0
  local now
  now="$(date +%s)"
  echo $(( (now - newest_epoch) / 3600 ))
}

# A single-line-per-key record beside the snapshots. Written on every exit
# path, so "the directory looks fine" stops being consistent with "backups
# have not run for six weeks".
write_status() {
  local outcome="$1"
  local detail="${2:-}"
  [ -n "${output_dir:-}" ] || return 0
  [ -d "$output_dir" ] || return 0
  [ "${dry_run:-false}" = true ] && return 0

  local status_tmp
  status_tmp="$(mktemp "$output_dir/.last-run.tmp.XXXXXX" 2>/dev/null)" || return 0
  {
    printf 'timestamp=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'outcome=%s\n' "$outcome"
    printf 'detail=%s\n' "$detail"
    printf 'stale_before_run=%s\n' "${stale_before_run:-false}"
    printf 'newest_daily_age_hours=%s\n' "${age_before_run:-unknown}"
    printf 'max_age_hours=%s\n' "${max_age_hours:-unknown}"
  } > "$status_tmp" 2>/dev/null || { rm -f -- "$status_tmp"; return 0; }
  chmod 600 "$status_tmp" 2>/dev/null || true
  mv -f "$status_tmp" "$output_dir/last-run" 2>/dev/null || rm -f -- "$status_tmp"
}

# Runs before the dump. This catches the sanctuary#745 case exactly: the script
# fired nightly, failed early, and never noticed its newest snapshot was weeks
# old. It cannot catch a masked or disabled timer — nothing inside a script
# that never runs can — which is what the status file above is for.
check_staleness() {
  age_before_run="$(newest_daily_age_hours)"
  stale_before_run=false
  [ -n "$age_before_run" ] || { age_before_run="none"; return 0; }
  if [ "$age_before_run" -gt "$max_age_hours" ]; then
    stale_before_run=true
    echo "sanctuary-backup: WARNING newest daily snapshot is stale:" \
         "${age_before_run}h old, expected under ${max_age_hours}h" >&2
    log "stale: newest daily is ${age_before_run}h old (limit ${max_age_hours}h)"
  fi
}

run() {
  if [ "$dry_run" = true ]; then
    printf 'DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

cleanup_temp() {
  if [ -n "$tmp_path" ] && [ -e "$tmp_path" ]; then
    rm -f -- "$tmp_path"
  fi
}

require_flock() {
  if ! command -v flock >/dev/null 2>&1; then
    fail "flock is required for safe backup serialization"
  fi
}

ensure_dirs() {
  if [ "$dry_run" = true ]; then
    log "would mkdir -p $daily_dir $weekly_dir"
    return
  fi
  mkdir -p "$output_dir" "$daily_dir" "$weekly_dir"
  chmod 700 "$output_dir" "$daily_dir" "$weekly_dir"
}

acquire_lock() {
  if [ "$dry_run" = true ]; then
    log "would acquire non-blocking lock $lock_path"
    return
  fi
  require_flock
  touch "$lock_path"
  chmod 600 "$lock_path"
  exec 9<>"$lock_path"
  if ! flock -n 9; then
    fail "another backup is already running (lock: $lock_path)"
  fi
}

verify_postgres_running() {
  if ! docker ps --filter "name=^${postgres_container}$" --format '{{.Names}}' \
       | grep -Fxq "$postgres_container"; then
    fail "postgres container '$postgres_container' is not running"
  fi
}

dump_database() {
  log "dumping database '$db_name' from container '$postgres_container'"
  if [ "$dry_run" = true ]; then
    log "would write $daily_path"
    return
  fi
  tmp_path="$(mktemp "$daily_dir/.${filename}.tmp.XXXXXX")"
  # pg_dump streamed through gzip; both tools' exit codes are checked via
  # PIPESTATUS so a partial dump doesn't quietly produce a small valid gz.
  docker exec "$postgres_container" pg_dump -U "$db_user" "$db_name" \
    | gzip -9 > "$tmp_path"
  local statuses=("${PIPESTATUS[@]}")
  if [ "${statuses[0]}" -ne 0 ] || [ "${statuses[1]}" -ne 0 ]; then
    fail "pg_dump failed (exit ${statuses[0]}/${statuses[1]})"
  fi
  if ! gzip -t "$tmp_path" 2>/dev/null; then
    fail "gzip integrity check failed for temporary dump"
  fi
  chmod 600 "$tmp_path"
  if ! ln "$tmp_path" "$daily_path" 2>/dev/null; then
    fail "backup already exists for timestamp: $daily_path"
  fi
  rm -f -- "$tmp_path"
  tmp_path=""
  local size_bytes
  size_bytes=$(stat -c %s "$daily_path" 2>/dev/null || stat -f %z "$daily_path")
  log "wrote $daily_path (${size_bytes} bytes)"
}

copy_to_weekly_if_due() {
  if [ "$today_dow" != "$weekly_day" ]; then
    log "today is dow=$today_dow; weekly snapshots run on dow=$weekly_day"
    return
  fi
  if [ "$dry_run" = true ]; then
    log "would copy $daily_path -> $weekly_path"
    return
  fi
  tmp_path="$(mktemp "$weekly_dir/.${filename}.weekly.tmp.XXXXXX")"
  cp -p "$daily_path" "$tmp_path"
  chmod 600 "$tmp_path"
  if ! ln "$tmp_path" "$weekly_path" 2>/dev/null; then
    fail "weekly backup already exists for timestamp: $weekly_path"
  fi
  rm -f -- "$tmp_path"
  tmp_path=""
  log "copied to $weekly_path"
}

# Rotate a directory: keep the N most recent matching files, delete the
# rest. Glob matches the timestamped filenames written above.
rotate_dir() {
  local dir="$1"
  local keep="$2"
  local label="$3"

  if [ ! -d "$dir" ]; then
    return
  fi

  local files=()
  while IFS= read -r -d '' f; do
    files+=("$f")
  done < <(find "$dir" -maxdepth 1 -type f -name 'sanctuary-*.sql.gz' -print0 | sort -z)

  local total=${#files[@]}
  if [ "$total" -le "$keep" ]; then
    log "$label: $total file(s); within limit $keep"
    return
  fi

  local to_remove=$((total - keep))
  log "$label: $total file(s); removing $to_remove oldest (keeping $keep)"
  local i
  for ((i=0; i<to_remove; i++)); do
    run rm -f -- "${files[$i]}"
  done
}

trap cleanup_temp EXIT

ensure_dirs
acquire_lock
check_staleness
verify_postgres_running
dump_database
copy_to_weekly_if_due
rotate_dir "$daily_dir" "$keep_daily" "daily"
rotate_dir "$weekly_dir" "$keep_weekly" "weekly"
write_status ok ""
log "done"
