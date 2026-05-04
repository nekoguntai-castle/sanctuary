#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="${SANCTUARY_SERVER_DIR:-$ROOT_DIR/server}"
LOCK_NAME="${SANCTUARY_SERVER_SETUP_LOCK_NAME:-node-toolchain}"

fail() {
  echo "setup-server-dependencies: $*" >&2
  exit 1
}

run_setup() {
  [ -d "$SERVER_DIR" ] || fail "server directory not found: $SERVER_DIR"
  cd "$SERVER_DIR"

  "$ROOT_DIR/scripts/ci/retry-command.sh" "server npm ci" \
    "$ROOT_DIR/scripts/ci/time-command.sh" "server npm ci" \
    npm ci --ignore-scripts
  "$ROOT_DIR/scripts/ci/time-command.sh" "server shared schema link" \
    node scripts/ensure-shared-module-resolution.mjs
  "$ROOT_DIR/scripts/ci/retry-command.sh" "server prisma generate" \
    "$ROOT_DIR/scripts/ci/time-command.sh" "server prisma generate" \
    npx prisma generate
}

main() {
  if [ "${SANCTUARY_SERVER_SETUP_NO_LOCK:-0}" = "1" ]; then
    run_setup
    return
  fi

  "$ROOT_DIR/scripts/ci/with-runner-lock.sh" "$LOCK_NAME" \
    env SANCTUARY_SERVER_SETUP_NO_LOCK=1 "$0"
}

main "$@"
