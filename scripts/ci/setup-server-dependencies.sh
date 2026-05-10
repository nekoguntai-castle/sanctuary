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

  # Skip `npm ci` when the cache restored an exact match for the lockfile +
  # Node version. Partial restore-key hits leave SERVER_NODE_MODULES_CACHE_HIT
  # unset/false so we still run npm ci to validate integrity against the
  # current lockfile.
  if [ "${SERVER_NODE_MODULES_CACHE_HIT:-}" != "true" ]; then
    "$ROOT_DIR/scripts/ci/retry-command.sh" "server npm ci" \
      "$ROOT_DIR/scripts/ci/time-command.sh" "server npm ci" \
      npm ci --ignore-scripts
  else
    echo "setup-server-dependencies: server node_modules cache hit; skipping npm ci"
  fi

  # Always re-link shared module resolution; it's a fast idempotent symlink
  # operation that depends on the runner workspace, not on cache state.
  "$ROOT_DIR/scripts/ci/time-command.sh" "server shared schema link" \
    node scripts/ensure-shared-module-resolution.mjs

  # Skip `prisma generate` when the Prisma cache restored an exact match for
  # the schema + lockfile. A schema change invalidates the key and falls back
  # to a fresh generate.
  if [ "${SERVER_PRISMA_CACHE_HIT:-}" != "true" ]; then
    "$ROOT_DIR/scripts/ci/retry-command.sh" "server prisma generate" \
      "$ROOT_DIR/scripts/ci/time-command.sh" "server prisma generate" \
      npx prisma generate
  else
    echo "setup-server-dependencies: server Prisma client cache hit; skipping prisma generate"
  fi
}

main() {
  if [ "${SANCTUARY_SERVER_SETUP_NO_LOCK:-0}" = "1" ]; then
    run_setup
    return
  fi

  "$ROOT_DIR/scripts/ci/with-runner-lock.sh" "$LOCK_NAME" \
    env SANCTUARY_SERVER_SETUP_NO_LOCK=1 \
        SERVER_NODE_MODULES_CACHE_HIT="${SERVER_NODE_MODULES_CACHE_HIT:-}" \
        SERVER_PRISMA_CACHE_HIT="${SERVER_PRISMA_CACHE_HIT:-}" \
        "$0"
}

main "$@"
