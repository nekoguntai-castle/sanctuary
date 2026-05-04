#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CREATE_SCRIPT="$ROOT_DIR/scripts/ci/create-isolated-workspace.sh"
RUN_SCRIPT="$ROOT_DIR/scripts/ci/run-in-isolated-workspace.sh"
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

assert_fails_with() {
  local expected="$1"
  shift

  local output_file="$TEST_TEMP_DIR/output"
  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi

  grep -Fq "$expected" "$output_file" || fail "expected output to contain: ${expected}"
}

make_source_repo() {
  local repo="$TEST_TEMP_DIR/source"
  mkdir -p "$repo"
  git -C "$repo" init --quiet
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name 'Test User'
  printf 'tracked\n' >"$repo/tracked.txt"
  printf '.tmp/\n' >"$repo/.gitignore"
  git -C "$repo" add tracked.txt .gitignore
  git -C "$repo" commit --quiet -m 'initial'
  printf 'dirty\n' >"$repo/dirty.txt"
  printf '%s\n' "$repo"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$CREATE_SCRIPT"
  bash -n "$RUN_SCRIPT"

  assert_fails_with 'expected exactly one workspace label' bash "$CREATE_SCRIPT"
  assert_fails_with 'label may contain only' bash "$CREATE_SCRIPT" '../bad'
  assert_fails_with 'expected a workspace label and command' bash "$RUN_SCRIPT"

  local source_repo
  source_repo="$(make_source_repo)"
  local workspace_parent="$TEST_TEMP_DIR/workspaces"
  local marker="$TEST_TEMP_DIR/marker"

  SANCTUARY_CI_SOURCE_WORKSPACE="$source_repo" \
    SANCTUARY_CI_WORKSPACE_PARENT="$workspace_parent" \
    GITHUB_WORKSPACE="$source_repo" \
    bash "$RUN_SCRIPT" unit bash -c "
      test \"\$(cat tracked.txt)\" = tracked
      test ! -e dirty.txt
      test \"\$GITHUB_WORKSPACE\" = \"\$PWD\"
      test \"\$SANCTUARY_CI_ORIGINAL_WORKSPACE\" = '$source_repo'
      printf ok > '$marker'
    "

  [ "$(cat "$marker")" = 'ok' ] || fail 'expected isolated command to run'
  [ -z "$(find "$workspace_parent" -mindepth 1 -maxdepth 1 -print -quit)" ] || \
    fail 'expected successful isolated workspace to be cleaned'

  local docker_workspace="$TEST_TEMP_DIR/docker-workspace"
  mkdir -p "$docker_workspace"
  local docker_clone
  docker_clone="$(
    SANCTUARY_CI_SOURCE_WORKSPACE="$source_repo" \
      GITHUB_WORKSPACE="$docker_workspace" \
      bash "$CREATE_SCRIPT" --docker-visible docker
  )"
  case "$docker_clone" in
    "$docker_workspace"/.tmp/ci-workspaces/*/docker.*/repo)
      ;;
    *)
      fail 'expected docker-visible clone under workspace .tmp'
      ;;
  esac

  if SANCTUARY_CI_SOURCE_WORKSPACE="$source_repo" \
    SANCTUARY_CI_WORKSPACE_PARENT="$workspace_parent" \
    bash "$RUN_SCRIPT" failcase bash -c 'exit 42'; then
    fail 'expected isolated command failure to propagate'
  else
    status="$?"
    [ "$status" -eq 42 ] || fail "expected status 42, got ${status}"
  fi

  echo 'isolated workspace regression checks passed'
}

main "$@"
