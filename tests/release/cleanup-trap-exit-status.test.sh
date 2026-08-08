#!/usr/bin/env bash
# Regression: a release test's cleanup trap must not be able to fail the suite.
#
# sanctuary#749. create-forge-release.test.sh passed every assertion — 220/220,
# `Failed: 0` throughout — and the job still exited 1. The only error was from
# its own EXIT trap:
#
#   find: cannot delete '…/repo/.git/objects': Directory not empty
#
# The fixture builds 107 commits, so git's background auto-gc can write into
# .git/objects while the trap's `find -delete` walks it. A red required check
# from a green suite is the worst kind of CI failure: it trains people to
# re-run rather than read.
#
# The mechanism is `set -e`, not the missing `exit 0`. Under `set -euo
# pipefail` a failing command inside an EXIT trap triggers errexit and sets the
# script's status — and it does so *even when the script ends with an explicit
# `exit 0`*. #749 proposed `exit 0` as part of the fix; measured, it does not
# help. The only thing that works is a cleanup that cannot fail.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$REPO_ROOT/tests/release/create-forge-release.test.sh"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[ -r "$TARGET" ] || { echo "FATAL: missing $TARGET" >&2; exit 1; }

# --- 1. the mechanism, demonstrated ------------------------------------------
# Pin the behaviour the fix relies on, so nobody "simplifies" the cleanup back
# into something that can fail, or re-adds `exit 0` believing it is sufficient.

run_variant() {
  printf '%s\n' "$1" > "$WORK/v.sh"
  bash "$WORK/v.sh" >/dev/null 2>&1
  echo $?
}

status="$(run_variant 'set -euo pipefail
trap "false" EXIT
echo done')"
[ "$status" -eq 1 ] && ok 'set -e: a failing EXIT trap fails the script' \
                    || bad "expected 1 from a failing trap, got $status"

status="$(run_variant 'set -euo pipefail
trap "false" EXIT
echo done
exit 0')"
[ "$status" -eq 1 ] && ok 'set -e: an explicit exit 0 does NOT rescue a failing trap' \
                    || bad "expected 1 even with exit 0, got $status — mechanism changed, revisit #749"

status="$(run_variant 'set -euo pipefail
trap "false || true" EXIT
echo done')"
[ "$status" -eq 0 ] && ok 'set -e: a trap that cannot fail leaves the status alone' \
                    || bad "expected 0 from a guarded trap, got $status"

# --- 2. the real script's cleanup cannot fail --------------------------------

trap_line="$(grep -n "trap .* EXIT" "$TARGET" | head -1)"
if [ -z "$trap_line" ]; then
  bad "no EXIT trap found in create-forge-release.test.sh"
else
  body="${trap_line#*:}"
  if printf '%s' "$body" | grep -q 'rm -rf'; then
    ok 'cleanup uses rm -rf, which succeeds on a racing directory'
  elif printf '%s' "$body" | grep -q '|| true'; then
    ok 'cleanup ends with || true, so it cannot set the exit status'
  else
    bad "cleanup can fail the suite: $body"
  fi
fi

# --- 3. the cause is removed too ---------------------------------------------
# Disabling auto-gc stops the race happening at all. Belt and braces: (2) makes
# the symptom harmless, this makes the trigger unlikely.

if grep -q 'gc.auto' "$TARGET"; then
  ok 'fixture disables git auto-gc, so nothing writes to .git/objects concurrently'
else
  bad 'fixture does not disable gc.auto — the 107-commit loop can trigger background gc'
fi

# --- 4. the suite still announces success ------------------------------------
# The absent marker line is how #749 was identified as a trap failure rather
# than an assertion failure. Keep it.

if grep -q 'create-forge-release tests passed' "$TARGET"; then
  ok 'suite still prints its completion marker'
else
  bad 'completion marker removed — a trap failure becomes indistinguishable from a real one'
fi

echo
echo "===================="
echo "Passed: $PASS"
echo "Failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "cleanup trap exit-status checks passed"
