#!/usr/bin/env bash
# Regression checks proving the integration-DB target guard
# (scripts/ci/integration-db-guard.mjs, P2
# `prepare-integration-db-no-production-guard`) is actually wired into the CI
# helper (check-integration-db.mjs) and the migrate wrapper
# (prepare-integration-db.sh) — not just present as an unused module. No real
# Postgres is required: a refusal happens before any connection attempt, and
# the one "accepted" case below points at a closed local port so the ensuing
# (guard-permitted) connection attempt fails fast for unrelated reasons.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT_DIR/scripts/ci/check-integration-db.mjs"
PREPARE="$ROOT_DIR/scripts/ci/prepare-integration-db.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_status_and_output() {
  # Runs the given command, capturing combined output and exit status
  # without aborting this test under `set -e`.
  local output status
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  printf '%s\n' "$status"
  printf '%s\n' "$output"
}

# --- check-integration-db.mjs -------------------------------------------

# A production-looking host is refused before any network attempt (fast).
unset TEST_DATABASE_URL
export DATABASE_URL='postgresql://u:p@prod-db.internal:5432/wallet'
result="$(run_status_and_output node "$CHECK" wait --timeout=1)"
status="$(head -1 <<< "$result")"
output="$(tail -n +2 <<< "$result")"
[ "$status" != "0" ] || fail "check-integration-db wait accepted a production host"
grep -q 'refusing to target integration database host "prod-db.internal"' <<< "$output" \
  || fail "expected the guard message for a production host, got: $output"

# A resolver-style gateway IP is refused without the opt-in...
export DATABASE_URL='postgresql://u:p@10.0.2.2:5432/wallet'
result="$(run_status_and_output node "$CHECK" wait --timeout=1)"
status="$(head -1 <<< "$result")"
output="$(tail -n +2 <<< "$result")"
[ "$status" != "0" ] || fail "check-integration-db wait accepted a gateway IP without the opt-in"
grep -q 'refusing to target integration database host "10.0.2.2"' <<< "$output" \
  || fail "expected the guard message for a gateway IP host, got: $output"

# ...and passes the guard (reaches the real connection attempt, which then
# fails on its own merits against nothing listening) once the resolver-style
# opt-in is set.
export DATABASE_URL='postgresql://u:p@10.0.2.2:1/wallet'
export SANCTUARY_ALLOW_INTEGRATION_DB_TARGET=1
result="$(run_status_and_output node "$CHECK" wait --timeout=1)"
output="$(tail -n +2 <<< "$result")"
grep -q 'integration-db-guard: refusing' <<< "$output" \
  && fail "the opt-in should have bypassed the guard, got: $output"
grep -q 'postgres not ready' <<< "$output" \
  || fail "expected the guard-permitted attempt to reach the real connection probe, got: $output"
unset SANCTUARY_ALLOW_INTEGRATION_DB_TARGET

# localhost is accepted with no opt-in required (reaches the real probe
# against a closed port and fails on its own merits, quickly).
export DATABASE_URL='postgresql://u:p@127.0.0.1:1/wallet'
result="$(run_status_and_output node "$CHECK" wait --timeout=1)"
output="$(tail -n +2 <<< "$result")"
grep -q 'integration-db-guard: refusing' <<< "$output" \
  && fail "localhost should never need the opt-in, got: $output"
grep -q 'postgres not ready' <<< "$output" \
  || fail "expected the guard-permitted attempt to reach the real connection probe, got: $output"

# --- prepare-integration-db.sh -------------------------------------------

# The migrate wrapper refuses before touching `prisma migrate deploy` or the
# readiness wait loop at all.
export DATABASE_URL='postgresql://u:p@prod-db.internal:5432/wallet'
result="$(cd "$ROOT_DIR/server" && run_status_and_output bash "$PREPARE")"
status="$(head -1 <<< "$result")"
output="$(tail -n +2 <<< "$result")"
[ "$status" != "0" ] || fail "prepare-integration-db.sh accepted a production host"
grep -q 'refusing to target integration database host "prod-db.internal"' <<< "$output" \
  || fail "expected the guard message from prepare-integration-db.sh, got: $output"
grep -q 'prisma migrate deploy' <<< "$output" \
  && fail "prepare-integration-db.sh should refuse before attempting any migrate, got: $output"
unset DATABASE_URL

echo "check-integration-db-guard.test.sh: all checks passed"
