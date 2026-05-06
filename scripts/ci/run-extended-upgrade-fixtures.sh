#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/run-extended-upgrade-fixtures.sh [--list]

Runs extended install upgrade fixtures sequentially from isolated Docker-visible
workspaces. The sequential job shape avoids matrix child jobs being scheduled
into different runner contexts while still exercising every fixture.
EOF
}

fail() {
  echo "run-extended-upgrade-fixtures: $*" >&2
  exit 1
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

fixture_names=(browser-origin-ip legacy-runtime-env notification-delivery optional-profiles)
fixture_offsets=(21 24 27 30)

list_fixtures() {
  local index

  for index in "${!fixture_names[@]}"; do
    printf '%s %s\n' "${fixture_names[$index]}" "${fixture_offsets[$index]}"
  done
}

run_fixture() {
  local fixture="$1"
  local port_offset="$2"
  local status=0
  local run_id
  run_id="$(ci_run_id)"

  echo "::group::extended upgrade fixture ${fixture}"
  (
    cd "$ROOT_DIR"
    SANCTUARY_EXTENDED_UPGRADE_FIXTURE="$fixture" \
      SANCTUARY_EXTENDED_UPGRADE_PORT_OFFSET="$port_offset" \
      SANCTUARY_CI_EXTENDED_UPGRADE_RUN_ID="$run_id" \
      scripts/ci/run-in-isolated-workspace.sh --docker-visible "upgrade-extended-${fixture}" bash -c '
      set -euo pipefail

      source_ref="latest-stable"
      fixture="$SANCTUARY_EXTENDED_UPGRADE_FIXTURE"
      port_offset="$SANCTUARY_EXTENDED_UPGRADE_PORT_OFFSET"
      run_id="$SANCTUARY_CI_EXTENDED_UPGRADE_RUN_ID"
      original_workspace="${SANCTUARY_CI_ORIGINAL_WORKSPACE:-${SANCTUARY_CI_WORKSPACE_OVERRIDE:-$PWD}}"
      original_workspace="$(cd "$original_workspace" && pwd -P)"

      export COMPOSE_PROJECT_NAME="sanctuary-ci-upgrade-${run_id}-${source_ref}-${fixture}"
      export SANCTUARY_UPGRADE_SOURCE_REF="${SANCTUARY_UPGRADE_SOURCE_REF_OVERRIDE:-$source_ref}"
      export SANCTUARY_UPGRADE_FIXTURE="$fixture"
      export SANCTUARY_UPGRADE_ARTIFACT_DIR="$original_workspace/.tmp/upgrade-artifacts/${source_ref}-${fixture}"

      scripts/ci/wait-for-docker.sh

      port_env="$(mktemp)"
      SANCTUARY_CI_ENV_FILE="$port_env" bash scripts/ci/install-test-ports.sh "$port_offset"
      set -a
      . "$port_env"
      set +a
      rm -f "$port_env"

      cleanup() {
        docker compose down -v --remove-orphans || true
        bash scripts/ci/cleanup-docker-resources.sh --project "$COMPOSE_PROJECT_NAME" || true
      }
      trap cleanup EXIT

      if scripts/ci/with-runner-lock.sh e2e scripts/ci/time-command.sh "upgrade extended ${source_ref} ${fixture}" ./tests/install/e2e/upgrade-install.test.sh --mode core --fixture "$fixture" --verbose; then
        exit 0
      fi

      status="$?"
      docker compose ps || true
      docker compose logs --tail 50 postgres 2>&1 || true
      docker compose logs --tail 100 backend 2>&1 || true
      exit "$status"
    '
  ) || status="$?"
  echo "::endgroup::"
  return "$status"
}

run_all_fixtures() {
  local index
  local status=0

  for index in "${!fixture_names[@]}"; do
    if ! run_fixture "${fixture_names[$index]}" "${fixture_offsets[$index]}"; then
      ci_emit_error "Extended upgrade fixture failed: ${fixture_names[$index]}"
      status=1
    fi
  done

  return "$status"
}

main() {
  case "${1:-}" in
    '')
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --list)
      list_fixtures
      exit 0
      ;;
    *)
      usage
      fail "unknown option: $1"
      ;;
  esac

  run_all_fixtures
}

main "$@"
