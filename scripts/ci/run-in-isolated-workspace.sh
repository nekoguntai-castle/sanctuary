#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/run-in-isolated-workspace.sh [--docker-visible] [--nested-cleanup] LABEL COMMAND [ARG...]

Runs COMMAND from a per-job clone of the current repository. The source
checkout is treated as immutable input; generated files stay in the clone.
--nested-cleanup is for tracked drivers whose inner coordinator owns the subject
deadline; outer workspace retirement waits for their signed cleanup to finish.
EOF
}

fail() {
  echo "run-in-isolated-workspace: $*" >&2
  exit 1
}

main() {
  local docker_visible=false
  local nested_cleanup=false

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --docker-visible)
        docker_visible=true
        shift
        ;;
      --nested-cleanup)
        nested_cleanup=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      --*)
        usage
        fail "unknown option: $1"
        ;;
      *)
        break
        ;;
    esac
  done

  if [ "$#" -lt 2 ]; then
    usage
    fail 'expected a workspace label and command'
  fi

  local label="$1"
  shift

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=scripts/ci/provider-context.sh
  . "$script_dir/provider-context.sh"

  local create_args=()
  if [ "$docker_visible" = true ]; then
    create_args+=(--docker-visible)
  fi

  local original_workspace
  original_workspace="$(ci_workspace)"
  original_workspace="$(cd "$original_workspace" && pwd -P)"

  if [ "${SANCTUARY_ISOLATED_CLEANUP_SUBJECT:-0}" != 1 ]; then
    local cleanup_engine lane suffix
    suffix="$(printf '%s' "$label" | sha256sum | cut -c1-10)"
    lane="isolated-$(printf '%s' "${label,,}" | tr -c 'a-z0-9-' '-' | cut -c1-12)-$suffix"
    cleanup_engine=host
    [ "$docker_visible" = false ] || cleanup_engine=docker
    local -a nested_args=()
    [ "$docker_visible" = false ] || nested_args+=(--docker-visible)
    [ "$nested_cleanup" = false ] || nested_args+=(--nested-cleanup)
    local -a lifecycle_env=() workload_env=()
    if [[ $nested_cleanup == true && ${SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS+x} ]]; then
      node "$script_dir/subject-budget.mjs" lock-wait 1 >/dev/null
      # The nested workload coordinator owns this deadline. Killing this outer
      # lifecycle subject at the same instant could interrupt its signed cleanup.
      # Preserve the exact deadline for the driver, but do not time its finalizer.
      # The enclosing CI job/step remains the independent finalization hard cap.
      lifecycle_env=(env -u SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS)
      workload_env=(env "SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS=$SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS")
    fi
    SANCTUARY_ISOLATED_CLEANUP_SUBJECT=1 exec "${lifecycle_env[@]}" "$script_dir/cleanup-ci-callsite.sh" auto-run \
      --lane "$lane" --engine "$cleanup_engine" --checkout-root "$(cd "$script_dir/../.." && pwd -P)" -- \
      "${workload_env[@]}" "$0" "${nested_args[@]}" "$label" "$@"
  fi

  local isolated_workspace
  isolated_workspace="$("$script_dir/create-isolated-workspace.sh" "${create_args[@]}" "$label")"
  local isolated_root
  isolated_root="$(dirname "$isolated_workspace")"

  local status=0
  (
    export SANCTUARY_CI_ORIGINAL_WORKSPACE="$original_workspace"
    export SANCTUARY_CI_ISOLATED_WORKSPACE="$isolated_workspace"
    export SANCTUARY_CI_WORKSPACE_OVERRIDE="$isolated_workspace"
    export GITHUB_WORKSPACE="$isolated_workspace"
    cd "$isolated_workspace"
    "$@"
  ) || status="$?"

  # The outer signed cleanup coordinator owns the registered isolated root.
  # It removes the exact entry only after this subject and its process group
  # are terminal, then journals and receipts that postcondition.
  [ -n "$isolated_root" ] || fail 'isolated workspace root was not resolved'

  return "$status"
}

main "$@"
