#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GROUP_SCRIPT="$ROOT_DIR/scripts/ci/backend-integration-groups.sh"
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

assert_contains() {
  local file="$1"
  local expected="$2"

  grep -Fxq "$expected" "$file" || fail "expected ${file} to contain ${expected}"
}

main() {
  local groups_file specs_file repo_specs_file repo_count assigned_count

  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  "$GROUP_SCRIPT" --check
  "$GROUP_SCRIPT" --groups > "$TEST_TEMP_DIR/groups"

  assert_contains "$TEST_TEMP_DIR/groups" 'flows'
  assert_contains "$TEST_TEMP_DIR/groups" 'repositories-core'
  assert_contains "$TEST_TEMP_DIR/groups" 'repositories-sharing'
  assert_contains "$TEST_TEMP_DIR/groups" 'ops-workers'

  groups_file="$TEST_TEMP_DIR/groups"
  specs_file="$TEST_TEMP_DIR/specs"
  while IFS= read -r group; do
    "$GROUP_SCRIPT" "$group"
  done < "$groups_file" | sort > "$specs_file"

  repo_specs_file="$TEST_TEMP_DIR/repo-specs"
  find "$ROOT_DIR/server/tests/integration" -type f \
    \( -name '*.test.ts' -o -name '*.spec.ts' \) |
    sed "s#^$ROOT_DIR/server/##" |
    sort > "$repo_specs_file"

  repo_count="$(wc -l < "$repo_specs_file" | tr -d ' ')"
  assigned_count="$(wc -l < "$specs_file" | tr -d ' ')"
  [ "$repo_count" = "$assigned_count" ] || fail "expected ${repo_count} assigned integration specs, got ${assigned_count}"

  diff -u "$repo_specs_file" "$specs_file" || fail 'backend integration groups do not match repo specs'

  if "$GROUP_SCRIPT" unknown-group >/dev/null 2>&1; then
    fail 'unknown group should fail'
  fi

  echo 'backend integration group regression checks passed'
}

main "$@"
