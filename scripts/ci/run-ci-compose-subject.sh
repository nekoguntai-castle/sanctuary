#!/usr/bin/env bash
# Execute one coordinated Compose producer and register every disposable image
# reference and volume fingerprint before the coordinator inventories cleanup.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = 1 ] || {
  echo 'run-ci-compose-subject requires the signed cleanup coordinator' >&2
  exit 2
}

# shellcheck source=scripts/ownership/producer-hooks.sh
source "$PROJECT_ROOT/scripts/ownership/producer-hooks.sh"
ownership_initialize_build_identity || exit $?
export_lane_image_tag || exit $?

registration_args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-no-owned-images) registration_args+=("$1"); shift ;;
    --expected-image)
      [ "$#" -ge 2 ] || { echo 'run-ci-compose-subject: missing expected image' >&2; exit 2; }
      registration_args+=("$1" "$2")
      shift 2
      ;;
    --) shift; break ;;
    *) echo "run-ci-compose-subject: unknown registration option: $1" >&2; exit 2 ;;
  esac
done
[ "$#" -gt 0 ] || { echo 'run-ci-compose-subject: COMMAND is required' >&2; exit 2; }

finalize_registration() {
  local subject_status="$?" registration_status=0
  trap - EXIT
  register_ci_compose_resources "${registration_args[@]}" || registration_status=$?
  [ "$subject_status" -ne 0 ] && exit "$subject_status"
  exit "$registration_status"
}
trap finalize_registration EXIT

"$@"
exit $?
