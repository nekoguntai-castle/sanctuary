#!/usr/bin/env bash
# Canonical operator entrypoint for the strict production Compose contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/producer-hooks.sh"
ownership_prepare_operator_compose "$PROJECT_ROOT"
ownership_refresh_checkout_build_identity

deployment_root="$SANCTUARY_RUNTIME_DIR/ownership/deployments/$SANCTUARY_DEPLOYMENT_ID"
if [ -e "$deployment_root/identity.json" ] || [ -e "$deployment_root/active-revision.json" ] \
    || [ -e "$deployment_root/pending-revision.json" ] || [ -e "$deployment_root/prepared-revision.json" ]; then
  # shellcheck source=scripts/ownership/deployment-lifecycle.sh
  . "$SCRIPT_DIR/deployment-lifecycle.sh"
  trap deployment_lock_release EXIT
  deployment_use_active
  docker compose "${COMPOSE_FILE_ARGS[@]}" "$@"
else
  # A checkout that has never created a deployment manifest remains usable for
  # initial operator setup and development. Once state exists, the branch above
  # fails closed instead of silently dropping retained snapshot overlays.
  docker compose --project-directory "$PROJECT_ROOT" --env-file "$SANCTUARY_ENV_FILE" \
    -p "$SANCTUARY_PROJECT" "$@"
fi
