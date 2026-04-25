#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

readonly GROUP_FLOWS='flows'
readonly GROUP_REPOSITORIES_CORE='repositories-core'
readonly GROUP_REPOSITORIES_SHARING='repositories-sharing'
readonly GROUP_OPS_WORKERS='ops-workers'

list_groups() {
  printf '%s\n' \
    "$GROUP_FLOWS" \
    "$GROUP_REPOSITORIES_CORE" \
    "$GROUP_REPOSITORIES_SHARING" \
    "$GROUP_OPS_WORKERS"
}

list_group_specs() {
  case "${1:-}" in
    "$GROUP_FLOWS")
      printf '%s\n' \
        tests/integration/flows/admin.integration.test.ts \
        tests/integration/flows/auth.integration.test.ts \
        tests/integration/flows/coinControl.integration.test.ts \
        tests/integration/flows/labels.integration.test.ts \
        tests/integration/flows/payjoin.integration.test.ts \
        tests/integration/flows/security.integration.test.ts \
        tests/integration/flows/transactions.integration.test.ts \
        tests/integration/flows/transactionsCreationCrossWallet.integration.test.ts \
        tests/integration/flows/wallet.integration.test.ts
      ;;
    "$GROUP_REPOSITORIES_CORE")
      printf '%s\n' \
        tests/integration/repositories/addressRepository.test.ts \
        tests/integration/repositories/auditLogRepository.test.ts \
        tests/integration/repositories/draftRepository.test.ts \
        tests/integration/repositories/labelRepository.test.ts \
        tests/integration/repositories/transactionRepository.test.ts \
        tests/integration/repositories/utxoRepository.test.ts \
        tests/integration/repositories/walletRepository.test.ts
      ;;
    "$GROUP_REPOSITORIES_SHARING")
      printf '%s\n' \
        tests/integration/repositories/deviceRepository.test.ts \
        tests/integration/repositories/deviceSharingRepository.test.ts \
        tests/integration/repositories/pushDeviceRepository.test.ts \
        tests/integration/repositories/sessionRepository.test.ts \
        tests/integration/repositories/systemSettingRepository.test.ts \
        tests/integration/repositories/userRepository.test.ts \
        tests/integration/repositories/walletSharingRepository.test.ts
      ;;
    "$GROUP_OPS_WORKERS")
      printf '%s\n' \
        tests/integration/ops/phase2OperationsProof.integration.test.ts \
        tests/integration/websocket/websocket.integration.test.ts \
        tests/integration/worker/featureFlagToggle.integration.test.ts \
        tests/integration/worker/worker.integration.test.ts \
        tests/integration/worker/workerJobQueueLock.integration.test.ts
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

fail_if_file_has_content() {
  local message="$1"
  local file="$2"

  if [ -s "$file" ]; then
    echo "$message" >&2
    cat "$file" >&2
    return 1
  fi
}

check_groups() {
  local temp_dir repo_specs assigned_specs duplicate_specs missing_specs extra_specs
  local failed=false

  temp_dir="$(mktemp -d)"

  repo_specs="$temp_dir/repo-specs"
  assigned_specs="$temp_dir/assigned-specs"
  duplicate_specs="$temp_dir/duplicate-specs"
  missing_specs="$temp_dir/missing-specs"
  extra_specs="$temp_dir/extra-specs"

  list_repo_integration_specs > "$repo_specs"
  list_assigned_specs | sort > "$assigned_specs"
  uniq -d "$assigned_specs" > "$duplicate_specs"
  comm -23 "$repo_specs" "$assigned_specs" > "$missing_specs"
  comm -13 "$repo_specs" "$assigned_specs" > "$extra_specs"

  fail_if_file_has_content 'Duplicate backend integration group assignments:' "$duplicate_specs" || failed=true
  fail_if_file_has_content 'Missing backend integration group assignments:' "$missing_specs" || failed=true
  fail_if_file_has_content 'Unknown backend integration group assignments:' "$extra_specs" || failed=true

  rm -rf "$temp_dir"

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
