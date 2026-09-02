#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/collect-playwright-artifacts.sh"
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

assert_exists() {
  [ -e "$1" ] || fail "expected path to exist: $1"
}

assert_not_exists() {
  [ ! -e "$1" ] || fail "expected path to be absent: $1"
}

assert_fails_with() {
  local expected="$1"
  shift

  local output_file="$TEST_TEMP_DIR/output"
  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi

  grep -Fq "$expected" "$output_file" || fail "expected output to contain: ${expected}"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$SCRIPT"

  local original_workspace="$TEST_TEMP_DIR/original"
  local isolated_workspace="$TEST_TEMP_DIR/isolated"
  mkdir -p "$original_workspace" "$isolated_workspace/playwright-report" "$isolated_workspace/test-results/case"
  printf 'report\n' >"$isolated_workspace/playwright-report/index.html"
  printf 'trace\n' >"$isolated_workspace/test-results/case/trace.zip"
  printf '{"ok":true}\n' >"$isolated_workspace/playwright-timing.json"
  printf '# timing\n' >"$isolated_workspace/playwright-timing.md"

  (
    cd "$isolated_workspace"
    SANCTUARY_CI_ORIGINAL_WORKSPACE="$original_workspace" bash "$SCRIPT" quick-browser run-123
  )

  local artifact_root="$original_workspace/.tmp/quick-browser-artifacts/run-123"
  assert_exists "$artifact_root/playwright-report/index.html"
  assert_exists "$artifact_root/test-results/case/trace.zip"
  assert_exists "$artifact_root/playwright-timing.json"
  assert_exists "$artifact_root/playwright-timing.md"

  assert_fails_with 'artifact destination already exists' env \
    SANCTUARY_CI_ORIGINAL_WORKSPACE="$original_workspace" \
    bash -c 'cd "$1" && bash "$2" quick-browser run-123' _ "$isolated_workspace" "$SCRIPT"

  assert_fails_with 'label may only contain' bash "$SCRIPT" '../bad'
  assert_fails_with 'run id may only contain' bash "$SCRIPT" quick-browser '../bad'

  echo 'collect-playwright-artifacts regression checks passed'
}

main "$@"
