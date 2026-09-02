#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GROUP_SCRIPT="$ROOT_DIR/scripts/ci/browser-e2e-groups.sh"
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_not_contains() {
  local content="$1"
  local unexpected="$2"

  if grep -Fxq "$unexpected" <<< "$content"; then
    fail "expected output not to contain ${unexpected}"
  fi
}

main() {
  local groups specs repo_count assigned_count

  "$GROUP_SCRIPT" --check
  groups="$("$GROUP_SCRIPT" --groups)"

  grep -Fxq 'admin-auth' <<< "$groups" || fail 'missing admin-auth group'
  grep -Fxq 'wallet-lifecycle' <<< "$groups" || fail 'missing wallet-lifecycle group'
  grep -Fxq 'wallet-transactions' <<< "$groups" || fail 'missing wallet-transactions group'
  grep -Fxq 'wallet-experience' <<< "$groups" || fail 'missing wallet-experience group'

  specs="$({
  while IFS= read -r group; do
    "$GROUP_SCRIPT" "$group"
    done <<< "$groups"
  } | sort)"

  assert_not_contains "$specs" 'tests/e2e/render-regression.spec.ts'

  if grep -Eq 'SKIP_AUTH_TESTS|test\.skip' \
    "$ROOT_DIR/tests/e2e/auth.spec.ts" \
    "$ROOT_DIR/tests/e2e/wallet.spec.ts"; then
    fail 'auth and wallet browser evidence must not contain conditional skips'
  fi

  grep -Fq "page.goto('/#/wallets')" "$ROOT_DIR/tests/e2e/wallet.spec.ts" ||
    fail 'wallet browser evidence must navigate through the HashRouter'
  grep -Fq 'new RegExp(`#/wallets/${BROWSER_E2E_FIXTURES.wallet.id}$`)' \
    "$ROOT_DIR/tests/e2e/wallet.spec.ts" ||
    fail 'wallet browser evidence must assert the hash-routed detail URL'
  if grep -Fq 'toHaveURL(/dashboard|wallets|home/i)' \
    "$ROOT_DIR/tests/e2e/auth.spec.ts" \
    "$ROOT_DIR/tests/e2e/wallet.spec.ts"; then
    fail 'login evidence must assert authenticated UI instead of a nonexistent redirect'
  fi

  repo_count="$(find "$ROOT_DIR/tests/e2e" -maxdepth 1 -name '*.spec.ts' ! -name 'render-regression.spec.ts' | wc -l | tr -d ' ')"
  assigned_count="$(grep -c . <<< "$specs")"
  [ "$repo_count" = "$assigned_count" ] || fail "expected ${repo_count} assigned browser specs, got ${assigned_count}"

  if "$GROUP_SCRIPT" unknown-group >/dev/null 2>&1; then
    fail 'unknown group should fail'
  fi

  echo 'browser E2E group regression checks passed'
}

main "$@"
