#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

readonly GROUP_API='api'
readonly GROUP_FLOWS='flows'
readonly GROUP_REPOSITORIES_CORE='repositories-core'
readonly GROUP_REPOSITORIES_SHARING='repositories-sharing'
readonly GROUP_OPS_WORKERS='ops-workers'
readonly GROUP_OPS_DESTRUCTIVE='ops-destructive'

list_groups() {
  printf '%s\n' \
    "$GROUP_API" \
    "$GROUP_FLOWS" \
    "$GROUP_REPOSITORIES_CORE" \
    "$GROUP_REPOSITORIES_SHARING" \
    "$GROUP_OPS_WORKERS" \
    "$GROUP_OPS_DESTRUCTIVE"
}

list_group_specs() {
  case "${1:-}" in
    "$GROUP_API")
      printf '%s\n' \
        tests/integration/api/broadcastIntentAudit.test.ts \
        tests/integration/api/walletApprovalsAudit.test.ts
      ;;
    "$GROUP_FLOWS")
      printf '%s\n' \
        tests/integration/flows/admin.integration.test.ts \
        tests/integration/flows/authIntentConcurrency.integration.test.ts \
        tests/integration/flows/authCsrfRecovery.integration.test.ts \
        tests/integration/flows/auth.integration.test.ts \
        tests/integration/flows/coinControl.integration.test.ts \
        tests/integration/flows/internalReceivingPersistence.integration.test.ts \
        tests/integration/flows/labels.integration.test.ts \
        tests/integration/flows/payjoin.integration.test.ts \
        tests/integration/flows/security.integration.test.ts \
        tests/integration/flows/transfers.integration.test.ts \
        tests/integration/flows/transactions.integration.test.ts \
        tests/integration/flows/transactionsCreationCrossWallet.integration.test.ts \
        tests/integration/flows/webhookHeaderPatch.integration.test.ts \
        tests/integration/flows/wallet.integration.test.ts \
        tests/integration/flows/walletDescriptorAtomicity.integration.test.ts \
        tests/integration/flows/walletRemediation.integration.test.ts \
        tests/integration/flows/walletSafetyAudit.integration.test.ts
      ;;
    "$GROUP_REPOSITORIES_CORE")
      printf '%s\n' \
        tests/integration/repositories/addressRepository.test.ts \
        tests/integration/repositories/auditLogRepository.test.ts \
        tests/integration/repositories/draftRepository.test.ts \
        tests/integration/repositories/labelRepository.test.ts \
        tests/integration/repositories/networkHeaderReconciliationLifecycle.test.ts \
        tests/integration/repositories/policyRepository.audit.test.ts \
        tests/integration/repositories/schedulerRetirementCutover.test.ts \
        tests/integration/repositories/syncCorrectionAtomicity.test.ts \
        tests/integration/repositories/syncIntentLifecycle.test.ts \
        tests/integration/repositories/syncIntentReaders.test.ts \
        tests/integration/repositories/syncMutationNetworkTransactions.test.ts \
        tests/integration/repositories/syncMutationRecursion.test.ts \
        tests/integration/repositories/subscriptionCheckpointLifecycle.test.ts \
        tests/integration/repositories/subscriptionCoverageLifecycle.test.ts \
        tests/integration/repositories/transactionExportPoolPressure.test.ts \
        tests/integration/repositories/transactionSigningIntentRepository.integration.test.ts \
        tests/integration/repositories/transactionRepository.test.ts \
        tests/integration/repositories/transactionSyncReconciliation.test.ts \
        tests/integration/repositories/utxoRepository.test.ts \
        tests/integration/repositories/walletRepository.test.ts \
        tests/integration/repositories/walletSyncCrossNetworkContract.test.ts \
        tests/integration/repositories/walletSyncRecoveryQueryPlans.test.ts \
        tests/integration/repositories/walletSyncRollingUpgrade.test.ts
      ;;
    "$GROUP_REPOSITORIES_SHARING")
      printf '%s\n' \
        tests/integration/repositories/deviceRepository.test.ts \
        tests/integration/repositories/deviceSharingRepository.test.ts \
        tests/integration/repositories/pushDeviceRepository.test.ts \
        tests/integration/repositories/sessionRepository.test.ts \
        tests/integration/repositories/systemSettingRepository.test.ts \
        tests/integration/repositories/userRepository.test.ts \
        tests/integration/repositories/walletDeviceSignerBinding.test.ts \
        tests/integration/repositories/walletSharingRepository.test.ts
      ;;
    "$GROUP_OPS_WORKERS")
      printf '%s\n' \
        tests/integration/websocket/websocket.integration.test.ts \
        tests/integration/worker/canonicalProducerAdmission.integration.test.ts \
        tests/integration/worker/featureFlagToggle.integration.test.ts \
        tests/integration/worker/deadLetterQueue.integration.test.ts \
        tests/integration/worker/expiredIncrementalReclaim.integration.test.ts \
        tests/integration/worker/jobProcessorLockLoss.integration.test.ts \
        tests/integration/worker/notificationDispatcherRetention.integration.test.ts \
        tests/integration/worker/recurringSchedules.integration.test.ts \
        tests/integration/worker/workerHeartbeatRegistryRetirement.integration.test.ts \
        tests/integration/worker/webhookRetryRecovery.integration.test.ts \
        tests/integration/worker/worker.integration.test.ts \
        tests/integration/worker/workerJobQueueLock.integration.test.ts
      ;;
    "$GROUP_OPS_DESTRUCTIVE")
      printf '%s\n' \
        tests/integration/ops/phase2OperationsProof.integration.test.ts
      ;;
    *)
      echo "Unknown backend integration group: ${1:-}" >&2
      echo 'Known groups:' >&2
      list_groups >&2
      return 1
      ;;
  esac
}

list_repo_integration_specs() {
  find "$ROOT_DIR/server/tests/integration" -type f \
    \( -name '*.test.ts' -o -name '*.spec.ts' \) |
    sed "s#^$ROOT_DIR/server/##" |
    sort
}

list_assigned_specs() {
  local group

  while IFS= read -r group; do
    list_group_specs "$group"
  done < <(list_groups)
}

fail_if_content() {
  local message="$1"
  local content="$2"

  if [ -n "$content" ]; then
    echo "$message" >&2
    printf '%s\n' "$content" >&2
    return 1
  fi
}

check_groups() {
  local repo_specs assigned_specs duplicate_specs missing_specs extra_specs
  local failed=false

  repo_specs="$(list_repo_integration_specs)"
  assigned_specs="$(list_assigned_specs | sort)"
  duplicate_specs="$(printf '%s\n' "$assigned_specs" | uniq -d)"
  missing_specs="$(comm -23 <(printf '%s\n' "$repo_specs") <(printf '%s\n' "$assigned_specs"))"
  extra_specs="$(comm -13 <(printf '%s\n' "$repo_specs") <(printf '%s\n' "$assigned_specs"))"

  fail_if_content 'Duplicate backend integration group assignments:' "$duplicate_specs" || failed=true
  fail_if_content 'Missing backend integration group assignments:' "$missing_specs" || failed=true
  fail_if_content 'Unknown backend integration group assignments:' "$extra_specs" || failed=true

  if [ "$failed" = "true" ]; then
    return 1
  fi

  echo 'Backend integration group coverage is complete.'
}

case "${1:-}" in
  --check)
    check_groups
    ;;
  --groups)
    list_groups
    ;;
  '')
    echo 'Usage: scripts/ci/backend-integration-groups.sh GROUP|--groups|--check' >&2
    exit 1
    ;;
  *)
    list_group_specs "$1"
    ;;
esac
