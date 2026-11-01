#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VALIDATOR="$ROOT_DIR/scripts/ci/validate-docker-build-results.sh"

expect_success() {
  bash "$VALIDATOR" "$@"
}

expect_failure() {
  if bash "$VALIDATOR" "$@" >/dev/null 2>&1; then
    echo "expected validation failure: $*" >&2
    exit 1
  fi
}

expect_success success true success false skipped true success false skipped true success false skipped true success
expect_success success false skipped true success false skipped true success false skipped false skipped true success
expect_failure failure true success false skipped true success false skipped true success false skipped true success
expect_failure '' true success false skipped true success false skipped true success false skipped true success
expect_failure success '' skipped false skipped true success false skipped true success false skipped true success
expect_failure success maybe skipped false skipped true success false skipped true success false skipped true success
expect_failure success true failure false skipped true success false skipped true success false skipped true success
expect_failure success false success false skipped true success false skipped true success false skipped true success
expect_failure success true success false skipped true success false skipped true cancelled false skipped true success

# The Tor image pair is the seventh; a requested but failed Tor build must fail.
expect_failure success true success false skipped true success false skipped true success false skipped true failure
expect_failure success true success false skipped true success false skipped true success false skipped false success
expect_failure success true success false skipped true success false skipped true success false skipped

echo "docker build result validation checks passed"
