#!/usr/bin/env bash
# Install a user-mode systemd timer that calls scripts/ops/sanctuary-backup.sh
# on a schedule. User-mode is intentional: pg_dump only needs docker group
# membership, the backup destination is in the user's home dir, and the
# timer is naturally tied to the user account that owns the stack.
#
# Lingering must be enabled for the user (loginctl enable-linger <user>) so
# the timer fires when no one is logged in. The script will detect and warn
# if it isn't.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ops/install-sanctuary-backup.sh [options]

Options:
  --service-name NAME      systemd unit name stem (default: sanctuary-backup)
  --output-dir DIR         backup destination (default: $HOME/sanctuary-backups)
  --postgres-container N   postgres container name (default: sanctuary-postgres-1)
  --db-name NAME           database name (default: sanctuary)
  --db-user USER           postgres user (default: sanctuary)
  --keep-daily N           dailies to retain (default: 7)
  --keep-weekly N          weeklies to retain (default: 4)
  --weekly-day DAY         day-of-week for weekly snapshot (default: 7)
  --on-calendar VALUE      systemd OnCalendar expression (default: daily)
  --systemd-user-dir DIR   override unit dir (default: $XDG_CONFIG_HOME/systemd/user
                           or $HOME/.config/systemd/user)
  --skip-systemctl         write units only; don't enable or start the timer
  -h, --help               show this help
EOF
}

fail() {
  echo "install-sanctuary-backup: $*" >&2
  exit 1
}

warn() {
  echo "install-sanctuary-backup: warning: $*" >&2
}

is_positive_integer() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 0 ]
}

validate_name() {
  local value="$1"
  local label="$2"
  if [[ ! "$value" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    fail "$label may contain only letters, numbers, dots, underscores, and hyphens"
  fi
}

service_name="sanctuary-backup"
output_dir="${HOME}/sanctuary-backups"
postgres_container="sanctuary-postgres-1"
db_name="sanctuary"
db_user="sanctuary"
keep_daily=7
keep_weekly=4
weekly_day=7
on_calendar="daily"
systemd_user_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
skip_systemctl=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --service-name)        service_name="${2:-}"; shift 2 ;;
    --output-dir)          output_dir="${2:-}"; shift 2 ;;
    --postgres-container)  postgres_container="${2:-}"; shift 2 ;;
    --db-name)             db_name="${2:-}"; shift 2 ;;
    --db-user)             db_user="${2:-}"; shift 2 ;;
    --keep-daily)          keep_daily="${2:-}"; shift 2 ;;
    --keep-weekly)         keep_weekly="${2:-}"; shift 2 ;;
    --weekly-day)          weekly_day="${2:-}"; shift 2 ;;
    --on-calendar)         on_calendar="${2:-}"; shift 2 ;;
    --systemd-user-dir)    systemd_user_dir="${2:-}"; shift 2 ;;
    --skip-systemctl)      skip_systemctl=true; shift ;;
    -h|--help)             usage; exit 0 ;;
    --*)                   usage; fail "unknown option: $1" ;;
    *)                     usage; fail "unexpected argument: $1" ;;
  esac
done

validate_name "$service_name" "--service-name"
[ -n "$output_dir" ] || fail "--output-dir must not be empty"
[ -n "$postgres_container" ] || fail "--postgres-container must not be empty"
[ -n "$db_name" ] || fail "--db-name must not be empty"
[ -n "$db_user" ] || fail "--db-user must not be empty"
is_positive_integer "$keep_daily" || fail "--keep-daily must be a positive integer"
is_positive_integer "$keep_weekly" || fail "--keep-weekly must be a positive integer"
if ! is_positive_integer "$weekly_day" || [ "$weekly_day" -gt 7 ]; then
  fail "--weekly-day must be 1..7"
fi
[ -n "$on_calendar" ] || fail "--on-calendar must not be empty"
[ -n "$systemd_user_dir" ] || fail "--systemd-user-dir must not be empty"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backup_script="$repo_root/scripts/ops/sanctuary-backup.sh"
[ -x "$backup_script" ] || fail "backup script not found or not executable: $backup_script"

mkdir -p "$systemd_user_dir"

service_unit="$systemd_user_dir/${service_name}.service"
timer_unit="$systemd_user_dir/${service_name}.timer"

cat > "$service_unit" <<UNIT
[Unit]
Description=Sanctuary postgres pg_dump snapshot
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
# Keep stdout/stderr in the journal; rotation logs are useful when
# diagnosing a missing backup later.
StandardOutput=journal
StandardError=journal
ExecStart=$backup_script \\
  --output-dir $output_dir \\
  --postgres-container $postgres_container \\
  --db-name $db_name \\
  --db-user $db_user \\
  --keep-daily $keep_daily \\
  --keep-weekly $keep_weekly \\
  --weekly-day $weekly_day
UNIT

cat > "$timer_unit" <<UNIT
[Unit]
Description=Sanctuary postgres backup timer

[Timer]
OnCalendar=$on_calendar
Persistent=true
Unit=${service_name}.service

[Install]
WantedBy=timers.target
UNIT

echo "wrote $service_unit"
echo "wrote $timer_unit"

if [ "$skip_systemctl" = true ]; then
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  warn "systemctl not found; skipping enable/start"
  exit 0
fi

# Lingering required for user-mode timers to fire when no session is open.
if command -v loginctl >/dev/null 2>&1; then
  linger="$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null || echo no)"
  if [ "$linger" != "yes" ]; then
    warn "user lingering is disabled; the backup timer won't fire when you're"
    warn "logged out. Enable it with:  sudo loginctl enable-linger $(id -un)"
  fi
fi

systemctl --user daemon-reload
systemctl --user enable --now "${service_name}.timer"

echo
echo "Installed. Inspect with:"
echo "  systemctl --user list-timers ${service_name}.timer"
echo "  journalctl --user -u ${service_name}.service --since '1 day ago'"
