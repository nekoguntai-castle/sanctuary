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

  # Phase B: server is now a workspace member. `cd server && npm ci` would
  # only populate server/node_modules with non-hoisted deps; transitive deps
  # (dotenv, typescript, etc.) live at root node_modules under workspace
  # hoisting. Install at root so both root and per-package node_modules are
  # populated before any per-package script runs (prisma config loader
  # requires dotenv, vitest needs tsx, etc.).
  if [ "${SERVER_NODE_MODULES_CACHE_HIT:-}" != "true" ]; then
    cd "$ROOT_DIR"
    "$ROOT_DIR/scripts/ci/retry-command.sh" "root npm ci (workspaces)" \
      "$ROOT_DIR/scripts/ci/time-command.sh" "root npm ci (workspaces)" \
      npm ci --ignore-scripts
  else
    echo "setup-server-dependencies: server node_modules cache hit; skipping npm ci"
  fi

  # Build the shared workspace package. `npm ci --ignore-scripts` skips
  # shared's `prepare` hook that would normally produce shared/dist; explicit
  # build ensures the workspace alias `@sanctuary/shared` (vitest) and the
  # tsconfig `paths` mapping (server tsc) both resolve to a populated dist.
  cd "$ROOT_DIR"
  "$ROOT_DIR/scripts/ci/time-command.sh" "shared workspace build" \
    npm --workspace shared run build

  cd "$SERVER_DIR"

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
