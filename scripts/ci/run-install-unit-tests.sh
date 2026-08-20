#!/usr/bin/env bash
# Single source of truth for the install unit suites.
#
# This exists because the previous arrangement could not fail. install-test.yml
# piped fifteen test scripts into a bare `bash` on stdin:
#
#     run-with-log.sh ... run-in-isolated-workspace.sh install-unit bash <<'INNER'
#     ./tests/install/unit/install-script.test.sh
#     ... thirteen more ...
#     ./tests/ci/relay-job-diagnosability.test.sh
#     INNER
#
# Bash reading a script from stdin without -e does not abort on a failing
# command, so the step's exit status was only the LAST command's. Fourteen of the
# fifteen were structurally unable to fail CI. That is how PR #832 shipped a
# broken classify-install-scope.sh green: install-scope.test.sh ran on that PR,
# at list position 11, failed, and was thrown away. The bug then took down
# v0.8.64-rc1 and cost the release four more candidates.
#
# A script file cannot reproduce that: it runs under this shebang with
# `set -euo pipefail`, so the first failure stops the run and propagates.
#
# The list is a glob, not an enumeration, for the second half of the same bug:
# install-test.yml listed fifteen suites while release-candidate.yml listed ten,
# silently omitting migration-compose-contract, grafana-password-migration and
# grafana-quiescence -- so the RC gate never exercised the Grafana suites, in the
# release whose two hardest bugs were both in the Grafana migration path. A glob
# means a new tests/install/unit/*.test.sh is picked up by every caller with no
# registration step.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

run_suite() {
  local suite="$1"
  echo "=== ${suite}"
  bash "$suite"
}

shopt -s nullglob
suites=(tests/install/unit/*.test.sh)
shopt -u nullglob

if [ "${#suites[@]}" -eq 0 ]; then
  echo "run-install-unit-tests: no suites matched tests/install/unit/*.test.sh" >&2
  exit 1
fi

for suite in "${suites[@]}"; do
  run_suite "$suite"
done

# CI-composition suites install-test.yml has always run alongside the install
# ones. They are named explicitly because they are not install unit tests and
# tests/ci/ holds many more that belong to other lanes.
for suite in \
  tests/ci/check-workflow-composition.test.sh \
  tests/ci/relay-job-diagnosability.test.sh
do
  run_suite "$suite"
done

echo "install unit suites passed (${#suites[@]} install + 2 ci-composition)"
