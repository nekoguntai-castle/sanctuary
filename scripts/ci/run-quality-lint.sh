#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/provider-context.sh"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/run-quality-lint.sh

Runs the repository lint gate from a clean temporary clone. Each retry gets a
fresh clone and npm install so native loader crashes or corrupted dependency
reads do not poison every later attempt.
EOF
}

fail() {
  echo "run-quality-lint: $*" >&2
  exit 1
}

is_non_negative_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

resolve_source_workspace() {
  ci_workspace
}

remove_workdir() {
  local workdir="$1"
  if [ -n "$workdir" ] && [ -d "$workdir" ]; then
    rm -rf "$workdir" || echo "::warning::Could not fully remove lint temp workspace"
  fi
}

run_attempt() {
  local source_workspace="$1"
  local lint_tmp_parent="$2"
  local attempt="$3"

  local lint_workdir
  lint_workdir="$(mktemp -d "$lint_tmp_parent/sanctuary-lint.XXXXXX")"

  echo "quality lint workspace, attempt $attempt"
  local status=0
  git clone --quiet --no-hardlinks "$source_workspace" "$lint_workdir/repo" || status="$?"
  if [ "$status" -eq 0 ]; then
    (
      cd "$lint_workdir/repo"
      npm ci --strict-allow-scripts --audit=false --fund=false &&
        npm run lint
    ) || status="$?"
  fi
  remove_workdir "$lint_workdir"
  return "$status"
}

main() {
  if [ "${1:-}" = "--help" ]; then
    usage
    return 0
  fi
  if [ "$#" -ne 0 ]; then
    usage
    fail 'unexpected arguments'
  fi

  local attempts="${SANCTUARY_LINT_ATTEMPTS:-5}"
  local delay_seconds="${SANCTUARY_LINT_DELAY_SECONDS:-10}"

  is_positive_integer "$attempts" || fail 'SANCTUARY_LINT_ATTEMPTS must be a positive integer'
  is_non_negative_integer "$delay_seconds" || fail 'SANCTUARY_LINT_DELAY_SECONDS must be a non-negative integer'

  local source_workspace
  source_workspace="$(resolve_source_workspace)"
  [ -d "$source_workspace/.git" ] || fail "source workspace is not a git repository: $source_workspace"

  local lint_tmp_parent
  lint_tmp_parent="$(ci_temp_dir)"
  mkdir -p "$lint_tmp_parent"
  [ -w "$lint_tmp_parent" ] || fail "lint temp parent is not writable: $lint_tmp_parent"

  local attempt status
  for attempt in $(seq 1 "$attempts"); do
    status=0
    run_attempt "$source_workspace" "$lint_tmp_parent" "$attempt" || status="$?"
    if [ "$status" -eq 0 ]; then
      return 0
    fi
    if [ "$attempt" -eq "$attempts" ]; then
      return "$status"
    fi
    sleep $((attempt * delay_seconds))
  done
}

main "$@"
