#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GROUP_SCRIPT="$ROOT_DIR/scripts/ci/backend-integration-groups.sh"
TEST_TEMP_DIR=''

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}

assert_contains() {
  local file="$1"
  local expected="$2"

  grep -Fxq "$expected" "$file" || fail "expected ${file} to contain ${expected}"
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"

  if grep -Fxq "$unexpected" "$file"; then
    fail "expected ${file} not to contain ${unexpected}"
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
  local groups_file specs_file repo_specs_file repo_count assigned_count

  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  "$GROUP_SCRIPT" --check
  "$GROUP_SCRIPT" --groups > "$TEST_TEMP_DIR/groups"

  assert_contains "$TEST_TEMP_DIR/groups" 'flows'
  assert_contains "$TEST_TEMP_DIR/groups" 'repositories-core'
  assert_contains "$TEST_TEMP_DIR/groups" 'repositories-sharing'
  assert_contains "$TEST_TEMP_DIR/groups" 'ops-workers'
  assert_contains "$TEST_TEMP_DIR/groups" 'ops-destructive'
  "$GROUP_SCRIPT" ops-destructive > "$TEST_TEMP_DIR/ops-destructive"
  "$GROUP_SCRIPT" ops-workers > "$TEST_TEMP_DIR/ops-workers"
  "$GROUP_SCRIPT" flows > "$TEST_TEMP_DIR/flows"
  "$GROUP_SCRIPT" repositories-core > "$TEST_TEMP_DIR/repositories-core"
  assert_contains "$TEST_TEMP_DIR/ops-destructive" 'tests/integration/ops/phase2OperationsProof.integration.test.ts'
  assert_not_contains "$TEST_TEMP_DIR/ops-workers" 'tests/integration/ops/phase2OperationsProof.integration.test.ts'
  assert_contains "$TEST_TEMP_DIR/ops-workers" 'tests/integration/worker/deadLetterQueue.integration.test.ts'
  assert_contains "$TEST_TEMP_DIR/ops-workers" 'tests/integration/worker/expiredIncrementalReclaim.integration.test.ts'
  assert_contains "$TEST_TEMP_DIR/ops-workers" 'tests/integration/worker/jobProcessorLockLoss.integration.test.ts'
  assert_contains "$TEST_TEMP_DIR/ops-workers" 'tests/integration/worker/notificationDispatcherRetention.integration.test.ts'
  assert_contains "$TEST_TEMP_DIR/ops-workers" 'tests/integration/worker/recurringSchedules.integration.test.ts'
  assert_contains "$TEST_TEMP_DIR/ops-workers" 'tests/integration/worker/workerHeartbeatRegistryRetirement.integration.test.ts'
  assert_contains "$TEST_TEMP_DIR/flows" 'tests/integration/flows/authCsrfRecovery.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/deadLetterQueue.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/expiredIncrementalReclaim.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/jobProcessorLockLoss.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/notificationDispatcherRetention.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/recurringSchedules.integration.test.ts'
  assert_redis_suite_contract 'tests/integration/worker/workerHeartbeatRegistryRetirement.integration.test.ts'
  assert_contains "$TEST_TEMP_DIR/repositories-core" 'tests/integration/repositories/syncIntentReaders.test.ts'
  assert_contains "$TEST_TEMP_DIR/repositories-core" 'tests/integration/repositories/syncIntentLifecycle.test.ts'
  assert_contains "$TEST_TEMP_DIR/repositories-core" 'tests/integration/repositories/schedulerRetirementCutover.test.ts'
  assert_contains "$TEST_TEMP_DIR/repositories-core" 'tests/integration/repositories/syncMutationNetworkTransactions.test.ts'
  assert_contains "$TEST_TEMP_DIR/repositories-core" 'tests/integration/repositories/syncMutationRecursion.test.ts'
  assert_contains "$TEST_TEMP_DIR/repositories-core" 'tests/integration/repositories/subscriptionCheckpointLifecycle.test.ts'
  assert_contains "$TEST_TEMP_DIR/repositories-core" 'tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts'

  groups_file="$TEST_TEMP_DIR/groups"
  specs_file="$TEST_TEMP_DIR/specs"
  while IFS= read -r group; do
    "$GROUP_SCRIPT" "$group"
  done < "$groups_file" | sort > "$specs_file"

  repo_specs_file="$TEST_TEMP_DIR/repo-specs"
  find "$ROOT_DIR/server/tests/integration" -type f \
    \( -name '*.test.ts' -o -name '*.spec.ts' \) |
    sed "s#^$ROOT_DIR/server/##" |
    sort > "$repo_specs_file"

  repo_count="$(wc -l < "$repo_specs_file" | tr -d ' ')"
  assigned_count="$(wc -l < "$specs_file" | tr -d ' ')"
  [ "$repo_count" = "$assigned_count" ] || fail "expected ${repo_count} assigned integration specs, got ${assigned_count}"

  diff -u "$repo_specs_file" "$specs_file" || fail 'backend integration groups do not match repo specs'

  if "$GROUP_SCRIPT" unknown-group >/dev/null 2>&1; then
    fail 'unknown group should fail'
  fi

  echo 'backend integration group regression checks passed'
}

main "$@"
