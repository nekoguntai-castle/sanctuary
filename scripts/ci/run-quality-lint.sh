#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "$SCRIPT_DIR/provider-context.sh"
REGISTERED_STAGING="$SCRIPT_DIR/create-registered-staging.sh"
CLEANUP_COORDINATOR="$SCRIPT_DIR/cleanup-ci-callsite.sh"

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

run_attempt() {
  local source_workspace="$1"
  local attempt="$2"

  local lint_workdir
  lint_workdir="$($REGISTERED_STAGING "quality-lint-$attempt")"

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
  return "$status"
}

main() {
  if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
    exec "$CLEANUP_COORDINATOR" auto-run --lane quality-lint --engine host \
      --checkout-root "$PROJECT_ROOT" -- bash "$0" "$@"
  fi
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

  local attempt status
  for attempt in $(seq 1 "$attempts"); do
    status=0
    run_attempt "$source_workspace" "$attempt" || status="$?"
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
