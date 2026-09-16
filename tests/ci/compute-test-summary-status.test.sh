#!/usr/bin/env bash
# Regression: install-test-summary-fail-open-non-release
#
# .github/workflows/install-test.yml's "Generate summary" step (the
# test-summary job) previously computed only one failing condition
# (SELECTED_UPGRADE_FAILED, from the *selected* upgrade matrices) on every
# run, and left every other job result -- unit tests, fresh install, install
# script, container health, auth flow -- feeding only the human-readable
# summary text. The full pass/fail check across those results lived solely
# in the sibling "Check release gate" step, gated `if: is_release == 'true'`.
# So on an ordinary (non-release) run, a failing e.g. fresh-install-test job
# left the test-summary job green.
#
# tests/ci/check-workflow-composition.test.sh is a static grep/structure
# harness over the YAML text and cannot execute a step's shell body, so the
# step body was extracted into scripts/ci/compute-test-summary-status.sh
# (invoked by the workflow step, driven by the same env vars) to make the
# fail-open/fail-closed behavior directly testable here.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/compute-test-summary-status.sh"

PASS=0
FAIL=0
FAILURES=()
ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

if [ ! -f "$SCRIPT" ]; then
  bad "compute-test-summary-status.sh does not exist at $SCRIPT"
  echo
  echo "===================="
  echo "Total:  $((PASS + FAIL))"
  echo "Passed: $PASS"
  echo "Failed: $FAIL"
  exit 1
fi

bash -n "$SCRIPT" || bad 'compute-test-summary-status.sh does not parse'

# The script resolves its step-summary destination through
# provider-context.sh's ci_step_summary_file() instead of reading
# GITHUB_STEP_SUMMARY directly, so it stays clear of the provider-leak gate
# (scripts/ci/check-provider-leaks.sh forbids raw provider env names outside
# the adapter/workflow/test layers -- this script previously leaked
# GITHUB_STEP_SUMMARY and failed `Code Quality / CI classifier tests`). Prove
# it with the real gate rather than a local grep: the gate itself already
# knows to ignore comment lines and detection-only reads, which a naive
# grep for the literal name does not (this file's own header comment
# mentions the name for documentation purposes).
if grep -q 'source .*provider-context\.sh' "$SCRIPT"; then
  ok 'compute-test-summary-status.sh sources the provider-context adapter'
else
  bad 'compute-test-summary-status.sh does not source provider-context.sh'
fi
if bash "$REPO_ROOT/scripts/ci/check-provider-leaks.sh" >/dev/null 2>&1; then
  ok 'the provider-leak gate passes with compute-test-summary-status.sh in the tree'
else
  bad 'the provider-leak gate fails with compute-test-summary-status.sh in the tree'
fi

# Baseline env: a healthy non-release run where every job either passed or
# was legitimately skipped (as determine-scope would produce when no upgrade
# matrix was selected). Each test passes only the overrides it needs as
# KEY=VALUE arguments to run_status; SUMMARY_BODY is left in a file (not a
# subshell-local variable) so it survives back to the caller.
SUMMARY_BODY=""
run_status() {
  local -A env_vars=(
    [COMMIT_SHA]="deadbeefcafef00d"
    [EVENT_NAME]="push"
    [REF_NAME]="refs/heads/main"
    [REASON]="install-relevant files changed"
    [SCOPE]="full"
    [TEST_SUITE]="unit"
    [SHOULD_RUN]="true"
    [IS_RELEASE]="false"
    [RUN_UNIT]="false"
    [RUN_UPGRADE_BASELINE]="false"
    [RUN_UPGRADE_EXTENDED]="false"
    [UPGRADE_BASELINE_REFS]=""
    [UPGRADE_EXTENDED_FIXTURES]=""
    [UNIT_TESTS]="success"
    [FRESH_INSTALL]="success"
    [INSTALL_SCRIPT]="success"
    [INSTALL_STACK_SMOKE]="skipped"
    [CONTAINER_HEALTH]="skipped"
    [AUTH_FLOW]="skipped"
    [UPGRADE_BASELINE]="skipped"
    [UPGRADE_EXTENDED]="skipped"
    [HTTPS_PORT]="8443"
    [HTTP_PORT]="8080"
  )
  local override key value summary_file rc
  for override in "$@"; do
    key="${override%%=*}"
    value="${override#*=}"
    env_vars["$key"]="$value"
  done

  summary_file="$(mktemp)"
  local -a env_args=()
  for key in "${!env_vars[@]}"; do
    env_args+=("$key=${env_vars[$key]}")
  done

  env "GITHUB_STEP_SUMMARY=$summary_file" "${env_args[@]}" \
    bash "$SCRIPT" > "$summary_file.stdout" 2>&1
  rc=$?

  SUMMARY_BODY="$(cat "$summary_file")"
  rm -f "$summary_file" "$summary_file.stdout"
  return $rc
}

# ----- 1. non-release run, one failing job (the regression) -----------------
# Everything else clean, only fresh-install-test failed. Today (before the
# fix) this exits 0: the only failing check on a non-release run is
# SELECTED_UPGRADE_FAILED, and no upgrade matrix was selected here.
run_status IS_RELEASE=false FRESH_INSTALL=failure
rc=$?
if [ "$rc" -eq 1 ]; then
  ok 'non-release run fails closed when fresh-install-test fails'
else
  bad "non-release run with a failing fresh-install-test did not fail (rc=$rc)"
fi

# ----- 2. non-release run, a cancelled job counts as failed too -------------
run_status IS_RELEASE=false UNIT_TESTS=cancelled
rc=$?
if [ "$rc" -eq 1 ]; then
  ok 'non-release run fails closed when unit-tests is cancelled'
else
  bad "non-release run with a cancelled unit-tests did not fail (rc=$rc)"
fi

# ----- 3. non-release run, everything green ---------------------------------
run_status IS_RELEASE=false
rc=$?
if [ "$rc" -eq 0 ]; then
  ok 'non-release run with every job passing or skipped exits 0'
else
  bad "non-release healthy run wrongly failed (rc=$rc)"
fi

# ----- 4. non-release run, a legitimately skipped job is not a failure ------
run_status IS_RELEASE=false INSTALL_STACK_SMOKE=skipped CONTAINER_HEALTH=skipped AUTH_FLOW=skipped
rc=$?
if [ "$rc" -eq 0 ]; then
  ok 'non-release run treats skipped jobs as neutral, not failed'
else
  bad "non-release run wrongly failed on skipped jobs (rc=$rc)"
fi

# ----- 5. unchanged behavior: selected upgrade failure still fails ----------
run_status IS_RELEASE=false RUN_UPGRADE_BASELINE=true UPGRADE_BASELINE=failure
rc=$?
if [ "$rc" -eq 1 ]; then
  ok 'a selected baseline upgrade failure still fails the summary job'
else
  bad "selected upgrade baseline failure stopped failing the job (rc=$rc)"
fi

# ----- 6. unchanged behavior: no relevant changes still exits 0 -------------
run_status SHOULD_RUN=false FRESH_INSTALL=failure
rc=$?
if [ "$rc" -eq 0 ]; then
  ok 'a skipped run (no install-relevant changes) still exits 0 regardless of job results'
else
  bad "skipped run wrongly failed (rc=$rc)"
fi

# ----- 7. unchanged release behavior: release run, everything green --------
run_status IS_RELEASE=true UNIT_TESTS=success FRESH_INSTALL=success INSTALL_SCRIPT=success \
  INSTALL_STACK_SMOKE=success CONTAINER_HEALTH=skipped AUTH_FLOW=skipped \
  UPGRADE_BASELINE=success UPGRADE_EXTENDED=success
rc=$?
if [ "$rc" -eq 0 ] && grep -q 'Release validation passed' <<< "$SUMMARY_BODY"; then
  ok 'a healthy release run still exits 0 and reports release validation passed'
else
  bad "healthy release run regressed (rc=$rc): $(printf '%s' "$SUMMARY_BODY" | tr '\n' ' ' | cut -c1-200)"
fi

# ----- 8. release run, a required job failed --------------------------------
# The dedicated "Check release gate" workflow step (untouched by this fix)
# already fails the job for this case; this script now fails closed here too
# via the same ANY_FAILED computation as the non-release path, instead of
# relying solely on that sibling step.
run_status IS_RELEASE=true FRESH_INSTALL=failure UPGRADE_BASELINE=success UPGRADE_EXTENDED=success \
  INSTALL_STACK_SMOKE=success
rc=$?
if [ "$rc" -eq 1 ]; then
  ok 'a release run with a failing required job fails the summary job too'
else
  bad "release run with a failing fresh-install-test did not fail (rc=$rc)"
fi

echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do echo "  - $f" >&2; done
  exit 1
fi
