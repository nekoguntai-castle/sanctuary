#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
REGISTERED_STAGING="$SCRIPT_DIR/create-registered-staging.sh"
CLEANUP_COORDINATOR="$SCRIPT_DIR/cleanup-ci-callsite.sh"

fail() {
  echo "frontend-coverage-merge: $*" >&2
  exit 1
}

main() {
  if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
    exec "$CLEANUP_COORDINATOR" auto-run --lane frontend-coverage-merge --engine host \
      --checkout-root "$PROJECT_ROOT" -- bash "$0" "$@"
  fi
  if [ "$#" -gt 1 ]; then
    fail 'expected zero or one blob report directory argument'
  fi

  local reports_dir="${1:-.vitest-reports}"

  if [ ! -d "$reports_dir" ]; then
    fail "blob report directory does not exist: ${reports_dir}"
  fi

  local blob_count=0
  local blob
  for blob in "$reports_dir"/blob-*.json; do
    if [ -f "$blob" ]; then
      blob_count=$((blob_count + 1))
    fi
  done

  if [ "$blob_count" -eq 0 ]; then
    fail "no Vitest blob reports found in ${reports_dir}"
  fi

  # Workspace-aware binary lookup: cwd first, then walk up for hoisted bins.
  local vitest_bin="${VITEST_BIN:-}"
  if [ -z "$vitest_bin" ]; then
    if [ -x "./node_modules/.bin/vitest" ]; then
      vitest_bin="./node_modules/.bin/vitest"
    elif [ -x "../node_modules/.bin/vitest" ]; then
      vitest_bin="../node_modules/.bin/vitest"
    fi
  fi
  if [ -z "$vitest_bin" ] || [ ! -x "$vitest_bin" ]; then
    fail "Vitest binary not found in ./node_modules/.bin or ../node_modules/.bin; run npm ci first"
  fi

  local merge_reports_dir
  merge_reports_dir="$($REGISTERED_STAGING frontend-coverage-merge)"

  for blob in "$reports_dir"/blob-*.json; do
    if [ -f "$blob" ]; then
      cp "$blob" "$merge_reports_dir/"
    fi
  done

  [ ! -e coverage ] || fail 'refusing stale frontend coverage output directory: coverage'
  "$vitest_bin" run \
    --config config/tooling/vitest.config.ts \
    --coverage \
    --mergeReports "$merge_reports_dir"

  if [ ! -f coverage/coverage-summary.json ]; then
    fail 'expected merged frontend coverage summary at coverage/coverage-summary.json'
  fi
}

main "$@"
