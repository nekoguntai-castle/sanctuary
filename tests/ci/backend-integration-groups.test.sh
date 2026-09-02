#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GROUP_SCRIPT="$ROOT_DIR/scripts/ci/backend-integration-groups.sh"
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local content="$1"
  local expected="$2"

  grep -Fxq "$expected" <<< "$content" || fail "expected output to contain ${expected}"
}

assert_not_contains() {
  local content="$1"
  local unexpected="$2"

  if grep -Fxq "$unexpected" <<< "$content"; then
    fail "expected output not to contain ${unexpected}"
  fi
}

assert_redis_suite_contract() {
  local spec="$ROOT_DIR/server/$1"

  [ "$(grep -Fc 'describeWithRedis' "$spec")" -eq 2 ] \
    || fail "expected $1 to import and invoke describeWithRedis exactly once"
  if grep -Eq 'describeIfRedis|process\.env\.REDIS_URL[[:space:]]*\?[[:space:]]*describe' "$spec"; then
    fail "expected $1 to use only the centralized Redis suite contract"
  fi
}

main() {
  local groups specs repo_specs repo_count assigned_count
  local ops_destructive ops_workers flows repositories_core

  "$GROUP_SCRIPT" --check
  groups="$("$GROUP_SCRIPT" --groups)"

  assert_contains "$groups" 'flows'
  assert_contains "$groups" 'repositories-core'
  assert_contains "$groups" 'repositories-sharing'
  assert_contains "$groups" 'ops-workers'
  assert_contains "$groups" 'ops-destructive'
  ops_destructive="$("$GROUP_SCRIPT" ops-destructive)"
  ops_workers="$("$GROUP_SCRIPT" ops-workers)"
  flows="$("$GROUP_SCRIPT" flows)"
  repositories_core="$("$GROUP_SCRIPT" repositories-core)"
  assert_contains "$ops_destructive" 'tests/integration/ops/phase2OperationsProof.integration.test.ts'
  assert_not_contains "$ops_workers" 'tests/integration/ops/phase2OperationsProof.integration.test.ts'
  assert_contains "$ops_workers" 'tests/integration/worker/deadLetterQueue.integration.test.ts'
  assert_contains "$ops_workers" 'tests/integration/worker/expiredIncrementalReclaim.integration.test.ts'
  assert_contains "$ops_workers" 'tests/integration/worker/jobProcessorLockLoss.integration.test.ts'
  assert_contains "$ops_workers" 'tests/integration/worker/notificationDispatcherRetention.integration.test.ts'
  assert_contains "$ops_workers" 'tests/integration/worker/recurringSchedules.integration.test.ts'
  assert_contains "$ops_workers" 'tests/integration/worker/workerHeartbeatRegistryRetirement.integration.test.ts'
  assert_contains "$flows" 'tests/integration/flows/authCsrfRecovery.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/deadLetterQueue.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/expiredIncrementalReclaim.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/jobProcessorLockLoss.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/notificationDispatcherRetention.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/recurringSchedules.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/workerHeartbeatRegistryRetirement.integration.test.ts'
  assert_contains "$repositories_core" 'tests/integration/repositories/syncIntentReaders.test.ts'
  assert_contains "$repositories_core" 'tests/integration/repositories/syncIntentLifecycle.test.ts'
  assert_contains "$repositories_core" 'tests/integration/repositories/schedulerRetirementCutover.test.ts'
  assert_contains "$repositories_core" 'tests/integration/repositories/syncMutationNetworkTransactions.test.ts'
  assert_contains "$repositories_core" 'tests/integration/repositories/syncMutationRecursion.test.ts'
  assert_contains "$repositories_core" 'tests/integration/repositories/subscriptionCheckpointLifecycle.test.ts'
  assert_contains "$repositories_core" 'tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts'

  specs="$({
  while IFS= read -r group; do
    "$GROUP_SCRIPT" "$group"
    done <<< "$groups"
  } | sort)"

  repo_specs="$(find "$ROOT_DIR/server/tests/integration" -type f \
    \( -name '*.test.ts' -o -name '*.spec.ts' \) |
    sed "s#^$ROOT_DIR/server/##" |
    sort)"

  repo_count="$(grep -c . <<< "$repo_specs")"
  assigned_count="$(grep -c . <<< "$specs")"
  [ "$repo_count" = "$assigned_count" ] || fail "expected ${repo_count} assigned integration specs, got ${assigned_count}"

  diff -u <(printf '%s\n' "$repo_specs") <(printf '%s\n' "$specs") \
    || fail 'backend integration groups do not match repo specs'

  if "$GROUP_SCRIPT" unknown-group >/dev/null 2>&1; then
    fail 'unknown group should fail'
  fi

  echo 'backend integration group regression checks passed'
}

main "$@"
