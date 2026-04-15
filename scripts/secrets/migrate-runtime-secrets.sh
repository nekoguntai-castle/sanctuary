#!/usr/bin/env bash
# Move ignored local runtime secrets out of the repository checkout.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

RUNTIME_DIR="${SANCTUARY_RUNTIME_DIR:-${HOME}/.config/sanctuary}"
ENV_DEST="${SANCTUARY_ENV_FILE:-${RUNTIME_DIR}/sanctuary.env}"
SSL_DEST_DIR="${SANCTUARY_SSL_DIR:-${RUNTIME_DIR}/ssl}"

ROOT_ENV="${REPO_ROOT}/.env"
LEGACY_SSL_DIR="${REPO_ROOT}/docker/nginx/ssl"

move_file() {
  local source_file="$1"
  local dest_file="$2"

  if [ ! -f "$source_file" ]; then
    return 0
  fi

  mkdir -p "$(dirname "$dest_file")"

  if [ -e "$dest_file" ]; then
    if cmp -s "$source_file" "$dest_file"; then
      rm -f "$source_file"
      echo "Removed duplicate repo-local secret: ${source_file#${REPO_ROOT}/}"
      return 0
    fi

    echo "Refusing to overwrite existing runtime secret: $dest_file" >&2
    echo "Move or merge it manually, then rerun this script." >&2
    exit 1
  fi

  mv "$source_file" "$dest_file"
  case "$dest_file" in
    *.pem)
      chmod 644 "$dest_file" 2>/dev/null || true
      ;;
    *)
      chmod 600 "$dest_file" 2>/dev/null || true
      ;;
  esac
  echo "Moved ${source_file#${REPO_ROOT}/} -> $dest_file"
}

move_file "$ROOT_ENV" "$ENV_DEST"
move_file "${LEGACY_SSL_DIR}/fullchain.pem" "${SSL_DEST_DIR}/fullchain.pem"
move_file "${LEGACY_SSL_DIR}/privkey.pem" "${SSL_DEST_DIR}/privkey.pem"

cat <<EOF

Runtime secrets are now outside the repository checkout.

For start.sh:
  ./start.sh

For raw docker compose:
  set -a
  source "$ENV_DEST"
  set +a
  SANCTUARY_ENV_FILE="$ENV_DEST" SANCTUARY_SSL_DIR="$SSL_DEST_DIR" docker compose up -d

Persist these exports in your shell profile if you do not use start.sh:
  export SANCTUARY_ENV_FILE="$ENV_DEST"
  export SANCTUARY_SSL_DIR="$SSL_DEST_DIR"
EOF
