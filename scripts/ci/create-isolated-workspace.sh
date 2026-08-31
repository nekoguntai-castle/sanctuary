#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"
# shellcheck source=scripts/ownership/producer-hooks.sh
. "$SCRIPT_DIR/../ownership/producer-hooks.sh"

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

  local run_id
  run_id="$(ci_run_id)"
  local uid
  uid="$(id -u)"

  local parent
  if [ -n "${SANCTUARY_CI_WORKSPACE_PARENT:-}" ]; then
    parent="$SANCTUARY_CI_WORKSPACE_PARENT"
  elif [ "$docker_visible" = true ]; then
    # Docker bind mounts must live under the runner-assigned workspace so the
    # daemon can see them. Prefer the provider workspace; fall back to the
    # source clone root if no provider workspace is exposed.
    local workspace_root
    if [ -n "${GITHUB_WORKSPACE:-}" ] || [ -n "${SANCTUARY_CI_WORKSPACE_OVERRIDE:-}" ]; then
      workspace_root="$(ci_workspace)"
    else
      workspace_root="$source_workspace"
    fi
    parent="$workspace_root/.tmp/ci-workspaces/${run_id}-${uid}"
  else
    parent="$(ci_temp_dir)/sanctuary-ci-workspaces/${run_id}-${uid}"
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

  local path_identity parent_identity
  path_identity="path-$(stat -c '%d-%i' "$workdir" 2>/dev/null || stat -f '%d-%i' "$workdir")"
  parent_identity="parent-$(printf '%s' "$(cd "$parent" && pwd -P)" | ownership_sha256)"
  SANCTUARY_PROJECT_DIR="$source_workspace" \
    register_owned_resource temporary_artifact active exact_delete path "$workdir" "$path_identity" \
      "$run_id" "$parent_identity"

  printf '%s\n' "$repo"
}

main "$@"
