#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "frontend-coverage-merge: $*" >&2
  exit 1
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

  local vitest_bin="${VITEST_BIN:-./node_modules/.bin/vitest}"
  if [ ! -x "$vitest_bin" ]; then
    fail "Vitest binary not found at ${vitest_bin}; run npm ci first"
  fi

  rm -rf coverage
  "$vitest_bin" run --coverage --mergeReports "$reports_dir"

  if [ ! -f coverage/coverage-summary.json ]; then
    fail 'expected merged frontend coverage summary at coverage/coverage-summary.json'
  fi
}

main "$@"
