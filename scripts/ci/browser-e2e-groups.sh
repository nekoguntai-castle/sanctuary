#!/usr/bin/env bash
set -euo pipefail

readonly RENDER_SPEC='tests/e2e/render-regression.spec.ts'
readonly GROUP_ADMIN_OPERATIONS='admin-operations'
readonly GROUP_AUTH_ACCESSIBILITY='auth-accessibility'
readonly GROUP_WALLET_CREATE_IMPORT='wallet-create-import'
readonly GROUP_WALLET_JOURNEYS='wallet-journeys'
readonly GROUP_WALLET_ERROR_RECOVERY='wallet-error-recovery'
readonly GROUP_WALLET_SEND='wallet-send'
readonly GROUP_WALLET_DASHBOARD='wallet-dashboard'
readonly GROUP_WALLET_SETTINGS='wallet-settings'

list_groups() {
  printf '%s\n' \
    "$GROUP_ADMIN_OPERATIONS" \
    "$GROUP_AUTH_ACCESSIBILITY" \
    "$GROUP_WALLET_CREATE_IMPORT" \
    "$GROUP_WALLET_JOURNEYS" \
    "$GROUP_WALLET_ERROR_RECOVERY" \
    "$GROUP_WALLET_SEND" \
    "$GROUP_WALLET_DASHBOARD" \
    "$GROUP_WALLET_SETTINGS"
}

list_group_specs() {
  case "${1:-}" in
    # admin-auth and wallet-lifecycle were split by spec time measured in
    # step 2 of docs/plans/browser-e2e-group-split.md: each ran 180-255 s
    # against its 240 s hard budget on a host shared with mutation work.
    "$GROUP_ADMIN_OPERATIONS")
      printf '%s\n' \
        tests/e2e/admin-drafts-smoke.spec.ts \
        tests/e2e/admin-operations.spec.ts
      ;;
    "$GROUP_AUTH_ACCESSIBILITY")
      printf '%s\n' \
        tests/e2e/accessibility.spec.ts \
        tests/e2e/auth.spec.ts
      ;;
    "$GROUP_WALLET_CREATE_IMPORT")
      printf '%s\n' \
        tests/e2e/create-wallet-flow.spec.ts \
        tests/e2e/import-wallet-flow.spec.ts
      ;;
    "$GROUP_WALLET_JOURNEYS")
      printf '%s\n' \
        tests/e2e/user-journeys.spec.ts \
        tests/e2e/wallet-remediation.spec.ts
      ;;
    # wallet-transactions and wallet-experience were split the same way after
    # they reached 189 s and 201 s on a co-scheduled host (run 22913).
    "$GROUP_WALLET_ERROR_RECOVERY")
      printf '%s\n' \
        tests/e2e/error-recovery.spec.ts
      ;;
    "$GROUP_WALLET_SEND")
      printf '%s\n' \
        tests/e2e/send-transaction-flow.spec.ts
      ;;
    "$GROUP_WALLET_DASHBOARD")
      printf '%s\n' \
        tests/e2e/console-drawer-smoke.spec.ts \
        tests/e2e/dashboard-price-blocks.spec.ts \
        tests/e2e/network-sync-toggle-dark.spec.ts \
        tests/e2e/wallet-sync-tooltip.spec.ts
      ;;
    "$GROUP_WALLET_SETTINGS")
      printf '%s\n' \
        tests/e2e/node-status-card-responsive.spec.ts \
        tests/e2e/settings-persistence.spec.ts \
        tests/e2e/wallet-sharing-privacy.spec.ts \
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

readonly PLAYWRIGHT_CONFIG='config/tooling/playwright.config.ts'

# Mirrors Playwright's discovery for PLAYWRIGHT_CONFIG: testDir tests/e2e, walked
# recursively with node_modules skipped, and no testMatch/testIgnore override in the
# config or any project, so the default '**/*.@(spec|test).?(c|m)[jt]s?(x)' applies.
assert_default_playwright_discovery() {
  if [ -f "$PLAYWRIGHT_CONFIG" ] && grep -Eq '\b(testMatch|testIgnore)\b' "$PLAYWRIGHT_CONFIG"; then
    echo "$PLAYWRIGHT_CONFIG overrides testMatch/testIgnore; mirror it in list_repo_browser_specs" >&2
    return 1
  fi
}

list_repo_browser_specs() {
  find tests/e2e -type d -name node_modules -prune -o -type f -regextype posix-extended \
    -regex '.*\.(spec|test)\.(c|m)?[jt]sx?' ! -path "$RENDER_SPEC" -print | sort
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

  assert_default_playwright_discovery || return 1
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
