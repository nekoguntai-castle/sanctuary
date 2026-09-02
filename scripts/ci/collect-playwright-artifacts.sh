#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/collect-playwright-artifacts.sh LABEL [RUN_ID]

Copies Playwright reports from the current workspace into the original CI
workspace so the upload-artifact step (provider-specific) can publish them
after an isolated workspace command exits.
EOF
}

fail() {
  echo "collect-playwright-artifacts: $*" >&2
  exit 1
}

copy_path() {
  local source_path="$1"
  local workspace_root="$2"
  local destination_relative="$3"
  local destination_path="$workspace_root/$destination_relative"
  [ ! -e "$destination_path" ] || fail "artifact destination already exists: $destination_relative"
  if [ -e "$source_path" ]; then
    cp -R "$source_path" "$destination_path"
  fi
}

ensure_real_directory() {
  local directory="$1"
  if [ ! -e "$directory" ]; then
    (umask 077; mkdir -- "$directory")
  fi
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    && [ "$(cd "$directory" && pwd -P)" = "$directory" ] \
    || fail "artifact parent is not a canonical real directory: $directory"
}

main() {
  if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
    usage
    fail 'expected a label and optional run id'
  fi

  local label="$1"
  local run_id="${2:-$(ci_run_id)}"

  if [[ ! "$label" =~ ^[A-Za-z0-9._-]+$ ]]; then
    fail 'label may only contain letters, numbers, dot, underscore, and dash'
  fi
  if [[ ! "$run_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
    fail 'run id may only contain letters, numbers, dot, underscore, and dash'
  fi

  local original_workspace="${SANCTUARY_CI_ORIGINAL_WORKSPACE:-$(ci_workspace)}"
  original_workspace="$(cd "$original_workspace" && pwd -P)"

  local artifact_relative=".tmp/${label}-artifacts/${run_id}"
  local temp_root="$original_workspace/.tmp"
  local artifact_parent="$original_workspace/.tmp/${label}-artifacts"
  local artifact_root="$original_workspace/$artifact_relative"
  ensure_real_directory "$temp_root"
  ensure_real_directory "$artifact_parent"
  chmod 0700 "$artifact_parent"
  [ ! -e "$artifact_root" ] || fail "artifact destination already exists: $artifact_relative"
  (umask 077; mkdir -- "$artifact_root")

  copy_path playwright-report "$original_workspace" "$artifact_relative/playwright-report"
  copy_path test-results "$original_workspace" "$artifact_relative/test-results"
  copy_path playwright-timing.json "$original_workspace" "$artifact_relative/playwright-timing.json"
  copy_path playwright-timing.md "$original_workspace" "$artifact_relative/playwright-timing.md"
}

main "$@"
