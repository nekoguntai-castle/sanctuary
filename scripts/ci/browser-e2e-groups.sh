#!/usr/bin/env bash
set -euo pipefail

readonly RENDER_SPEC='e2e/render-regression.spec.ts'
readonly GROUP_ADMIN_AUTH='admin-auth'
readonly GROUP_WALLET_FLOWS='wallet-flows'
readonly GROUP_WALLET_EXPERIENCE='wallet-experience'

list_groups() {
  printf '%s\n' "$GROUP_ADMIN_AUTH" "$GROUP_WALLET_FLOWS" "$GROUP_WALLET_EXPERIENCE"
}

list_group_specs() {
  case "${1:-}" in
    "$GROUP_ADMIN_AUTH")
      printf '%s\n' \
        e2e/accessibility.spec.ts \
        e2e/admin-drafts-smoke.spec.ts \
        e2e/admin-operations.spec.ts \
        e2e/auth.spec.ts
      ;;
    "$GROUP_WALLET_FLOWS")
      printf '%s\n' \
        e2e/create-wallet-flow.spec.ts \
        e2e/error-recovery.spec.ts \
        e2e/import-wallet-flow.spec.ts \
        e2e/send-transaction-flow.spec.ts
      ;;
    "$GROUP_WALLET_EXPERIENCE")
      printf '%s\n' \
        e2e/dashboard-price-blocks.spec.ts \
        e2e/settings-persistence.spec.ts \
        e2e/user-journeys.spec.ts \
        e2e/wallet-sharing-privacy.spec.ts \
        e2e/wallet.spec.ts
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
  find e2e -maxdepth 1 -name '*.spec.ts' ! -name "$(basename "$RENDER_SPEC")" | sort
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

  list_repo_browser_specs > "$repo_specs"
  list_assigned_specs | sort > "$assigned_specs"
  uniq -d "$assigned_specs" > "$duplicate_specs"
  comm -23 "$repo_specs" "$assigned_specs" > "$missing_specs"
  comm -13 "$repo_specs" "$assigned_specs" > "$extra_specs"

  fail_if_file_has_content 'Duplicate browser E2E group assignments:' "$duplicate_specs" || failed=true
  fail_if_file_has_content 'Missing browser E2E group assignments:' "$missing_specs" || failed=true
  fail_if_file_has_content 'Unknown browser E2E group assignments:' "$extra_specs" || failed=true

  if grep -Fxq "$RENDER_SPEC" "$assigned_specs"; then
    echo "$RENDER_SPEC must stay in the render-regression lane" >&2
    failed=true
  fi

  rm -rf "$temp_dir"

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
