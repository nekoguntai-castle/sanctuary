#!/usr/bin/env bash
# Computes the install-test workflow's "Install Test Summary" job output and
# exit status. Extracted verbatim (plus the fail-closed fix below) from the
# "Generate summary" step body in .github/workflows/install-test.yml so it can
# be exercised directly by tests/ci/compute-test-summary-status.test.sh -- the
# workflow-composition harness (tests/ci/check-workflow-composition.test.sh)
# is a static grep/structure checker and cannot execute a step's shell body.
#
# Invoked with the same env vars the workflow step sets: AUTH_FLOW,
# CONTAINER_HEALTH, COMMIT_SHA, EVENT_NAME, FRESH_INSTALL, INSTALL_SCRIPT,
# INSTALL_STACK_SMOKE, IS_RELEASE, REASON, REF_NAME, RUN_UPGRADE_BASELINE,
# RUN_UPGRADE_EXTENDED, RUN_UNIT, SCOPE, SHOULD_RUN, TEST_SUITE, UNIT_TESTS,
# UPGRADE_BASELINE, UPGRADE_BASELINE_REFS, UPGRADE_EXTENDED,
# UPGRADE_EXTENDED_FIXTURES, plus the workflow-level HTTPS_PORT/HTTP_PORT env.
# The step summary destination is resolved through provider-context.sh
# (ci_step_summary_file) instead of reading GITHUB_STEP_SUMMARY directly, so
# this script stays provider-portable (scripts/ci/check-provider-leaks.sh
# forbids raw provider env names outside the adapter/workflow/test layers).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
source "$SCRIPT_DIR/provider-context.sh"

summary="$(ci_step_summary_file)"

append_status() {
  local label="$1"
  local result="$2"

  if [ "$result" = "success" ]; then
    echo "- $label: :white_check_mark: Passed" >> "$summary"
  elif [ "$result" = "skipped" ]; then
    echo "- $label: :arrow_right: Skipped" >> "$summary"
  else
    echo "- $label: :x: Failed" >> "$summary"
  fi
}

echo "## Install Test Results" >> "$summary"
echo "" >> "$summary"
echo "Workflow commit: \`$COMMIT_SHA\`" >> "$summary"
echo "" >> "$summary"

# Check if tests were skipped due to no relevant changes
if [ "${SHOULD_RUN:-}" != "true" ]; then
  echo "### Tests Skipped" >> "$summary"
  echo "" >> "$summary"
  echo "> No install-relevant files changed. Tests were skipped." >> "$summary"
  echo "" >> "$summary"
  echo "Install tests run when these files change:" >> "$summary"
  echo "- \`install.sh\`, \`scripts/setup.sh\`, \`scripts/reset-user-2fa.sh\`" >> "$summary"
  echo "- \`docker-compose*.yml\`, \`server/Dockerfile\`, \`docker/**\`" >> "$summary"
  echo "- \`server/prisma/**\`, \`tests/install/**\`" >> "$summary"
  echo "- \`.github/workflows/install-test.yml\`" >> "$summary"
  exit 0
fi

# Show test context
if [ "${IS_RELEASE:-}" = "true" ]; then
  echo "### Release Validation: $REF_NAME" >> "$summary"
  echo "" >> "$summary"
  echo "> Running release-critical tests to validate installation before release." >> "$summary"
else
  echo "### Test Suite: $TEST_SUITE" >> "$summary"
fi
echo "" >> "$summary"
echo "- Scope: \`$SCOPE\`" >> "$summary"
echo "- Reason: $REASON" >> "$summary"
echo "- Upgrade baseline refs: \`${UPGRADE_BASELINE_REFS:-none}\`" >> "$summary"
echo "- Upgrade extended fixtures: \`${UPGRADE_EXTENDED_FIXTURES:-none}\`" >> "$summary"
echo "" >> "$summary"

# Unit tests
if [ "$UNIT_TESTS" = "success" ]; then
  echo "- Unit Tests: :white_check_mark: Passed" >> "$summary"
elif [ "$UNIT_TESTS" = "skipped" ] && \
     [ "$EVENT_NAME" = "workflow_dispatch" ] && \
     [ "$RUN_UNIT" == "true" ] && \
     [ "$TEST_SUITE" != "unit" ]; then
  echo "- Unit Tests: :white_check_mark: Passed in Fresh Install E2E job" >> "$summary"
elif [ "$UNIT_TESTS" = "skipped" ]; then
  echo "- Unit Tests: :arrow_right: Skipped" >> "$summary"
else
  echo "- Unit Tests: :x: Failed" >> "$summary"
fi

append_status "Fresh Install E2E" "$FRESH_INSTALL"
append_status "Install Script E2E" "$INSTALL_SCRIPT"
append_status "Install Stack Smoke" "$INSTALL_STACK_SMOKE"
append_status "Container Health" "$CONTAINER_HEALTH"
append_status "Auth Flow" "$AUTH_FLOW"
append_status "Baseline Upgrade Install" "$UPGRADE_BASELINE"
append_status "Extended Upgrade Fixtures" "$UPGRADE_EXTENDED"

SELECTED_UPGRADE_FAILED=false
if [ "$RUN_UPGRADE_BASELINE" = "true" ] && [ "$UPGRADE_BASELINE" != "success" ]; then
  echo "::error::Selected baseline upgrade refs did not pass: ${UPGRADE_BASELINE_REFS:-none} (job result: $UPGRADE_BASELINE)"
  SELECTED_UPGRADE_FAILED=true
fi
if [ "$RUN_UPGRADE_EXTENDED" = "true" ] && [ "$UPGRADE_EXTENDED" != "success" ]; then
  echo "::error::Selected extended upgrade fixtures did not pass: ${UPGRADE_EXTENDED_FIXTURES:-none} (job result: $UPGRADE_EXTENDED)"
  SELECTED_UPGRADE_FAILED=true
fi

# Any needs-job result of "failure" or "cancelled" fails this job on every
# run, release and non-release alike; "skipped" stays neutral. Previously
# only SELECTED_UPGRADE_FAILED (above) could fail a non-release run, and the
# full check lived solely in the sibling "Check release gate" step, gated
# `if: is_release == 'true'` -- so a failing unit-tests/fresh-install-test/
# install-script-test/container-health-test/auth-flow-test/install-stack-smoke
# job left an ordinary PR run's test-summary job green
# (install-test-summary-fail-open-non-release).
ANY_FAILED=false
for result in "$UNIT_TESTS" "$FRESH_INSTALL" "$INSTALL_SCRIPT" "$INSTALL_STACK_SMOKE" \
              "$CONTAINER_HEALTH" "$AUTH_FLOW" "$UPGRADE_BASELINE" "$UPGRADE_EXTENDED"; do
  if [ "$result" = "failure" ] || [ "$result" = "cancelled" ]; then
    ANY_FAILED=true
  fi
done

echo "" >> "$summary"
echo "### Test Configuration" >> "$summary"
echo "- HTTPS Port: ${HTTPS_PORT:-}" >> "$summary"
echo "- HTTP Port: ${HTTP_PORT:-}" >> "$summary"

# Release gate warning
if [ "$IS_RELEASE" = "true" ]; then
  echo "" >> "$summary"
  echo "---" >> "$summary"
  echo "" >> "$summary"
  STACK_OK=false
  if [ "$INSTALL_STACK_SMOKE" = "success" ] || \
     { [ "$CONTAINER_HEALTH" = "success" ] && [ "$AUTH_FLOW" = "success" ]; }; then
    STACK_OK=true
  fi
  if [ "$UNIT_TESTS" = "success" ] && \
     [ "$FRESH_INSTALL" = "success" ] && \
     [ "$INSTALL_SCRIPT" = "success" ] && \
     [ "$STACK_OK" = "true" ] && \
     [ "$UPGRADE_BASELINE" = "success" ] && \
     [ "$UPGRADE_EXTENDED" = "success" ]; then
    echo ":rocket: **Release validation passed!** Installation has been verified." >> "$summary"
  else
    echo ":stop_sign: **Release validation FAILED!** Do not proceed with release until issues are resolved." >> "$summary"
  fi
fi

if [ "$SELECTED_UPGRADE_FAILED" = "true" ] || [ "$ANY_FAILED" = "true" ]; then
  exit 1
fi
