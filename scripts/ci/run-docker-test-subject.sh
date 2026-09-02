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

exec "$SCRIPT_DIR/run-ci-compose-subject.sh" \
  --allow-no-owned-images -- \
  "$PROJECT_ROOT/scripts/ownership/run-compose.sh" --project-directory "$PROJECT_ROOT" \
  -f "$PROJECT_ROOT/docker/compose/test.yml" run --rm "$service" "$@"
