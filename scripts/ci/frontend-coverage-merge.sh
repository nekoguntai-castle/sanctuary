#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "frontend-coverage-merge: $*" >&2
  exit 1
}

MERGE_REPORTS_DIR=''

cleanup_merge_reports_dir() {
  if [ -n "$MERGE_REPORTS_DIR" ]; then
    rm -rf "$MERGE_REPORTS_DIR"
  fi
}

main() {
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

  MERGE_REPORTS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/frontend-coverage-reports.XXXXXX")"
  trap cleanup_merge_reports_dir EXIT

  for blob in "$reports_dir"/blob-*.json; do
    if [ -f "$blob" ]; then
      cp "$blob" "$MERGE_REPORTS_DIR/"
    fi
  done

  rm -rf coverage
  "$vitest_bin" run --coverage --mergeReports "$MERGE_REPORTS_DIR"

  if [ ! -f coverage/coverage-summary.json ]; then
    fail 'expected merged frontend coverage summary at coverage/coverage-summary.json'
  fi
}

main "$@"
