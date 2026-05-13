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

  expected=$'browser-origin-ip 21\nlegacy-runtime-env 24\nnotification-delivery 27\noptional-profiles 30'
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

  echo "extended upgrade fixture helper checks passed"
}

main "$@"
