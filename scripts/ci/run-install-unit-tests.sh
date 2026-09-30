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
# `set -euo pipefail`, and run-parallel-suites.sh fails the run if any suite
# fails, so every failure propagates.
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

# Unit suites deliberately interrupt controllers and reuse common Compose project
# names. Keep their project locks inside each suite's runtime fixture so one
# intentional crash cannot poison a later suite or a persistent CI runner.
export SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true
export SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime

# The workflow-composition guard is also part of the install/release unit lane,
# whose clean checkout deliberately has no root dependency install. Install its
# one-package, lifecycle-disabled parser boundary instead of the monorepo tree.
scripts/ci/retry-command.sh "CI YAML parser dependencies" npm ci --prefix tests/ci/lib --strict-allow-scripts --ignore-scripts --audit=false --fund=false

shopt -s nullglob
suites=(tests/install/unit/*.test.sh)
shopt -u nullglob

if [ "${#suites[@]}" -eq 0 ]; then
  echo "run-install-unit-tests: no suites matched tests/install/unit/*.test.sh" >&2
  exit 1
fi

# CI-composition suites install-test.yml has always run alongside the install
# ones. They are named explicitly because they are not install unit tests and
# tests/ci/ holds many more that belong to other lanes.
ci_suites=(
  tests/ci/check-workflow-composition.test.sh
  tests/ci/relay-job-diagnosability.test.sh
)

# The suites are independent (each keeps its fixtures, project locks and fake
# endpoints under its own temp dirs), so they run four at a time with one log
# each (R7 of tasks/ci-speedup-analysis-2026-09-29.md). Every suite still runs,
# and the run fails, naming each failed suite and printing its log, if any of
# them failed.
for suite in "${suites[@]}" "${ci_suites[@]}"; do
  printf 'scripts/ci/run-install-unit-suite.sh %q\n' "$suite"
done | scripts/ci/run-parallel-suites.sh "${SANCTUARY_INSTALL_UNIT_LOG_DIR:-.tmp/install-unit-suites}"

echo "install unit suites passed (${#suites[@]} install + ${#ci_suites[@]} ci-composition)"
