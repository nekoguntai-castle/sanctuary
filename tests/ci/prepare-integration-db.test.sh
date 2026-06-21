#!/usr/bin/env bash
# Regression checks for scripts/ci/prepare-integration-db.sh that do NOT require
# a database (so they run in the dependency-free CI classifier lane). The
# happy-path (wait -> migrate -> assert) is exercised live by the backend
# integration lanes in test.yml.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/prepare-integration-db.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_status() {
  # Runs the script with the given env assignments (passed as VAR=value args)
  # and echoes its exit status without aborting this test under `set -e`.
  local status
  set +e
  env "$@" bash "$SCRIPT" >/dev/null 2>&1
  status=$?
  set -e
  echo "$status"
}

[ -f "$SCRIPT" ] || fail "missing $SCRIPT"
[ -x "$SCRIPT" ] || fail "$SCRIPT is not executable"

# Non-integer attempt count is rejected before any DB work (exit 2).
status="$(run_status SANCTUARY_DB_MIGRATE_ATTEMPTS=abc DATABASE_URL=postgresql://u:p@127.0.0.1:1/db)"
[ "$status" = "2" ] || fail "expected exit 2 for non-integer SANCTUARY_DB_MIGRATE_ATTEMPTS, got $status"

# Zero attempts is rejected too (exit 2).
status="$(run_status SANCTUARY_DB_MIGRATE_ATTEMPTS=0 DATABASE_URL=postgresql://u:p@127.0.0.1:1/db)"
[ "$status" = "2" ] || fail "expected exit 2 for zero SANCTUARY_DB_MIGRATE_ATTEMPTS, got $status"

echo "prepare-integration-db.test.sh: all checks passed"
