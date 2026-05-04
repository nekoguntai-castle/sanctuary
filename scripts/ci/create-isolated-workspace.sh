#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/create-isolated-workspace.sh [--docker-visible] LABEL

Creates a per-job clone of the current repository and prints the clone path.
Use --docker-visible when commands in the clone need host Docker bind mounts.
EOF
}

fail() {
  echo "create-isolated-workspace: $*" >&2
  exit 1
}

safe_label() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'
}

main() {
  local docker_visible=false

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --docker-visible)
        docker_visible=true
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

  if [ "$#" -ne 1 ]; then
    usage
    fail 'expected exactly one workspace label'
  fi

  local label="$1"
  if [[ ! "$label" =~ ^[A-Za-z0-9._-]+$ ]]; then
    fail 'label may contain only letters, numbers, dots, underscores, and hyphens'
  fi

  local source_workspace="${SANCTUARY_CI_SOURCE_WORKSPACE:-}"
  if [ -z "$source_workspace" ]; then
    source_workspace="$(git rev-parse --show-toplevel 2>/dev/null)" || \
      fail 'could not determine source workspace'
  fi
  source_workspace="$(cd "$source_workspace" && pwd -P)"

  local source_head
  source_head="$(git -C "$source_workspace" rev-parse --verify HEAD)" || \
    fail 'could not resolve source HEAD'

  local run_id="${GITHUB_RUN_ID:-local}"
  local uid
  uid="$(id -u)"

  local parent
  if [ -n "${SANCTUARY_CI_WORKSPACE_PARENT:-}" ]; then
    parent="$SANCTUARY_CI_WORKSPACE_PARENT"
  elif [ "$docker_visible" = true ]; then
    local workspace_root="${GITHUB_WORKSPACE:-$source_workspace}"
    parent="$workspace_root/.tmp/ci-workspaces/${run_id}-${uid}"
  else
    parent="${RUNNER_TEMP:-/tmp}/sanctuary-ci-workspaces/${run_id}-${uid}"
  fi

  mkdir -p "$parent"
  chmod 1777 "$parent" 2>/dev/null || true

  if [ ! -w "$parent" ]; then
    fail 'isolated workspace parent is not writable'
  fi

  local workdir
  workdir="$(mktemp -d "$parent/$(safe_label "$label").XXXXXX")"
  local repo="$workdir/repo"

  git clone --quiet --no-hardlinks "$source_workspace" "$repo"
  git -C "$repo" checkout --quiet "$source_head"

  printf '%s\n' "$repo"
}

main "$@"
