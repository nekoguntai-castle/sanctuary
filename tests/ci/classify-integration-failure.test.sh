#!/usr/bin/env bash
# Regression: the backend integration group must not retry assertion failures.
#
# test.yml previously wrapped the whole group in a bare three-attempt loop that
# retried on any non-zero exit. A spec failing 1-in-5 survives that about 124
# times in 125, so genuine flakiness read as green (sanctuary#713). The loop
# existed to self-heal a suspected Postgres wipe — a hypothesis sanctuary#612
# disproved, having root-caused the failure to Docker DNS alias rotation.
#
# These cases pin the replacement: retry only on database-loss signatures.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/classify-integration-failure.sh"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[ -f "$SCRIPT" ] || { echo "FATAL: $SCRIPT missing" >&2; exit 1; }

# classify <name> <expected-exit> <description> <<< log-content
classify() {
  local name="$1" want="$2" desc="$3"
  local log="$WORK/$name.log"
  cat > "$log"
  bash "$SCRIPT" "$log" >/dev/null 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then
    ok "$desc"
  else
    bad "$desc (wanted exit $want, got $got)"
  fi
}

# --- not retryable: assertion failures ---------------------------------------

classify assertion 1 'assertion failure is not retryable' <<'EOF'
FAIL tests/integration/flows/transfers.integration.test.ts
 × commits expired status before returning the expiration error
   AssertionError: expected [] to have a length of 1 but got +0
 Tests  1 failed | 299 passed (300)
EOF

classify concurrency 1 'concurrency-race failure is not retryable' <<'EOF'
 × allows only one concurrent refresh-token rotation for the same old token
   AssertionError: expected [] to have a length of 1 but got +0
EOF

# The exact #612 downstream symptoms. These were caused by alias rotation,
# which is fixed; on their own they are equally consistent with a regression.
classify symptoms_612 1 'bulk 401s / advisory-lock timeouts / FK violations are not retryable' <<'EOF'
Error: expected 200 "OK", got 401 "Unauthorized"
Error: Timed out waiting for 1 ownership fence waiter(s)
Error: Timed out waiting for wallet balance advisory lock
Error: Timed out waiting for advisory lock query: transaction_ownership_repairs
Error: ForeignKeyConstraintViolation
EOF

classify clean_fail 1 'a plain non-zero exit with no signature is not retryable' <<'EOF'
Tests  3 failed | 297 passed (300)
EOF

# --- retryable: genuine database loss ----------------------------------------

classify p1001 0 'P1001 unreachable server is retryable' <<'EOF'
PrismaClientInitializationError: P1001: Can't reach database server at `postgres`:`5432`
EOF

classify p2021 0 'P2021 missing table is retryable' <<'EOF'
PrismaClientKnownRequestError: P2021: The table `public.users` does not exist in the current database.
EOF

classify relation 0 'missing relation is retryable' <<'EOF'
error: relation "users" does not exist
EOF

classify terminated 0 'connection terminated unexpectedly is retryable' <<'EOF'
Error: Connection terminated unexpectedly
EOF

classify refused 0 'ECONNREFUSED is retryable' <<'EOF'
Error: connect ECONNREFUSED 10.89.0.4:5432
EOF

classify starting 0 'database starting up is retryable' <<'EOF'
FATAL: the database system is starting up
EOF

# --- mixed: a real assertion failure alongside DB noise ----------------------
# Retry is still permitted here. The signature means the run cannot be trusted
# as evidence either way, so a clean re-run is the honest response.
classify mixed 0 'DB-loss signature wins when mixed with assertions' <<'EOF'
 × commits expired status before returning the expiration error
   AssertionError: expected [] to have a length of 1
Error: Connection terminated unexpectedly
EOF

# --- fail closed --------------------------------------------------------------

bash "$SCRIPT" "$WORK/definitely-absent.log" >/dev/null 2>&1
[ $? -eq 1 ] && ok 'missing log fails closed (not retryable)' || bad 'missing log must not be retryable'

bash "$SCRIPT" >/dev/null 2>&1
[ $? -ne 0 ] && ok 'no argument is rejected' || bad 'missing argument must be rejected'

bash "$SCRIPT" a b >/dev/null 2>&1
[ $? -ne 0 ] && ok 'extra arguments are rejected' || bad 'extra arguments must be rejected'

# --- case-insensitivity is intentional but must not over-match ---------------
classify unrelated 1 'unrelated text mentioning a database is not retryable' <<'EOF'
info: seeding the database with fixtures
Tests  1 failed | 299 passed (300)
EOF

# --- the workflow actually consults the classifier ---------------------------
# Without this, the classifier could be correct and unused — the retry loop
# could drift back to blind behaviour and every case above would still pass.

TEST_WORKFLOW="$REPO_ROOT/.github/workflows/test.yml"
if [ -r "$TEST_WORKFLOW" ]; then
  if grep -qF 'scripts/ci/classify-integration-failure.sh' "$TEST_WORKFLOW"; then
    ok 'test.yml invokes the classifier'
  else
    bad 'test.yml no longer invokes classify-integration-failure.sh — the retry is blind again'
  fi

  # The old shape retried on any non-zero exit with no classification between
  # attempts. If a loop over attempts exists but nothing calls the classifier
  # inside the backend-integration step, that regression is back.
  if grep -q 'first-attempt result' "$TEST_WORKFLOW"; then
    ok 'test.yml reports first-attempt health'
  else
    bad 'test.yml no longer reports first-attempt health; late passes become invisible again'
  fi
else
  bad "cannot read $TEST_WORKFLOW"
fi

echo
echo "===================="
echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "classify-integration-failure regression checks passed"
