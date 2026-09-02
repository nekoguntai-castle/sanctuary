#!/usr/bin/env bash
# Compose entrypoint for local test/developer commands that create owned resources.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/producer-hooks.sh"

compose_subcommand() {
  local argument help=false
  [ "$#" -gt 0 ] || { printf 'help\n'; return; }
  for argument in "$@"; do
    case "$argument" in
      -h|--help|--version) help=true ;;
      config|version|ps|images|logs|top|events|port|ls) printf '%s\n' "$argument"; return ;;
      up|create|run|build|down|rm|stop|kill|start|restart|pause|unpause|pull|push|cp|exec)
        printf '%s\n' "$argument"; return ;;
    esac
  done
  [ "$help" = true ] && printf 'help\n' || printf 'unknown\n'
}

case "$(compose_subcommand "$@")" in
  config|version|ps|images|logs|top|events|port|ls|help) ;;
  *)
    [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = 1 ] || {
      echo 'mutating run-compose commands require the signed cleanup coordinator' >&2
      exit 2
    }
    ;;
esac

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
ownership_initialize || exit $?
ownership_require_identity || exit $?
exec docker compose "$@"
