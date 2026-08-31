#!/usr/bin/env bash
# Compose entrypoint for local test/developer commands that create owned resources.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/producer-hooks.sh"
SANCTUARY_PROJECT_DIR="$PROJECT_ROOT"
if [ -z "${COMPOSE_PROJECT_NAME:-}" ]; then
  if [ -n "${SANCTUARY_PROJECT:-}" ]; then
    COMPOSE_PROJECT_NAME="$SANCTUARY_PROJECT"
  else
    checkout_hash="$(printf '%s' "$PROJECT_ROOT" | ownership_sha256 | cut -c1-8)"
    COMPOSE_PROJECT_NAME="$(ownership_sanitize_id "sanctuary-test-${PROJECT_ROOT##*/}-$checkout_hash")"
  fi
fi
SANCTUARY_PROJECT="${SANCTUARY_PROJECT:-$COMPOSE_PROJECT_NAME}"
export COMPOSE_PROJECT_NAME SANCTUARY_PROJECT_DIR SANCTUARY_PROJECT
ownership_initialize
ownership_require_identity
exec docker compose "$@"
