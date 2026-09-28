#!/usr/bin/env bash
# Run one transient Compose test service. CI owns the complete resource
# lifecycle through the signed coordinator, including local invocations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
service="${1:-}"
shift || true
case "$service" in
  test-all|backend-test|frontend-test|backend-coverage|frontend-coverage) ;;
  *) printf 'run-docker-test-subject: unsupported service: %s\n' "${service:-<empty>}" >&2; exit 2 ;;
esac

if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
  exec "$SCRIPT_DIR/cleanup-ci-callsite.sh" auto-run \
    --lane "docker-test-${service}" --checkout-root "$PROJECT_ROOT" \
    -- "$0" "$service" "$@"
fi

registration=(--allow-no-owned-images)
case "$service" in
  backend-test|backend-coverage|test-all)
    # shellcheck source=scripts/ci/backend-docker-inputs.sh
    source "$SCRIPT_DIR/backend-docker-inputs.sh"
    resolve_backend_git_inputs "$PROJECT_ROOT"
    prepare_backend_output "$SCRIPT_DIR"
    registration=(--expected-image sanctuary-backend-test)
    retain_output() {
      local status=$? retention_status=0
      trap - EXIT
      retain_backend_output || retention_status=$?
      [[ "$status" -ne 0 ]] && exit "$status"
      exit "$retention_status"
    }
    trap retain_output EXIT
    ;;
esac

"$SCRIPT_DIR/run-ci-compose-subject.sh" \
  "${registration[@]}" -- \
  "$PROJECT_ROOT/scripts/ownership/run-compose.sh" --project-directory "$PROJECT_ROOT" \
  -f "$PROJECT_ROOT/docker/compose/test.yml" run --rm "$service" "$@"
