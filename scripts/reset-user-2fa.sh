#!/usr/bin/env bash
#
# Reset a Sanctuary user's 2FA state from the host.
#
# This is an account-recovery tool for cases where the UI is unavailable
# because an existing encrypted TOTP secret can no longer be decrypted.
# It backs up the current 2FA fields before clearing them.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

USERNAME="admin"
BACKUP_DIR="${SANCTUARY_2FA_RESET_BACKUP_DIR:-$HOME/.config/sanctuary/recovery}"
ASSUME_YES=false

usage() {
  cat <<'EOF'
Usage:
  ./scripts/reset-user-2fa.sh [--username USER] [--backup-dir DIR] --yes

Options:
  --username USER   User to reset (default: admin)
  --backup-dir DIR  Directory for the JSON backup
                   (default: ~/.config/sanctuary/recovery)
  --yes             Actually clear 2FA fields. Without this, only status is shown.
  --help            Show this help text.

The script writes a 0600 JSON backup containing the current 2FA fields before
it clears twoFactorEnabled, twoFactorSecret, and twoFactorBackupCodes.
EOF
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --username|--user)
        [ -n "${2:-}" ] || fail "$1 requires a value"
        USERNAME="$2"
        shift 2
        ;;
      --backup-dir)
        [ -n "${2:-}" ] || fail "$1 requires a value"
        BACKUP_DIR="$2"
        shift 2
        ;;
      --yes|-y)
        ASSUME_YES=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
  done
}

validate_input() {
  [ -n "$USERNAME" ] || fail "username cannot be empty"
  case "$USERNAME" in
    *$'\n'*|*$'\r'*)
      fail "username cannot contain newlines"
      ;;
  esac

  command -v docker >/dev/null 2>&1 || fail "docker is not installed"
}

compose() {
  docker compose -f "$PROJECT_DIR/docker-compose.yml" "$@"
}

run_psql() {
  local psql_flags="$1"

  compose exec -T postgres sh -lc \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -v ON_ERROR_STOP=1 -v username="$1" '"$psql_flags"' -U "${POSTGRES_USER:-sanctuary}" -d "${POSTGRES_DB:-sanctuary}"' \
    reset-user-2fa "$USERNAME"
}

sql_user_count() {
  printf '%s\n' \
    "SELECT COUNT(*) FROM users WHERE username = :'username';"
}

sql_status() {
  printf '%s\n' \
    'SELECT concat_ws('"'|'"',' \
    '       username,' \
    '       "twoFactorEnabled"::text,' \
    '       ("twoFactorSecret" IS NOT NULL)::text,' \
    '       ("twoFactorBackupCodes" IS NOT NULL)::text)' \
    'FROM users' \
    "WHERE username = :'username';"
}

sql_backup() {
  printf '%s\n' \
    'SELECT row_to_json(u)' \
    'FROM (' \
    '  SELECT id, username, "twoFactorEnabled",' \
    '         "twoFactorSecret", "twoFactorBackupCodes", "updatedAt"' \
    '  FROM users' \
    "  WHERE username = :'username'" \
    ') u;'
}

sql_reset() {
  printf '%s\n' \
    'UPDATE users' \
    'SET "twoFactorEnabled" = false,' \
    '    "twoFactorSecret" = NULL,' \
    '    "twoFactorBackupCodes" = NULL,' \
    '    "updatedAt" = NOW()' \
    "WHERE username = :'username'" \
    'RETURNING concat_ws('"'|'"',' \
    '          username,' \
    '          "twoFactorEnabled"::text,' \
    '          ("twoFactorSecret" IS NULL)::text,' \
    '          ("twoFactorBackupCodes" IS NULL)::text);'
}

get_user_count() {
  sql_user_count | run_psql "-tA" | tr -d '[:space:]'
}

print_status() {
  local status
  status="$(sql_status | run_psql "-tA" | tail -n 1)"
  if [ -z "$status" ]; then
    fail "user not found: $USERNAME"
  fi

  IFS='|' read -r found_user enabled has_secret has_backup_codes <<EOF
$status
EOF

  echo "User: $found_user"
  echo "2FA enabled: $enabled"
  echo "Stored TOTP secret present: $has_secret"
  echo "Stored backup codes present: $has_backup_codes"
}

write_backup() {
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR" 2>/dev/null || true

  local timestamp backup_file
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_file="$BACKUP_DIR/${USERNAME}-2fa-before-reset-${timestamp}.json"

  umask 077
  sql_backup | run_psql "-tA" > "$backup_file"
  chmod 600 "$backup_file" 2>/dev/null || true

  if [ ! -s "$backup_file" ]; then
    fail "backup file is empty: $backup_file"
  fi

  echo "$backup_file"
}

reset_two_factor() {
  local result
  result="$(sql_reset | run_psql "-tA" | tail -n 1)"

  if [ -z "$result" ]; then
    fail "2FA reset did not update a user row"
  fi

  echo "Reset result: $result"
}

main() {
  parse_args "$@"
  validate_input

  [ "$(get_user_count)" = "1" ] || fail "user not found: $USERNAME"

  print_status

  if [ "$ASSUME_YES" != "true" ]; then
    echo ""
    echo "No changes made. Re-run with --yes to back up and clear this user's 2FA state."
    exit 0
  fi

  echo ""
  backup_file="$(write_backup)"
  echo "Backup written to: $backup_file"

  reset_two_factor
  echo "2FA reset complete. The user can now log in with password and re-enable 2FA."
}

main "$@"
