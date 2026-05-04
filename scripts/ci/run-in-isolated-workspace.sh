#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/run-in-isolated-workspace.sh [--docker-visible] [--keep-on-failure] LABEL COMMAND [ARG...]

Runs COMMAND from a per-job clone of the current repository. The source
checkout is treated as immutable input; generated files stay in the clone.
EOF
}

fail() {
  echo "run-in-isolated-workspace: $*" >&2
  exit 1
}

main() {
  local docker_visible=false
  local keep_on_failure=false

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --docker-visible)
        docker_visible=true
        shift
        ;;
      --keep-on-failure)
        keep_on_failure=true
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

  local create_args=()
  if [ "$docker_visible" = true ]; then
    create_args+=(--docker-visible)
  fi

  local original_workspace="${GITHUB_WORKSPACE:-}"
  if [ -z "$original_workspace" ]; then
    original_workspace="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
  fi
  original_workspace="$(cd "$original_workspace" && pwd -P)"

  local isolated_workspace
  isolated_workspace="$("$script_dir/create-isolated-workspace.sh" "${create_args[@]}" "$label")"
  local isolated_root
  isolated_root="$(dirname "$isolated_workspace")"

  local status=0
  (
    export SANCTUARY_CI_ORIGINAL_WORKSPACE="$original_workspace"
    export SANCTUARY_CI_ISOLATED_WORKSPACE="$isolated_workspace"
    export GITHUB_WORKSPACE="$isolated_workspace"
    cd "$isolated_workspace"
    "$@"
  ) || status="$?"

  if [ "$status" -eq 0 ] || [ "$keep_on_failure" = false ]; then
    rm -rf "$isolated_root" || echo "::warning::Could not fully remove isolated workspace"
  else
    echo "::warning::Preserving failed isolated workspace for runner-side inspection"
  fi

  return "$status"
}

main "$@"
