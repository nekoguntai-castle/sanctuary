#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf -- "$TEST_ROOT"' EXIT

fail() { printf 'isolated subject driver test: %s\n' "$*" >&2; exit 1; }

CI=true FORGEJO_ACTIONS=true FORGEJO_SERVER_URL=https://forgejo.invalid \
GITHUB_ACTIONS=true GITHUB_RUN_ID=outer-run GITHUB_RUN_ATTEMPT=7 \
RUNNER_TEMP="$TEST_ROOT/outer-provider" SANCTUARY_CI_PROVIDER_CONTEXT_LOADED=1 \
SANCTUARY_CI_PROVIDER_OVERRIDE=forgejo STANDALONE_SENTINEL=kept \
  "$REPO_ROOT/scripts/ci/run-standalone-test-command.sh" bash -euo pipefail -c '
    for name in CI FORGEJO_ACTIONS FORGEJO_SERVER_URL GITHUB_ACTIONS \
      GITHUB_RUN_ID GITHUB_RUN_ATTEMPT RUNNER_TEMP \
      SANCTUARY_CI_PROVIDER_CONTEXT_LOADED SANCTUARY_CI_PROVIDER_OVERRIDE; do
      [[ ! -v $name ]] || exit 1
    done
    [[ $STANDALONE_SENTINEL == kept ]]
  ' || fail 'standalone test command retained outer provider authority'

SANCTUARY_CI_ORIGINAL_WORKSPACE="$TEST_ROOT" \
SANCTUARY_ARCHITECTURE_CORE_SCOPE=false \
SANCTUARY_ARCHITECTURE_DOCS_SCOPE=false \
  "$REPO_ROOT/scripts/ci/run-architecture-validation-subject.sh"
[[ -d $TEST_ROOT/.tmp/ci-diagnostics/architecture ]] || fail 'architecture diagnostics root missing'

if SANCTUARY_CI_ORIGINAL_WORKSPACE="$TEST_ROOT" \
  SANCTUARY_ARCHITECTURE_CORE_SCOPE=invalid SANCTUARY_ARCHITECTURE_DOCS_SCOPE=false \
  "$REPO_ROOT/scripts/ci/run-architecture-validation-subject.sh" >/dev/null 2>&1; then
  fail 'architecture driver accepted an invalid scope'
fi

if SANCTUARY_INSTALL_SUBJECT_MODE=invalid PORT_OFFSET=0 JOB_LOG_DIR="$TEST_ROOT/install-logs" \
  "$REPO_ROOT/scripts/ci/run-install-e2e-isolated-subject.sh" >/dev/null 2>&1; then
  fail 'install driver accepted an invalid mode'
fi

set +e
fresh_failure_output=$(SANCTUARY_INSTALL_SUBJECT_MODE=fresh-install PORT_OFFSET=0 \
  JOB_LOG_DIR="$TEST_ROOT/install-failure-logs" \
  SANCTUARY_RUN_FRESH_INSTALL=true SANCTUARY_RUN_INSTALL_SCRIPT=true \
  bash -c '
    source "$1/scripts/ci/run-install-e2e-isolated-subject.sh"
    calls=0
    run_supervised() {
      calls=$((calls + 1))
      (( calls == 1 )) && return 17
      return 0
    }
    status=0
    run_fresh_install || status=$?
    printf "calls=%s\n" "$calls"
    exit "$status"
  ' _ "$REPO_ROOT" 2>&1)
fresh_failure_status=$?
set -e
[[ $fresh_failure_status -eq 17 ]] || \
  fail "fresh-install failure was replaced by status $fresh_failure_status"
[[ $fresh_failure_output == 'calls=1' ]] || \
  fail "install script ran after fresh-install failure: $fresh_failure_output"

SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1 \
SANCTUARY_LOCAL_CLEANUP_RUN_ID=isolated-install-port-test \
SANCTUARY_CI_TEMP_DIR_OVERRIDE="$TEST_ROOT/provider-install" \
SANCTUARY_INSTALL_SUBJECT_MODE=install-stack PORT_OFFSET=9 \
JOB_LOG_DIR="$TEST_ROOT/install-port-logs" RUNNER_TEMP="$TEST_ROOT" GITHUB_RUN_ID=0 \
  "$REPO_ROOT/scripts/ci/cleanup-ci-callsite.sh" run --engine host \
    --lane isolated-install-port-test \
    --runtime "$TEST_ROOT/provider-install/runtime" \
    --artifact-dir "$TEST_ROOT/provider-install/artifacts" \
    --checkout-root "$REPO_ROOT" -- \
    bash -euo pipefail -c '
      source "$1/scripts/ci/run-install-e2e-isolated-subject.sh"
      mkdir -p "$JOB_LOG_DIR"
      assign_ports
      [[ ${HTTPS_PORT:-} == 10249 && ${HTTP_PORT:-} == 10250 && ${GATEWAY_PORT:-} == 10251 ]]
    ' _ "$REPO_ROOT" \
  || fail 'install driver did not import the generated port environment in-process'

if SANCTUARY_CI_ORIGINAL_WORKSPACE="$TEST_ROOT" JOB_LOG_DIR="$TEST_ROOT/upgrade-logs" \
  UPGRADE_BASELINE_REFS=latest-stable UPGRADE_EXTENDED_FIXTURES='' IS_RELEASE=false \
  GITHUB_RUN_ID=invalid \
  "$REPO_ROOT/scripts/ci/run-upgrade-baseline-isolated-subject.sh" >/dev/null 2>&1; then
  fail 'upgrade driver accepted an invalid run id'
fi

SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1 \
SANCTUARY_LOCAL_CLEANUP_RUN_ID=isolated-upgrade-port-test \
SANCTUARY_CI_TEMP_DIR_OVERRIDE="$TEST_ROOT/provider-upgrade" \
SANCTUARY_CI_ORIGINAL_WORKSPACE="$TEST_ROOT" JOB_LOG_DIR="$TEST_ROOT/upgrade-port-logs" \
UPGRADE_BASELINE_REFS=latest-stable UPGRADE_EXTENDED_FIXTURES='' IS_RELEASE=false \
GITHUB_RUN_ID=0 GITHUB_RUN_ATTEMPT=1 RUNNER_TEMP="$TEST_ROOT" \
  "$REPO_ROOT/scripts/ci/cleanup-ci-callsite.sh" run --engine host \
    --lane isolated-upgrade-port-test \
    --runtime "$TEST_ROOT/provider-upgrade/runtime" \
    --artifact-dir "$TEST_ROOT/provider-upgrade/artifacts" \
    --checkout-root "$REPO_ROOT" -- \
    bash -euo pipefail -c '
      source "$1/scripts/ci/run-upgrade-baseline-isolated-subject.sh"
      assign_ports 15
      [[ ${HTTPS_PORT:-} == 10255 && ${HTTP_PORT:-} == 10256 && ${GATEWAY_PORT:-} == 10257 ]]
    ' _ "$REPO_ROOT" \
  || fail 'upgrade driver did not import the generated port environment in-process'

printf 'isolated subject driver checks passed\n'
