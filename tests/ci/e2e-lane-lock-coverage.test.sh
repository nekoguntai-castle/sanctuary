#!/usr/bin/env bash
# Regression: an e2e lane must hold the runner lock for the whole lifetime of
# its stack, not re-acquire it per step.
#
# The lanes used to take the `e2e` lock to start containers, release it, run an
# unlocked wait-for-migration, then take it again for the test. That left a live
# stack unprotected between locked sections. install-test.yml and
# release-candidate.yml both fire on an RC tag by design, so another lane could
# hold the lock and work the same daemon while the first lane's containers sat
# idle.
#
# v0.8.60-rc2's Container Health died in that window: backend reported Healthy
# when `docker compose up` returned, all 30 following probes failed, and the
# backend and migrate containers no longer existed six minutes later while
# postgres, frontend and gateway survived. See #719.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNNER="$REPO_ROOT/scripts/ci/run-e2e-lane-phases.sh"

PASS=0
FAIL=0
FAILURES=()
ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

# ----- 1. no workflow waits for migration outside a lock --------------------
# The unlocked wait step is the exact shape of the regression.
for wf in "$REPO_ROOT"/.github/workflows/*.yml; do
  name="$(basename "$wf")"
  if grep -qE 'run-with-log\.sh "\$JOB_LOG_DIR/wait-migration\.log"' "$wf"; then
    bad "$name still runs wait-migration as its own step — that step holds no lock while the stack is live"
  fi
done
ok 'no workflow runs wait-migration as an unlocked step'

# ----- 2. the phase runner exists and is executable -------------------------
if [ -x "$RUNNER" ]; then
  ok 'run-e2e-lane-phases.sh exists and is executable'
else
  bad 'run-e2e-lane-phases.sh is missing or not executable'
fi

# ----- 3. every phase-runner call is wrapped in a lock ----------------------
# A call that is not preceded by with-runner-lock.sh reintroduces the gap.
# Compare counts rather than asking "does any line lack the lock" — the latter
# reads naturally but inverts badly: an earlier version of this check passed a
# negative control with the lock deliberately removed.
#
# `bash -n scripts/ci/run-e2e-lane-phases.sh` is a syntax sweep, not an
# invocation, so it neither needs nor should hold the lock.
unlocked=0
while IFS= read -r wf; do
  # Comments are stripped before counting. A comment naming the script is not
  # an invocation, and counting one inflates `invocations` with no matching
  # lock: release-candidate.yml explains the phase split in prose above each
  # call, so it reported 4 invocations against 2 locks while both real calls
  # were correctly wrapped. Stripping happens after continuations are joined,
  # so a commented fragment cannot rejoin a live line.
  joined="$(sed ':a;N;$!ba;s/\\\n[[:space:]]*/ /g' "$wf" \
    | sed 's/[[:space:]]*#.*$//' \
    | grep -E 'run-e2e-lane-phases\.sh' | grep -v 'bash -n' || true)"
  [ -n "$joined" ] || continue
  invocations="$(printf '%s\n' "$joined" | grep -c . || true)"
  locked="$(printf '%s\n' "$joined" | grep -c 'with-runner-lock\.sh e2e' || true)"
  if [ "${invocations:-0}" -ne "${locked:-0}" ]; then
    unlocked=$((unlocked + 1))
    bad "$(basename "$wf"): ${invocations} phase-runner invocation(s) but only ${locked} hold the e2e lock"
  fi
done < <(grep -rl 'run-e2e-lane-phases\.sh' "$REPO_ROOT"/.github/workflows/*.yml 2>/dev/null)
[ "$unlocked" -eq 0 ] && ok 'every phase-runner invocation is wrapped in the e2e runner lock'

# ----- 4. the phase runner still emits the three diagnostic logs ------------
# write-diagnostic-summary.sh and the artifact index are keyed to these names;
# collapsing the steps must not collapse the evidence.
for expected in 'start-containers.log' 'wait-migration.log' '${LANE}.log'; do
  if grep -Fq "$expected" "$RUNNER"; then
    ok "phase runner still writes $expected"
  else
    bad "phase runner no longer writes $expected — diagnostics would lose that phase"
  fi
done

# ----- 5. it refuses a missing test command ---------------------------------
# Silently running only the first two phases would look like a pass.
if "$RUNNER" /tmp /tmp lane >/dev/null 2>&1; then
  bad 'phase runner accepted an empty test command'
else
  ok 'phase runner rejects a missing test command'
fi

echo
echo "passed: $PASS  failed: $FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '  - %s\n' "${FAILURES[@]}" >&2
  exit 1
fi
