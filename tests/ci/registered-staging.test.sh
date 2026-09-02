#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
COORDINATOR="$ROOT/scripts/ci/cleanup-ci-callsite.sh"
CREATE="$ROOT/scripts/ci/create-registered-staging.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() { printf 'registered staging test: %s\n' "$*" >&2; exit 1; }

marker="$TEST_ROOT/path"
mkdir -m 700 "$TEST_ROOT/provider-temp"
SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1 \
SANCTUARY_LOCAL_CLEANUP_RUN_ID=registered-staging-test \
SANCTUARY_CI_TEMP_DIR_OVERRIDE="$TEST_ROOT/provider-temp" \
bash "$COORDINATOR" run --engine host --lane registered-staging-test \
  --runtime "$TEST_ROOT/provider-temp/runtime" --artifact-dir "$TEST_ROOT/artifacts" \
  --checkout-root "$ROOT" -- \
  bash -euo pipefail -c '
    artifact=$($1 fixture)
    second=$($1 second)
    printf "%s\n%s\n" "$artifact" "$second" > "$2"
    printf owned > "$artifact/payload"
    printf owned > "$second/payload"
  ' _ "$CREATE" "$marker"

mapfile -t artifacts < "$marker"
artifact=${artifacts[0]}
second=${artifacts[1]}
[[ $artifact == "$TEST_ROOT/provider-temp/runtime/subject-staging/fixture."* ]] \
  || fail 'registered staging escaped the coordinated runtime'
[[ $second == "$TEST_ROOT/provider-temp/runtime/subject-staging/second."* ]] \
  || fail 'second staging directory escaped the registered ancestor'
[[ ! -e $artifact ]] || fail 'native coordinator did not remove the registered artifact'
[[ ! -e $second ]] || fail 'native coordinator did not remove the second artifact'
find "$TEST_ROOT/provider-temp/runtime/ownership/cleanup-executions" \
  -name 'cleanup-receipt.json' -type f -print -quit | grep -q . \
  || fail 'coordinator did not emit final private evidence'

mkdir -m 700 "$TEST_ROOT/provider-failure"
if SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1 \
    SANCTUARY_LOCAL_CLEANUP_RUN_ID=registered-staging-failure-test \
    SANCTUARY_CI_TEMP_DIR_OVERRIDE="$TEST_ROOT/provider-failure" \
    SANCTUARY_TEST_FAIL_AFTER_STAGING_REGISTRATION=1 \
    bash "$COORDINATOR" run --engine host --lane registered-staging-failure-test \
      --runtime "$TEST_ROOT/provider-failure/runtime" \
      --artifact-dir "$TEST_ROOT/failure-artifacts" \
      --checkout-root "$ROOT" -- bash "$CREATE" injected >/dev/null 2>&1; then
  fail 'injected post-registration subject failure unexpectedly succeeded'
fi
[[ ! -e $TEST_ROOT/provider-failure/runtime/subject-staging ]] \
  || fail 'registered staging ancestor survived a post-registration failure'
jq -e '.state == "cleaned" and .resourceCounts.cleaned == 1' \
  "$TEST_ROOT/failure-artifacts/final-upload.json" >/dev/null \
  || fail 'post-registration failure did not retain exact cleanup evidence'

if bash "$CREATE" uncoordinated >/dev/null 2>&1; then
  fail 'uncoordinated staging creation was accepted'
fi

printf 'registered staging tests passed\n'
