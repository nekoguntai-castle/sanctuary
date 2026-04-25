#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GROUP_SCRIPT="$ROOT_DIR/scripts/ci/browser-e2e-groups.sh"
TEST_TEMP_DIR=''

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"

  if grep -Fxq "$unexpected" "$file"; then
    fail "expected ${file} not to contain ${unexpected}"
  fi
}

main() {
  local groups_file specs_file repo_count assigned_count

  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  "$GROUP_SCRIPT" --check
  "$GROUP_SCRIPT" --groups > "$TEST_TEMP_DIR/groups"

  grep -Fxq 'admin-auth' "$TEST_TEMP_DIR/groups" || fail 'missing admin-auth group'
  grep -Fxq 'wallet-flows' "$TEST_TEMP_DIR/groups" || fail 'missing wallet-flows group'
  grep -Fxq 'wallet-experience' "$TEST_TEMP_DIR/groups" || fail 'missing wallet-experience group'

  groups_file="$TEST_TEMP_DIR/groups"
  specs_file="$TEST_TEMP_DIR/specs"
  while IFS= read -r group; do
    "$GROUP_SCRIPT" "$group"
  done < "$groups_file" | sort > "$specs_file"

  assert_not_contains "$specs_file" 'e2e/render-regression.spec.ts'

  repo_count="$(find "$ROOT_DIR/e2e" -maxdepth 1 -name '*.spec.ts' ! -name 'render-regression.spec.ts' | wc -l | tr -d ' ')"
  assigned_count="$(wc -l < "$specs_file" | tr -d ' ')"
  [ "$repo_count" = "$assigned_count" ] || fail "expected ${repo_count} assigned browser specs, got ${assigned_count}"

  if "$GROUP_SCRIPT" unknown-group >/dev/null 2>&1; then
    fail 'unknown group should fail'
  fi

  echo 'browser E2E group regression checks passed'
}

main "$@"
