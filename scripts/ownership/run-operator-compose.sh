#!/usr/bin/env bash
# Canonical operator entrypoint for the strict production Compose contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/producer-hooks.sh"
ownership_prepare_operator_compose "$PROJECT_ROOT"
ownership_refresh_checkout_build_identity

confirm_data_delete=false
requires_active=false
deletes_volumes=false
short_volume_flag=false
volume_delete_command=false
compose_arguments=()
for argument in "$@"; do
  case "$argument" in
    --confirm-data-delete) confirm_data_delete=true ;;
    down|rm) requires_active=true; volume_delete_command=true; compose_arguments+=("$argument") ;;
    stop|kill) requires_active=true; compose_arguments+=("$argument") ;;
    -v|-[^-]*v*) short_volume_flag=true; compose_arguments+=("$argument") ;;
    -V|-[^-]*V*|--renew-anon-volumes|--renew-anon-volumes=*)
      requires_active=true
      deletes_volumes=true
      compose_arguments+=("$argument")
      ;;
    --volumes|--volumes=*)
      deletes_volumes=true
      compose_arguments+=("$argument")
      ;;
    --rmi|--rmi=*)
      echo 'Operator Compose refuses image deletion; mutable names and tags are not cleanup authority.' >&2
      exit 2
      ;;
    *) compose_arguments+=("$argument") ;;
  esac
done
[ "$volume_delete_command" != true ] || [ "$short_volume_flag" != true ] || deletes_volumes=true

if [ "$deletes_volumes" = true ] && [ "$confirm_data_delete" != true ]; then
  echo 'Volume deletion requires the separate --confirm-data-delete operator flag.' >&2
  exit 2
fi
if [ "$confirm_data_delete" = true ] && [ "$deletes_volumes" != true ]; then
  echo '--confirm-data-delete is valid only with --volumes, -v, -V, or --renew-anon-volumes.' >&2
  exit 2
fi

deployment_root="$SANCTUARY_RUNTIME_DIR/ownership/deployments/$SANCTUARY_DEPLOYMENT_ID"
if [ -e "$deployment_root/identity.json" ] || [ -e "$deployment_root/active-revision.json" ] \
    || [ -e "$deployment_root/pending-revision.json" ] || [ -e "$deployment_root/prepared-revision.json" ]; then
  # shellcheck source=scripts/ownership/deployment-lifecycle.sh
  . "$SCRIPT_DIR/deployment-lifecycle.sh"
  trap deployment_lock_release EXIT
  deployment_use_active
  docker compose "${COMPOSE_FILE_ARGS[@]}" "${compose_arguments[@]}"
else
  if [ "$requires_active" = true ]; then
    echo 'Destructive operator Compose commands require an exact active deployment manifest.' >&2
    exit 2
  fi
  # A checkout that has never created a deployment manifest remains usable for
  # non-destructive initial operator setup and development. Once state exists,
  # the branch above fails closed instead of dropping retained snapshot overlays.
  docker compose --project-directory "$PROJECT_ROOT" --env-file "$SANCTUARY_ENV_FILE" \
    -p "$SANCTUARY_PROJECT" "${compose_arguments[@]}"
fi
