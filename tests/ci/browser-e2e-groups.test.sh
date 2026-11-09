#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GROUP_SCRIPT="$ROOT_DIR/scripts/ci/browser-e2e-groups.sh"
SUBJECT_SCRIPT="$ROOT_DIR/scripts/ci/run-browser-e2e-subject.sh"
BUDGET_FILE="$ROOT_DIR/.github/ci-performance-budget.json"
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_group_specs() {
  local group="$1"
  shift
  local expected actual

  expected="$(printf '%s\n' "$@")"
  actual="$("$GROUP_SCRIPT" "$group")"
  [ "$actual" = "$expected" ] ||
    fail "group $group has specs: $(tr '\n' ' ' <<< "$actual")"
}

assert_not_contains() {
  local content="$1"
  local unexpected="$2"

  if grep -Fxq "$unexpected" <<< "$content"; then
    fail "expected output not to contain ${unexpected}"
  fi
}

# Runs the browser E2E subject in a fixture checkout holding every assigned
# spec plus the given extra specs. A stub `node` records whether the subject
# got as far as starting the backend, then fails so the run stops there.
run_subject_fixture() {
  local fixture_dir="$1"
  shift
  local spec group

  mkdir -p "$fixture_dir/scripts/ci" "$fixture_dir/tests/e2e" "$fixture_dir/bin"
  cp "$GROUP_SCRIPT" "$SUBJECT_SCRIPT" "$fixture_dir/scripts/ci/"
  while IFS= read -r group; do
    while IFS= read -r spec; do
      : > "$fixture_dir/$spec"
    done < <("$GROUP_SCRIPT" "$group")
  done < <("$GROUP_SCRIPT" --groups)
  for spec in "$@"; do
    : > "$fixture_dir/$spec"
  done
  # Stub node: the subject's first node call (the backend start token) comes only
  # after the group-coverage check, so this marker proves the check let it through.
  printf '#!/usr/bin/env bash\n: > "%s/node-invoked"\nexit 1\n' "$fixture_dir" > "$fixture_dir/bin/node"
  chmod +x "$fixture_dir/bin/node"

  PATH="$fixture_dir/bin:$PATH" SANCTUARY_CLEANUP_COORDINATED=1 BROWSER_E2E_API_PORT=1 \
    bash "$fixture_dir/scripts/ci/run-browser-e2e-subject.sh" > "$fixture_dir/subject.log" 2>&1
}

# --check must discover specs as Playwright does (config/tooling/playwright.config.ts sets no
# testMatch): recursively under tests/e2e with the default '**/*.@(spec|test).?(c|m)[jt]s?(x)',
# skipping node_modules. A nested spec, a *.test.ts or a *.spec.tsx left out of every group
# would otherwise be skipped silently by both browser lanes.
assert_check_discovers_playwright_specs() {
  local fixture_dir="$1"
  local spec group output

  mkdir -p "$fixture_dir/scripts/ci" "$fixture_dir/tests/e2e/admin" "$fixture_dir/tests/e2e/node_modules/pkg"
  cp "$GROUP_SCRIPT" "$fixture_dir/scripts/ci/"
  while IFS= read -r group; do
    while IFS= read -r spec; do
      : > "$fixture_dir/$spec"
    done < <("$GROUP_SCRIPT" "$group")
  done < <("$GROUP_SCRIPT" --groups)
  for spec in tests/e2e/render-regression.spec.ts tests/e2e/admin/new-flow.spec.ts \
    tests/e2e/payjoin-flow.test.ts tests/e2e/wallet-tx.spec.tsx tests/e2e/helpers.ts \
    tests/e2e/node_modules/pkg/vendored.spec.ts; do
    : > "$fixture_dir/$spec"
  done

  if output="$(cd "$fixture_dir" && bash scripts/ci/browser-e2e-groups.sh --check 2>&1)"; then
    fail "--check passed with specs Playwright would run outside every group: ${output}"
  fi
  for spec in tests/e2e/admin/new-flow.spec.ts tests/e2e/payjoin-flow.test.ts tests/e2e/wallet-tx.spec.tsx; do
    grep -Fxq "$spec" <<< "$output" || fail "--check did not report ${spec} as unassigned: ${output}"
  done
  for spec in tests/e2e/render-regression.spec.ts tests/e2e/helpers.ts tests/e2e/node_modules/pkg/vendored.spec.ts; do
    assert_not_contains "$output" "$spec"
  done
}

# A spec missing from every group would be skipped silently by the group
# loop, so the subject must refuse to run before it starts the backend.
assert_subject_refuses_unassigned_spec() {
  local fixture_root
  fixture_root="$(mktemp -d)"
  trap 'rm -rf "'"$fixture_root"'"' EXIT

  assert_check_discovers_playwright_specs "$fixture_root/discovery"

  if run_subject_fixture "$fixture_root/orphan" tests/e2e/orphan-flow.spec.ts; then
    fail 'subject should fail when a browser spec is not assigned to a group'
  fi
  grep -Fq 'Missing browser E2E group assignments:' "$fixture_root/orphan/subject.log" ||
    fail "subject did not report the unassigned spec: $(cat "$fixture_root/orphan/subject.log")"
  grep -Fxq 'tests/e2e/orphan-flow.spec.ts' "$fixture_root/orphan/subject.log" ||
    fail 'subject did not name the unassigned spec'
  [ ! -e "$fixture_root/orphan/node-invoked" ] ||
    fail 'subject invoked node before checking group coverage'

  # Complete coverage passes the check and reaches the first node call.
  run_subject_fixture "$fixture_root/complete" tests/e2e/render-regression.spec.ts || true
  [ -e "$fixture_root/complete/node-invoked" ] ||
    fail "subject did not reach node with complete coverage: $(cat "$fixture_root/complete/subject.log")"
}

main() {
  local groups specs repo_count assigned_count budget_groups stale_groups

  "$GROUP_SCRIPT" --check
  groups="$("$GROUP_SCRIPT" --groups)"

  [ "$groups" = $'admin-operations\nauth-accessibility\nwallet-create-import\nwallet-journeys\nwallet-error-recovery\nwallet-send\nwallet-dashboard\nwallet-settings' ] ||
    fail "unexpected browser E2E groups: $(tr '\n' ' ' <<< "$groups")"

  # The splits follow spec time measured in docs/plans/browser-e2e-group-split.md
  # (step 2) so each group keeps headroom under the same hard budget on a
  # co-scheduled host.
  assert_group_specs admin-operations \
    tests/e2e/admin-drafts-smoke.spec.ts tests/e2e/admin-operations.spec.ts
  assert_group_specs auth-accessibility \
    tests/e2e/accessibility.spec.ts tests/e2e/auth.spec.ts
  assert_group_specs wallet-create-import \
    tests/e2e/create-wallet-flow.spec.ts tests/e2e/import-wallet-flow.spec.ts
  assert_group_specs wallet-journeys \
    tests/e2e/user-journeys.spec.ts tests/e2e/wallet-remediation.spec.ts
  assert_group_specs wallet-error-recovery tests/e2e/error-recovery.spec.ts
  assert_group_specs wallet-send tests/e2e/send-transaction-flow.spec.ts
  assert_group_specs wallet-dashboard \
    tests/e2e/console-drawer-smoke.spec.ts tests/e2e/dashboard-price-blocks.spec.ts \
    tests/e2e/network-sync-toggle-dark.spec.ts tests/e2e/wallet-sync-tooltip.spec.ts
  assert_group_specs wallet-settings \
    tests/e2e/node-status-card-responsive.spec.ts tests/e2e/settings-persistence.spec.ts \
    tests/e2e/wallet-sharing-privacy.spec.ts tests/e2e/wallet.spec.ts

  # time-command.sh treats a label with no budget entry as unbudgeted, so a
  # group without one would silently lose its hard limit.
  while IFS= read -r group; do
    jq -e --arg name "browser-flow E2E $group" \
      '.budgets[$name] | .warnSeconds == 120 and .hardSeconds == 240' \
      "$BUDGET_FILE" >/dev/null ||
      fail "browser E2E group $group needs a 120 s / 240 s budget entry"
  done <<< "$groups"
  # Assigned outside any condition so a jq error aborts the test instead of
  # silently passing the check.
  budget_groups="$(jq -r '.budgets | keys[] | select(startswith("browser-flow E2E "))' "$BUDGET_FILE" |
    sed 's/^browser-flow E2E //')"
  stale_groups="$(grep -Fxv -f <(printf '%s\n' "$groups") <<< "$budget_groups" || true)"
  [ -z "$stale_groups" ] ||
    fail "budget file has browser-flow E2E entries for removed groups: $(tr '\n' ' ' <<< "$stale_groups")"

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

  repo_count="$(find "$ROOT_DIR/tests/e2e" -type d -name node_modules -prune -o -type f -regextype posix-extended \
    -regex '.*\.(spec|test)\.(c|m)?[jt]sx?' ! -name 'render-regression.spec.ts' -print | wc -l | tr -d ' ')"
  assigned_count="$(grep -c . <<< "$specs")"
  [ "$repo_count" = "$assigned_count" ] || fail "expected ${repo_count} assigned browser specs, got ${assigned_count}"

  if "$GROUP_SCRIPT" unknown-group >/dev/null 2>&1; then
    fail 'unknown group should fail'
  fi

  assert_subject_refuses_unassigned_spec

  echo 'browser E2E group regression checks passed'
}

main "$@"
