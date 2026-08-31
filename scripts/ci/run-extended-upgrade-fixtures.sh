#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/run-extended-upgrade-fixtures.sh [--list]
       scripts/ci/run-extended-upgrade-fixtures.sh [--fixtures LIST] [--source-ref REF] [--validate-only]

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
# shellcheck source=tests/install/utils/upgrade-selection.sh
. "$ROOT_DIR/tests/install/utils/upgrade-selection.sh"

selected_fixtures="${SANCTUARY_UPGRADE_EXTENDED_FIXTURES:-$(upgrade_active_extended_fixtures_csv)}"
source_ref="${SANCTUARY_UPGRADE_SOURCE_REF_OVERRIDE:-latest-stable}"
validate_only=false

list_fixtures() {
  upgrade_active_extended_fixture_records
}

list_selected_fixtures() {
  local fixture port_offset

  IFS=',' read -ra fixtures <<< "$selected_fixtures"
  for fixture in "${fixtures[@]}"; do
    port_offset="$(upgrade_extended_fixture_port_offset "$fixture")"
    printf '%s %s\n' "$fixture" "$port_offset"
  done
}

write_selection_manifest() {
  local original_workspace="$1"
  local artifact_root="$original_workspace/.tmp/upgrade-artifacts"

  upgrade_write_selection_manifest \
    "$ROOT_DIR" \
    "$artifact_root" \
    "${SANCTUARY_UPGRADE_BASELINE_REFS:-}" \
    "$selected_fixtures" \
    "$source_ref" \
    "$(ci_run_id)"
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
      SANCTUARY_EXTENDED_UPGRADE_SOURCE_REF="${SANCTUARY_EXTENDED_UPGRADE_SOURCE_REF:?}" \
      SANCTUARY_EXTENDED_UPGRADE_SOURCE_LABEL="${SANCTUARY_EXTENDED_UPGRADE_SOURCE_LABEL:?}" \
      scripts/ci/run-in-isolated-workspace.sh --docker-visible "upgrade-extended-${fixture}" bash -c '
      set -euo pipefail

      source_ref="$SANCTUARY_EXTENDED_UPGRADE_SOURCE_REF"
      source_label="$SANCTUARY_EXTENDED_UPGRADE_SOURCE_LABEL"
      fixture="$SANCTUARY_EXTENDED_UPGRADE_FIXTURE"
      port_offset="$SANCTUARY_EXTENDED_UPGRADE_PORT_OFFSET"
      run_id="$SANCTUARY_CI_EXTENDED_UPGRADE_RUN_ID"
      original_workspace="${SANCTUARY_CI_ORIGINAL_WORKSPACE:-${SANCTUARY_CI_WORKSPACE_OVERRIDE:-$PWD}}"
      original_workspace="$(cd "$original_workspace" && pwd -P)"
      source tests/install/utils/upgrade-selection.sh

      export COMPOSE_PROJECT_NAME="sanctuary-ci-upgrade-${run_id}-${source_label}-${fixture}"
      source scripts/ownership/producer-hooks.sh
      SANCTUARY_PROJECT="$COMPOSE_PROJECT_NAME"
      SANCTUARY_PROJECT_DIR="$PWD"
      export SANCTUARY_PROJECT SANCTUARY_PROJECT_DIR
      ownership_initialize_build_identity
      export SANCTUARY_UPGRADE_SOURCE_REF="$source_ref"
      export SANCTUARY_UPGRADE_FIXTURE="$fixture"
      export SANCTUARY_UPGRADE_ARTIFACT_DIR="$original_workspace/.tmp/upgrade-artifacts/${source_label}-${fixture}"

      scripts/ci/wait-for-docker.sh

      port_env="$(mktemp)"
      SANCTUARY_CI_ENV_FILE="$port_env" bash scripts/ci/install-test-ports.sh "$port_offset"
      set -a
      . "$port_env"
      set +a
      rm -f "$port_env"

      cleanup() {
        SANCTUARY_PRE_MANIFEST_NONPRODUCTION=true \
          bash "$original_workspace/scripts/ci/cleanup-docker-resources.sh" --project "$COMPOSE_PROJECT_NAME" --verify-empty
      }
      trap cleanup EXIT

      status=0
      if scripts/ci/with-runner-lock.sh e2e scripts/ci/time-command.sh "upgrade extended ${source_ref} ${fixture}" ./tests/install/e2e/upgrade-install.test.sh --mode core --fixture "$fixture" --verbose; then
        status=0
      else
        status="$?"
        docker compose ps || true
        docker compose logs --tail 50 postgres 2>&1 || true
        docker compose logs --tail 100 backend 2>&1 || true
      fi

      trap - EXIT
      if upgrade_finish_with_cleanup "$status" cleanup "$COMPOSE_PROJECT_NAME"; then
        exit 0
      else
        exit "$?"
      fi
    '
  ) || status="$?"
  echo "::endgroup::"
  return "$status"
}

run_all_fixtures() {
  local fixture
  local status=0
  local port_offset
  local source_label
  local fixture_source_ref
  local original_workspace

  if ! upgrade_validate_source_selector "$source_ref"; then
    fail "unsupported source ref selector: $source_ref"
  fi
  if ! upgrade_validate_extended_fixture_selection "$selected_fixtures"; then
    exit 1
  fi

  original_workspace="${SANCTUARY_CI_ORIGINAL_WORKSPACE:-$ROOT_DIR}"
  original_workspace="$(cd "$original_workspace" && pwd -P)"
  write_selection_manifest "$original_workspace"

  IFS=',' read -ra fixtures <<< "$selected_fixtures"
  for fixture in "${fixtures[@]}"; do
    port_offset="$(upgrade_extended_fixture_port_offset "$fixture")"
    fixture_source_ref="$(upgrade_extended_fixture_source_ref "$fixture" "$source_ref")"
    source_label="$(upgrade_sanitize_label "$fixture_source_ref")"
    if ! SANCTUARY_EXTENDED_UPGRADE_SOURCE_REF="$fixture_source_ref" \
         SANCTUARY_EXTENDED_UPGRADE_SOURCE_LABEL="$source_label" \
         run_fixture "$fixture" "$port_offset"; then
      ci_emit_error "Extended upgrade fixture failed: $fixture"
      status=1
    fi
  done

  return "$status"
}

main() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h)
        usage
        exit 0
        ;;
      --list)
        list_fixtures
        exit 0
        ;;
      --fixtures)
        [ "$#" -gt 1 ] || fail "--fixtures requires a value"
        selected_fixtures="$2"
        shift 2
        ;;
      --source-ref)
        [ "$#" -gt 1 ] || fail "--source-ref requires a value"
        source_ref="$2"
        shift 2
        ;;
      --validate-only)
        validate_only=true
        shift
        ;;
      *)
        usage
        fail "unknown option: $1"
        ;;
    esac
  done

  if [ "$validate_only" = "true" ]; then
    upgrade_validate_source_selector "$source_ref" || fail "unsupported source ref selector: $source_ref"
    upgrade_validate_extended_fixture_selection "$selected_fixtures"
    list_selected_fixtures
    exit 0
  fi

  run_all_fixtures
}

main "$@"
