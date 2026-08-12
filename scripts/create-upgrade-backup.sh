#!/usr/bin/env bash
#
# Create a local pre-upgrade backup artifact from the host.
#
# This is intended for install.sh upgrade paths, including offline bundle
# upgrades where the web UI may not be available. It writes one owner-only
# tar.gz archive containing a PostgreSQL custom-format dump, runtime secrets,
# TLS material when present, restore metadata, and internal checksums.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

INSTALL_DIR="$PROJECT_DIR"
TARGET_VERSION="${SANCTUARY_UPGRADE_TARGET_VERSION:-unknown-target}"
OUTPUT_DIR=""
ENV_FILE_OVERRIDE="${SANCTUARY_ENV_FILE:-}"
SSL_DIR_OVERRIDE="${SANCTUARY_SSL_DIR:-}"
WRITE_SIDECAR_CHECKSUM=false
START_POSTGRES=true
BACKUP_TMP_ROOT=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/create-upgrade-backup.sh [options]

Options:
  --install-dir DIR          Sanctuary install directory (default: script parent)
  --target-version VERSION   Version/ref the upgrade will apply
  --output-dir DIR           Directory for the single tar.gz backup archive
                             (default: ~/.config/sanctuary/backups/offline-upgrades/<timestamp>-<version>)
  --env-file FILE            Runtime env file to copy
  --ssl-dir DIR              TLS material directory to copy when present
  --no-start-postgres        Do not start postgres if it is stopped
  --write-sidecar-checksum   Also write <archive>.sha256 next to the archive
  --help                     Show this help text

The archive is sensitive. It includes runtime secrets needed to restore
encrypted Sanctuary data. Store it like a wallet backup.
EOF
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

log() {
  echo "$*"
}

cleanup_backup_tmp() {
  if [ -n "${BACKUP_TMP_ROOT:-}" ] && [ -d "$BACKUP_TMP_ROOT" ]; then
    rm -rf "$BACKUP_TMP_ROOT"
  fi
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --install-dir)
        [ -n "${2:-}" ] || fail "$1 requires a value"
        INSTALL_DIR="$2"
        shift 2
        ;;
      --target-version)
        [ -n "${2:-}" ] || fail "$1 requires a value"
        TARGET_VERSION="$2"
        shift 2
        ;;
      --output-dir)
        [ -n "${2:-}" ] || fail "$1 requires a value"
        OUTPUT_DIR="$2"
        shift 2
        ;;
      --env-file)
        [ -n "${2:-}" ] || fail "$1 requires a value"
        ENV_FILE_OVERRIDE="$2"
        shift 2
        ;;
      --ssl-dir)
        [ -n "${2:-}" ] || fail "$1 requires a value"
        SSL_DIR_OVERRIDE="$2"
        shift 2
        ;;
      --no-start-postgres)
        START_POSTGRES=false
        shift
        ;;
      --write-sidecar-checksum)
        WRITE_SIDECAR_CHECKSUM=true
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

resolve_runtime_dir() {
  echo "${SANCTUARY_RUNTIME_DIR:-$HOME/.config/sanctuary}"
}

resolve_env_file() {
  if [ -n "$ENV_FILE_OVERRIDE" ]; then
    echo "$ENV_FILE_OVERRIDE"
    return
  fi

  local runtime_dir default_env legacy_env
  runtime_dir="$(resolve_runtime_dir)"
  default_env="$runtime_dir/sanctuary.env"
  legacy_env="$INSTALL_DIR/.env"

  if [ -f "$default_env" ]; then
    echo "$default_env"
  elif [ -f "$legacy_env" ]; then
    echo "$legacy_env"
  else
    echo "$default_env"
  fi
}

resolve_ssl_dir() {
  if [ -n "$SSL_DIR_OVERRIDE" ]; then
    echo "$SSL_DIR_OVERRIDE"
    return
  fi

  local runtime_dir external_ssl legacy_ssl
  runtime_dir="$(resolve_runtime_dir)"
  external_ssl="$runtime_dir/ssl"
  legacy_ssl="$INSTALL_DIR/docker/nginx/ssl"

  if [ -f "$external_ssl/fullchain.pem" ] || [ -f "$external_ssl/privkey.pem" ]; then
    echo "$external_ssl"
  else
    echo "$legacy_ssl"
  fi
}

sanitize_component() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

current_version() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    git -C "$INSTALL_DIR" describe --tags --always 2>/dev/null \
      || git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null \
      || echo "unknown"
  else
    echo "unknown"
  fi
}

compose() {
  docker compose -f "$INSTALL_DIR/docker-compose.yml" "$@"
}

load_runtime_env() {
  local env_file="$1"

  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

validate_prerequisites() {
  [ -d "$INSTALL_DIR" ] || fail "install directory not found: $INSTALL_DIR"
  [ -f "$INSTALL_DIR/docker-compose.yml" ] || fail "docker-compose.yml not found in $INSTALL_DIR"
  command -v docker >/dev/null 2>&1 || fail "docker is not installed"
  command -v tar >/dev/null 2>&1 || fail "tar is not installed"
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is not installed"
}

ensure_postgres_ready() {
  if compose ps -q postgres >/dev/null 2>&1 && [ -n "$(compose ps -q postgres 2>/dev/null)" ]; then
    if compose exec -T postgres sh -lc 'pg_isready -U "${POSTGRES_USER:-sanctuary}" -d "${POSTGRES_DB:-sanctuary}" >/dev/null 2>&1'; then
      return 0
    fi
  fi

  if [ "$START_POSTGRES" != "true" ]; then
    fail "postgres is not ready; start Sanctuary or omit --no-start-postgres"
  fi

  local postgres_image='postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'
  docker image inspect "$postgres_image" >/dev/null 2>&1 \
    || fail "$postgres_image is not available locally; cannot start postgres for backup without pulling"

  log "Starting postgres for backup..."
  if docker compose up --help 2>&1 | grep -q -- '--pull'; then
    compose up -d --no-build --pull never postgres >/dev/null
  else
    compose up -d --no-build postgres >/dev/null
  fi

  local waited=0
  while [ "$waited" -lt 90 ]; do
    if compose exec -T postgres sh -lc 'pg_isready -U "${POSTGRES_USER:-sanctuary}" -d "${POSTGRES_DB:-sanctuary}" >/dev/null 2>&1'; then
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done

  fail "postgres did not become ready for backup"
}

write_database_dump() {
  local dump_file="$1"

  compose exec -T postgres sh -lc \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom -U "${POSTGRES_USER:-sanctuary}" -d "${POSTGRES_DB:-sanctuary}"' \
    > "$dump_file"

  [ -s "$dump_file" ] || fail "database dump is empty"
  chmod 600 "$dump_file" 2>/dev/null || true
}

write_runtime_files() {
  local staging_dir="$1"
  local env_file="$2"
  local ssl_dir="$3"

  mkdir -p "$staging_dir/runtime" "$staging_dir/tls"

  if [ -f "$env_file" ]; then
    cp "$env_file" "$staging_dir/runtime/sanctuary.env"
    chmod 600 "$staging_dir/runtime/sanctuary.env" 2>/dev/null || true
  fi

  if [ -d "$ssl_dir" ]; then
    find "$ssl_dir" -maxdepth 1 -type f \( -name '*.pem' -o -name '*.crt' -o -name '*.key' \) -exec cp {} "$staging_dir/tls/" \;
    find "$staging_dir/tls" -type f -exec chmod 600 {} \; 2>/dev/null || true
  fi
}

write_metadata() {
  local staging_dir="$1"
  local env_file="$2"
  local ssl_dir="$3"
  local current_ref="$4"
  local archive_name="$5"
  local compose_project
  compose_project="${COMPOSE_PROJECT_NAME:-$(basename "$INSTALL_DIR")}"
  local created_at
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  mkdir -p "$staging_dir/metadata"

  cat > "$staging_dir/manifest.env" <<EOF
SANCTUARY_UPGRADE_BACKUP_SCHEMA=1
SANCTUARY_BACKUP_CREATED_AT=$created_at
SANCTUARY_BACKUP_ARCHIVE=$archive_name
SANCTUARY_INSTALL_DIR=$INSTALL_DIR
SANCTUARY_CURRENT_VERSION=$current_ref
SANCTUARY_TARGET_VERSION=$TARGET_VERSION
SANCTUARY_ENV_FILE=$env_file
SANCTUARY_SSL_DIR=$ssl_dir
COMPOSE_PROJECT_NAME=$compose_project
ENABLE_MONITORING=${ENABLE_MONITORING:-}
ENABLE_TOR=${ENABLE_TOR:-}
EOF

  cat > "$staging_dir/manifest.json" <<EOF
{
  "schema": 1,
  "createdAt": "$(json_escape "$created_at")",
  "archive": "$(json_escape "$archive_name")",
  "installDir": "$(json_escape "$INSTALL_DIR")",
  "currentVersion": "$(json_escape "$current_ref")",
  "targetVersion": "$(json_escape "$TARGET_VERSION")",
  "envFile": "$(json_escape "$env_file")",
  "sslDir": "$(json_escape "$ssl_dir")",
  "composeProjectName": "$(json_escape "$compose_project")",
  "profiles": {
    "monitoring": "$(json_escape "${ENABLE_MONITORING:-}")",
    "tor": "$(json_escape "${ENABLE_TOR:-}")"
  }
}
EOF

  {
    echo "## docker compose ps"
    compose ps 2>&1 || true
    echo ""
    echo "## docker images"
    docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}} {{.Size}}' 2>&1 || true
    echo ""
    echo "## docker volumes"
    docker volume ls 2>&1 || true
    echo ""
    echo "## tool versions"
    docker version --format 'docker {{.Client.Version}}' 2>&1 || true
    docker compose version 2>&1 || true
    compose exec -T postgres sh -lc 'pg_dump --version' 2>&1 || true
  } > "$staging_dir/metadata/restore-context.txt"
}

write_internal_checksums() {
  local staging_dir="$1"

  (
    cd "$staging_dir"
    find . -type f ! -name checksums.sha256 | LC_ALL=C sort | while IFS= read -r file; do
      sha256sum "$file"
    done > checksums.sha256
  )
  chmod 600 "$staging_dir/checksums.sha256" 2>/dev/null || true
}

validate_archive() {
  local archive_file="$1"
  local validation_dir="$2"

  [ -s "$archive_file" ] || fail "backup archive is empty: $archive_file"

  mkdir -p "$validation_dir"
  tar -xzf "$archive_file" -C "$validation_dir"

  [ -s "$validation_dir/database/sanctuary.pgcustom" ] || fail "validated database dump is empty"
  if [ -f "$(resolve_env_file)" ] && [ ! -s "$validation_dir/runtime/sanctuary.env" ]; then
    fail "validated archive is missing runtime env copy"
  fi

  (
    cd "$validation_dir"
    sha256sum -c checksums.sha256 >/dev/null
  ) || fail "validated archive checksums failed"
}

create_backup() {
  local env_file ssl_dir current_ref safe_current timestamp backup_dir staging_dir validation_dir archive_file archive_name

  env_file="$(resolve_env_file)"
  ssl_dir="$(resolve_ssl_dir)"
  load_runtime_env "$env_file"

  current_ref="$(current_version)"
  safe_current="$(sanitize_component "$current_ref")"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

  if [ -z "$OUTPUT_DIR" ]; then
    backup_dir="$(resolve_runtime_dir)/backups/offline-upgrades/${timestamp}-${safe_current}"
  else
    backup_dir="$OUTPUT_DIR"
  fi

  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir" 2>/dev/null || true

  archive_name="sanctuary-upgrade-backup-${timestamp}-from-${safe_current}.tar.gz"
  archive_file="$backup_dir/$archive_name"

  BACKUP_TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-upgrade-backup.XXXXXX")"
  staging_dir="$BACKUP_TMP_ROOT/staging"
  validation_dir="$BACKUP_TMP_ROOT/validate"
  mkdir -p "$staging_dir/database"
  chmod 700 "$BACKUP_TMP_ROOT" "$staging_dir" 2>/dev/null || true
  trap cleanup_backup_tmp EXIT

  ensure_postgres_ready
  log "Creating database backup..."
  write_database_dump "$staging_dir/database/sanctuary.pgcustom"
  write_runtime_files "$staging_dir" "$env_file" "$ssl_dir"
  write_metadata "$staging_dir" "$env_file" "$ssl_dir" "$current_ref" "$archive_name"
  write_internal_checksums "$staging_dir"

  umask 077
  tar -czf "$archive_file" -C "$staging_dir" .
  chmod 600 "$archive_file" 2>/dev/null || true

  validate_archive "$archive_file" "$validation_dir"

  if [ "$WRITE_SIDECAR_CHECKSUM" = "true" ]; then
    (cd "$backup_dir" && sha256sum "$archive_name" > "$archive_name.sha256")
    chmod 600 "$archive_file.sha256" 2>/dev/null || true
  fi

  log "Upgrade backup written to: $archive_file"
  log ""
  log "Restore note: this archive contains runtime secrets and a PostgreSQL dump."
  log "Keep it private. Restore should be run only as an explicit recovery step."
}

main() {
  parse_args "$@"
  validate_prerequisites
  create_backup
}

main "$@"
