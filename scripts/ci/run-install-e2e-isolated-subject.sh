#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
WORKSPACE="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"
MODE="${SANCTUARY_INSTALL_SUBJECT_MODE:?install subject mode is required}"
PORT_OFFSET="${PORT_OFFSET:?port offset is required}"
JOB_LOG_DIR="${JOB_LOG_DIR:?job log directory is required}"

is_boolean() { [[ ${1:-} == true || ${1:-} == false ]]; }

assign_ports() {
  local port_root port_env status=0
  port_root=$("$SCRIPT_DIR/create-registered-staging.sh" install-port-env)
  port_env="$port_root/env"
  : > "$port_env"
  SANCTUARY_CI_ENV_FILE="$port_env" \
    "$SCRIPT_DIR/run-with-log.sh" "$JOB_LOG_DIR/install-ports.log" \
    bash "$SCRIPT_DIR/install-test-ports.sh" "$PORT_OFFSET" || status=$?
  if (( status == 0 )); then
    set -a
    # shellcheck disable=SC1090
    source "$port_env" || status=$?
    set +a
  fi
  return "$status"
}

cleanup_paths() {
  local lane=$1 group=${2:-} temp_root run_id run_attempt
  temp_root=$(ci_authority_temp_dir)
  run_id=$(ci_authority_run_id)
  run_attempt=$(ci_authority_run_attempt)
  [[ -n $temp_root && -n $run_id && -n $run_attempt ]] || return 2
  CLEANUP_RUNTIME="$temp_root/sanctuary-cleanup/${run_id}-${run_attempt}/$lane"
  if [[ -n $group ]]; then
    CLEANUP_ARTIFACTS="$temp_root/sanctuary-cleanup-artifacts/$group/$lane"
  else
    CLEANUP_ARTIFACTS="$temp_root/sanctuary-cleanup-artifacts/$lane"
  fi
}

run_supervised() {
  local lane=$1 log_name=$2 timing_label=$3 authority_mode=$4
  shift 4
  cleanup_paths "$lane" || return $?
  local -a authority_args=()
  [[ -z $authority_mode ]] || authority_args+=(--authority-mode "$authority_mode")
  "$SCRIPT_DIR/run-with-log.sh" "$JOB_LOG_DIR/$log_name.log" \
    "$SCRIPT_DIR/with-runner-lock.sh" e2e \
    "$SCRIPT_DIR/time-command.sh" "$timing_label" \
    "$SCRIPT_DIR/cleanup-ci-callsite.sh" run "${authority_args[@]}" \
      --lane "$lane" --checkout-root "$WORKSPACE" \
      --runtime "$CLEANUP_RUNTIME" --artifact-dir "$CLEANUP_ARTIFACTS" -- "$@"
}

show_logs() {
  local status=$1
  (( status == 0 )) && return 0
  {
    docker compose ps || true
    docker compose logs --tail 100 postgres 2>&1 || true
    docker compose logs --tail 100 backend 2>&1 || true
    docker compose logs --tail 100 frontend 2>&1 || true
    docker compose logs --tail 100 gateway 2>&1 || true
    docker compose logs migrate 2>&1 || true
  } > "$JOB_LOG_DIR/container-logs.log" 2>&1
  return "$status"
}

run_fresh_install() {
  local run_fresh=${SANCTUARY_RUN_FRESH_INSTALL:-false}
  local run_install=${SANCTUARY_RUN_INSTALL_SCRIPT:-false}
  is_boolean "$run_fresh" && is_boolean "$run_install" || return 2
  if [[ $run_fresh == true ]]; then
    run_supervised fresh-install fresh-install 'fresh install e2e' deployment_managed_by_subject \
      ./tests/install/e2e/fresh-install.test.sh --verbose || return $?
  fi
  if [[ $run_install == true ]]; then
    run_supervised install-script install-script 'install script e2e' deployment_managed_by_subject \
      ./tests/install/e2e/install-script.test.sh --verbose || return $?
  fi
}

run_install_stack() {
  local run_health=${RUN_HEALTH:-false} run_auth=${RUN_AUTH:-false}
  is_boolean "$run_health" && is_boolean "$run_auth" || return 2
  run_supervised install-stack install-stack 'install stack subject' '' \
    "$SCRIPT_DIR/run-compose-e2e-subject.sh" --workspace "$WORKSPACE" --mode install-stack \
      --run-health "$run_health" --run-auth "$run_auth"
}

run_compose_mode() {
  local mode=$1
  local timing_label
  case "$mode" in
    container-health) timing_label='container health subject' ;;
    auth-flow) timing_label='auth flow subject' ;;
  esac
  run_supervised "$mode" "$mode" "$timing_label" '' \
    "$SCRIPT_DIR/run-compose-e2e-subject.sh" --workspace "$WORKSPACE" --mode "$mode"
}

main() {
  case "$MODE" in
    fresh-install|install-stack|container-health|auth-flow) ;;
    *) echo "unsupported install subject mode: $MODE" >&2; return 2 ;;
  esac
  mkdir -p "$JOB_LOG_DIR"
  cd "$WORKSPACE"
  assign_ports
  local status=0
  case "$MODE" in
    fresh-install) run_fresh_install || status=$? ;;
    install-stack) run_install_stack || status=$? ;;
    container-health|auth-flow) run_compose_mode "$MODE" || status=$? ;;
  esac
  show_logs "$status"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
