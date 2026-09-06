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
# shellcheck source=tests/install/utils/upgrade-source-refs.sh
source "$WORKSPACE/tests/install/utils/upgrade-source-refs.sh"
TARGET_COMMIT="$(git -C "$WORKSPACE" rev-parse HEAD 2>/dev/null || echo "")"

# Issue #1028: an ownership-aware source release (v0.8.70 and later) records a
# deployment store bound to the directory it is installed in, so the upgrade
# must run in that same directory like a production `git pull`. For such a
# source this disposable isolated workspace is the deployment root: it is
# checked out at the source release before the coordinator starts, so the
# coordinator binds its authority to that commit, and the lane declares the
# candidate as the one commit the checkout may move to. The coordinator, the
# CI helpers, and the harness all run from the original checkout so the source
# checkout never rewrites scripts that are executing.
upgrade_lane_source_commit() {
  local source_ref=$1 resolved
  resolved="$(resolve_upgrade_source_ref "$WORKSPACE" "$source_ref" "$TARGET_COMMIT" 2>/dev/null)" || return 0
  git -C "$WORKSPACE" rev-parse "${resolved}^{commit}" 2>/dev/null || true
}

# The isolated workspace is disposable: tracked edits the harness made to the
# previous lane's source checkout are discarded before moving HEAD.
checkout_workspace_commit() {
  local commit=$1
  [[ "$(git -C "$WORKSPACE" rev-parse HEAD 2>/dev/null)" == "$commit" ]] && return 0
  git -C "$WORKSPACE" checkout -q -- . 2>/dev/null || true
  git -C "$WORKSPACE" checkout -q --detach "$commit"
}
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
  local -a callsite_args=(
    --authority-mode deployment_managed_by_subject
    --lane "$cleanup_lane" --checkout-root "$WORKSPACE"
    --runtime "$cleanup_runtime" --artifact-dir "$cleanup_artifacts"
  )
  local tools_root="$WORKSPACE" source_commit
  source_commit="$(upgrade_lane_source_commit "$source_ref")"
  unset SANCTUARY_UPGRADE_DEPLOYMENT_ROOT
  checkout_workspace_commit "$TARGET_COMMIT" || return 1
  if [[ -n $source_commit ]] && upgrade_source_is_owned "$WORKSPACE" "$source_commit"; then
    # An owned source labels and registers everything it creates; there are no
    # legacy fixtures to witness, and a witness registration would carry the
    # coordinator's tuple instead of the installer's and make every volume's
    # removal proof ambiguous.
    echo "upgrade baseline ${source_ref}: owned source ${source_commit}; upgrading in place in $WORKSPACE"
    callsite_args+=(--upgrade-target-commit "$TARGET_COMMIT")
    export SANCTUARY_UPGRADE_DEPLOYMENT_ROOT="$WORKSPACE"
    tools_root="$ORIGINAL_WORKSPACE"
    checkout_workspace_commit "$source_commit" || return 1
  else
    callsite_args+=(--legacy-fixture-creation-witness)
  fi
  local CI_TOOLS="$tools_root/scripts/ci"
  status=0
  "$CI_TOOLS/cleanup-ci-callsite.sh" run "${callsite_args[@]}" -- \
      "$CI_TOOLS/run-with-log.sh" "$log_path" \
      "$CI_TOOLS/with-runner-lock.sh" e2e \
      "$CI_TOOLS/time-command.sh" "upgrade baseline ${source_ref} baseline" \
      "$tools_root/tests/install/e2e/upgrade-install.test.sh" "${upgrade_args[@]}" || status=$?
  checkout_workspace_commit "$TARGET_COMMIT" || status=$(( status == 0 ? 1 : status ))
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
