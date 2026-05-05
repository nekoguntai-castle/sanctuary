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
  local destination_path="$2"

  rm -rf "$destination_path"
  if [ -e "$source_path" ]; then
    cp -R "$source_path" "$destination_path"
  fi
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

  local artifact_root="$original_workspace/.tmp/${label}-artifacts/${run_id}"
  mkdir -p "$artifact_root"

  copy_path playwright-report "$artifact_root/playwright-report"
  copy_path test-results "$artifact_root/test-results"
  copy_path playwright-timing.json "$artifact_root/playwright-timing.json"
  copy_path playwright-timing.md "$artifact_root/playwright-timing.md"
}

main "$@"
