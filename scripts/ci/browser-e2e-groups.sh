#!/usr/bin/env bash
set -euo pipefail

readonly RENDER_SPEC='tests/e2e/render-regression.spec.ts'
readonly GROUP_ADMIN_AUTH='admin-auth'
readonly GROUP_WALLET_LIFECYCLE='wallet-lifecycle'
readonly GROUP_WALLET_TRANSACTIONS='wallet-transactions'
readonly GROUP_WALLET_EXPERIENCE='wallet-experience'

list_groups() {
  printf '%s\n' \
    "$GROUP_ADMIN_AUTH" \
    "$GROUP_WALLET_LIFECYCLE" \
    "$GROUP_WALLET_TRANSACTIONS" \
    "$GROUP_WALLET_EXPERIENCE"
}

list_group_specs() {
  case "${1:-}" in
    "$GROUP_ADMIN_AUTH")
      printf '%s\n' \
        tests/e2e/accessibility.spec.ts \
        tests/e2e/admin-drafts-smoke.spec.ts \
        tests/e2e/admin-operations.spec.ts \
        tests/e2e/auth.spec.ts
      ;;
    "$GROUP_WALLET_LIFECYCLE")
      printf '%s\n' \
        tests/e2e/create-wallet-flow.spec.ts \
        tests/e2e/import-wallet-flow.spec.ts \
        tests/e2e/wallet-remediation.spec.ts
      ;;
    "$GROUP_WALLET_TRANSACTIONS")
      printf '%s\n' \
        tests/e2e/error-recovery.spec.ts \
        tests/e2e/send-transaction-flow.spec.ts
      ;;
    "$GROUP_WALLET_EXPERIENCE")
      printf '%s\n' \
        tests/e2e/console-drawer-smoke.spec.ts \
        tests/e2e/dashboard-price-blocks.spec.ts \
        tests/e2e/network-sync-toggle-dark.spec.ts \
        tests/e2e/settings-persistence.spec.ts \
        tests/e2e/user-journeys.spec.ts \
        tests/e2e/wallet-sharing-privacy.spec.ts \
        tests/e2e/wallet-sync-tooltip.spec.ts \
        tests/e2e/wallet.spec.ts
      ;;
    *)
      echo "Unknown browser E2E group: ${1:-}" >&2
      echo "Known groups:" >&2
      list_groups >&2
      return 1
      ;;
  esac
}

list_repo_browser_specs() {
  find tests/e2e -maxdepth 1 -name '*.spec.ts' ! -name "$(basename "$RENDER_SPEC")" | sort
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
  local assigned_specs duplicate_specs missing_specs extra_specs
  local failed=false

  assigned_specs="$(list_assigned_specs | sort)"
  duplicate_specs="$(printf '%s\n' "$assigned_specs" | uniq -d)"
  missing_specs="$(comm -23 <(list_repo_browser_specs) <(printf '%s\n' "$assigned_specs"))"
  extra_specs="$(comm -13 <(list_repo_browser_specs) <(printf '%s\n' "$assigned_specs"))"

  fail_if_content 'Duplicate browser E2E group assignments:' "$duplicate_specs" || failed=true
  fail_if_content 'Missing browser E2E group assignments:' "$missing_specs" || failed=true
  fail_if_content 'Unknown browser E2E group assignments:' "$extra_specs" || failed=true

  if grep -Fxq "$RENDER_SPEC" <<< "$assigned_specs"; then
    echo "$RENDER_SPEC must stay in the render-regression lane" >&2
    failed=true
  fi

  if [ "$failed" = "true" ]; then
    return 1
  fi

  echo 'Browser E2E group coverage is complete.'
}

case "${1:-}" in
  --check)
    check_groups
    ;;
  --groups)
    list_groups
    ;;
  '')
    echo 'Usage: scripts/ci/browser-e2e-groups.sh GROUP|--groups|--check' >&2
    exit 1
    ;;
  *)
    list_group_specs "$1"
    ;;
esac
