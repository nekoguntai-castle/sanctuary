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

  # The wrapper used to hardcode --legacy-fixture-creation-witness on the
  # assumption that every extended fixture installs from a pre-ownership source
  # tree. That was true only while latest-stable predated ownership. Ownership
  # shipped IN v0.8.70, so the moment v0.8.70 became latest-stable the
  # assumption inverted and upgrade-install.test.sh began refusing every fixture
  # with "Coordinated upgrade from owned source ... requires
  # SANCTUARY_UPGRADE_DEPLOYMENT_ROOT" (issue #1028), failing in ~1s. It is a
  # time bomb rather than a normal regression: v0.8.70 shipped green and every
  # RC after it failed, without the wrapper changing.
  #
  # The baseline wrapper already branches on upgrade_source_is_owned; this one
  # must too, exactly so the next ownership-aware stable release does not
  # re-arm the same bomb.
  grep -Fq 'upgrade_source_is_owned' "$SCRIPT" ||
    fail 'extended wrapper must detect an ownership-aware source instead of assuming legacy'
  grep -Fq 'SANCTUARY_UPGRADE_DEPLOYMENT_ROOT' "$SCRIPT" ||
    fail 'extended wrapper must name the coordinator checkout root for an owned source (#1028)'
  grep -Fq -- '--upgrade-target-commit' "$SCRIPT" ||
    fail 'extended wrapper must declare the candidate commit for an owned source'
  if grep -Eq '^\s*--legacy-fixture-creation-witness \\$' "$SCRIPT"; then
    fail 'legacy witness must be conditional on the source being pre-ownership, not hardcoded'
  fi

  # #1057 canary incident (run 17568, job 220695): the wrapper builds
  # cleanup_lane="extended-${fixture}" and hands it to
  # scripts/ownership/ci-cleanup-authority.mjs's coordinator only after
  # spinning up an isolated, Docker-visible workspace. A fixture name whose
  # lane exceeds that authority's 32-char LANE limit died there in seconds,
  # after a runner had already been consumed. validate_cleanup_lane must
  # catch this up front, before run_fixture ever runs, and must name both
  # the offending fixture and its lane length.
  grep -Fq 'validate_cleanup_lane "$fixture"' "$SCRIPT" ||
    fail 'expected run_all_fixtures to validate every selected fixture cleanup lane'
  guard_order="$(grep -n 'validate_cleanup_lane "\$fixture"\|run_fixture "\$fixture"' "$SCRIPT")"
  [ "$(echo "$guard_order" | head -1 | cut -d: -f1)" -lt "$(echo "$guard_order" | tail -1 | cut -d: -f1)" ] ||
    fail 'cleanup lane guard must run before run_fixture, not after'

  guard_funcs="$(sed -n '/^cleanup_lane_regex_source() {/,/^}/p; /^validate_cleanup_lane() {/,/^}/p' "$SCRIPT")"
  [ -n "$guard_funcs" ] || fail 'expected to find the cleanup lane guard functions in the wrapper'

  if guard_output="$(
        eval "$guard_funcs"
        ROOT_DIR="$ROOT_DIR"
        validate_cleanup_lane 'a-canary-fixture-name-far-too-long-for-any-cleanup-lane' 2>&1
      )"; then
    fail 'expected an oversized fixture name to fail the cleanup lane guard'
  fi
  echo "$guard_output" | grep -Fq 'a-canary-fixture-name-far-too-long-for-any-cleanup-lane' ||
    fail "expected the offending fixture name in the guard failure, got: $guard_output"
  echo "$guard_output" | grep -Fq 'does not match' ||
    fail "expected the guard failure to explain the LANE mismatch, got: $guard_output"

  if ! guard_output="$(
        eval "$guard_funcs"
        ROOT_DIR="$ROOT_DIR"
        validate_cleanup_lane 'optional-owned-source' 2>&1
      )"; then
    fail "expected the renamed #1057 canary fixture to pass the cleanup lane guard, got: $guard_output"
  fi

  echo "extended upgrade fixture helper checks passed"
}

main "$@"
