#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/run-extended-upgrade-fixtures.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

main() {
  local expected actual

  bash -n "$SCRIPT"

  expected=$'browser-origin-ip 21\nlegacy-runtime-env 24\nnotification-delivery 27\noptional-profiles 30\nwallet-sync-retirement 33'
  actual="$(bash "$SCRIPT" --list)"
  [ "$actual" = "$expected" ] || fail "unexpected fixture list: ${actual}"

  actual="$(bash "$SCRIPT" --fixtures optional-profiles --source-ref 'release/v0.8.39' --validate-only)"
  [ "$actual" = 'optional-profiles 30' ] || fail "unexpected selected fixture validation: ${actual}"

  actual="$(SANCTUARY_UPGRADE_EXTENDED_FIXTURES=legacy-runtime-env bash "$SCRIPT" --validate-only)"
  [ "$actual" = 'legacy-runtime-env 24' ] || fail "env fixture selection should preserve stable offsets: ${actual}"

  if bash "$SCRIPT" --fixtures not-a-fixture --validate-only >/dev/null 2>&1; then
    fail 'expected invalid fixture selection to fail'
  fi

  if bash "$SCRIPT" --fixtures 'browser-origin-ip,' --validate-only >/dev/null 2>&1; then
    fail 'expected empty fixture selector to fail'
  fi

  if bash "$SCRIPT" --source-ref 'bad ref' --validate-only >/dev/null 2>&1; then
    fail 'expected invalid source ref selection to fail'
  fi

  if bash "$SCRIPT" --bogus >/dev/null 2>&1; then
    fail 'expected unknown option to fail'
  fi

  grep -Fq 'cleanup-ci-callsite.sh" run' "$SCRIPT" ||
    fail 'expected extended upgrade wrapper to use the receipt-bound coordinator'
  grep -Fq -- '--authority-mode deployment_managed_by_subject' "$SCRIPT" ||
    fail 'expected extended upgrade wrapper to select subject-managed deployment authority'
  grep -Fq 'source scripts/ci/provider-context.sh' "$SCRIPT" ||
    fail 'expected the isolated fixture shell to load provider-neutral cleanup paths'
  grep -Fq -- '--subject-exit-status' "$SCRIPT" &&
    fail 'run mode must obtain the subject status from the supervised command'
  grep -Fq 'exit "$status"' "$SCRIPT" ||
    fail 'expected extended upgrade wrapper to preserve the coordinator status'
  if grep -Eq 'cleanup-docker-resources|upgrade_finish_with_cleanup|--prefix|--verify-empty' "$SCRIPT"; then
    fail 'extended upgrade wrapper must not retain a legacy cleanup bypass'
  fi
  if grep -Fq 'docker compose down' "$SCRIPT"; then
    fail 'extended upgrade wrapper must leave graceful Compose teardown to the test'
  fi

  echo "extended upgrade fixture helper checks passed"
}

main "$@"
