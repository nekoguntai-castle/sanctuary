#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
WORKSPACE="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"
ORIGINAL_WORKSPACE="${SANCTUARY_CI_ORIGINAL_WORKSPACE:?original workspace is required}"
JOB_LOG_DIR="${JOB_LOG_DIR:?job log directory is required}"
UPGRADE_BASELINE_REFS="${UPGRADE_BASELINE_REFS:?upgrade baseline refs are required}"
UPGRADE_EXTENDED_FIXTURES="${UPGRADE_EXTENDED_FIXTURES:-}"
IS_RELEASE="${IS_RELEASE:?release classification is required}"
RUN_ID="$(ci_authority_run_id)"
RUN_ATTEMPT="$(ci_authority_run_attempt)"
TEMP_ROOT="$(ci_authority_temp_dir)"

# shellcheck source=tests/install/utils/upgrade-selection.sh
source "$WORKSPACE/tests/install/utils/upgrade-selection.sh"
assign_ports() {
  local offset=$1 port_root port_env status=0
  port_root=$("$SCRIPT_DIR/create-registered-staging.sh" upgrade-port-env)
  port_env="$port_root/env"
  : > "$port_env"
  SANCTUARY_CI_ENV_FILE="$port_env" \
    bash "$SCRIPT_DIR/install-test-ports.sh" "$offset" || status=$?
  if (( status == 0 )); then
    set -a
    # shellcheck disable=SC1090
    source "$port_env" || status=$?
    set +a
  fi
  return "$status"
}

run_upgrade() {
  local source_ref=$1 port_offset=$2 verify_force_rebuild=$3
  local source_label status cleanup_lane cleanup_runtime cleanup_artifacts log_path
  local -a upgrade_args=(--mode core --fixture baseline --verbose)
  source_label="$(upgrade_sanitize_label "$source_ref")"
  [[ $verify_force_rebuild != true ]] || upgrade_args+=(--verify-force-rebuild)

  export COMPOSE_PROJECT_NAME="sanctuary-ci-upgrade-${RUN_ID}-${RUN_ATTEMPT}-${source_label}-baseline"
  export SANCTUARY_UPGRADE_SOURCE_REF="$source_ref"
  export SANCTUARY_UPGRADE_FIXTURE=baseline
  export SANCTUARY_UPGRADE_ARTIFACT_DIR="$ORIGINAL_WORKSPACE/.tmp/upgrade-artifacts/${source_label}-baseline"
  assign_ports "$port_offset"

  log_path="$JOB_LOG_DIR/upgrade-baseline-${source_label}.log"
  cleanup_lane="upgrade-${port_offset}"
  cleanup_runtime="$TEMP_ROOT/sanctuary-cleanup/${RUN_ID}-${RUN_ATTEMPT}/${cleanup_lane}"
  cleanup_artifacts="$TEMP_ROOT/sanctuary-cleanup-artifacts/upgrade-baseline/${cleanup_lane}"
  status=0
  "$SCRIPT_DIR/cleanup-ci-callsite.sh" run \
      --authority-mode deployment_managed_by_subject \
      --legacy-fixture-creation-witness \
      --lane "$cleanup_lane" --checkout-root "$WORKSPACE" \
      --runtime "$cleanup_runtime" --artifact-dir "$cleanup_artifacts" -- \
      "$SCRIPT_DIR/run-with-log.sh" "$log_path" \
      "$SCRIPT_DIR/with-runner-lock.sh" e2e \
      "$SCRIPT_DIR/time-command.sh" "upgrade baseline ${source_ref} baseline" \
      "$WORKSPACE/tests/install/e2e/upgrade-install.test.sh" "${upgrade_args[@]}" || status=$?
  if (( status != 0 )); then
    docker compose ps || true
    docker compose logs --tail 50 postgres 2>&1 || true
    docker compose logs --tail 100 backend 2>&1 || true
  fi
  return "$status"
}

main() {
  [[ $RUN_ID =~ ^[0-9]+$ && $RUN_ATTEMPT =~ ^[0-9]+$ && -n $TEMP_ROOT ]] || {
    echo 'unexpected workflow cleanup authority' >&2
    return 1
  }
  upgrade_validate_baseline_ref_selection "$UPGRADE_BASELINE_REFS" || {
    echo 'invalid upgrade baseline ref selection' >&2
    return 1
  }
  mkdir -p "$JOB_LOG_DIR"
  cd "$WORKSPACE"
  upgrade_write_selection_manifest "$WORKSPACE" "$ORIGINAL_WORKSPACE/.tmp/upgrade-artifacts" \
    "$UPGRADE_BASELINE_REFS" "$UPGRADE_EXTENDED_FIXTURES" \
    "${UPGRADE_EXTENDED_SOURCE_REF:-latest-stable}" "$RUN_ID"

  local -a selected_refs
  local source_ref port_offset=15 verify_force_rebuild force_rebuild_selected=false
  IFS=',' read -ra selected_refs <<< "$UPGRADE_BASELINE_REFS"
  for source_ref in "${selected_refs[@]}"; do
    verify_force_rebuild=false
    if upgrade_should_verify_force_rebuild "$IS_RELEASE" "$source_ref" "$force_rebuild_selected"; then
      verify_force_rebuild=true
      force_rebuild_selected=true
    fi
    run_upgrade "$source_ref" "$port_offset" "$verify_force_rebuild"
    port_offset=$((port_offset + 3))
  done
  if [[ $IS_RELEASE == true && $force_rebuild_selected != true ]]; then
    echo 'release baseline selection did not schedule the required latest-stable force rebuild' >&2
    return 1
  fi
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
