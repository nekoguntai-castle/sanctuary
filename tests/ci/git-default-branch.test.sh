#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

shopt -s nullglob
workflows=(
  "$REPO_ROOT"/.github/workflows/*.yml
  "$REPO_ROOT"/.github/workflows/*.yaml
)
[ "${#workflows[@]}" -gt 0 ] || fail "no workflow files found"

for file in "${workflows[@]}"; do
  workflow="${file##*/}"
  [ "$(grep -Fxc "  GIT_CONFIG_COUNT: '1'" "$file")" -eq 1 ] \
    || fail "$workflow must set GIT_CONFIG_COUNT once"
  [ "$(grep -Fxc '  GIT_CONFIG_KEY_0: init.defaultBranch' "$file")" -eq 1 ] \
    || fail "$workflow must set init.defaultBranch once"
  [ "$(grep -Fxc '  GIT_CONFIG_VALUE_0: main' "$file")" -eq 1 ] \
    || fail "$workflow must set the initial branch to main once"
done

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
init_output="$(
  GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=init.defaultBranch \
    GIT_CONFIG_VALUE_0=main \
    git -C "$tmp_dir" init 2>&1
)"

branch="$(git -C "$tmp_dir" symbolic-ref --short HEAD)"
[ "$branch" = main ] || fail "git init selected $branch instead of main"
if printf '%s\n' "$init_output" | grep -Fq 'Using'; then
  fail "git init emitted the default-branch hint"
fi

printf 'PASS: workflow Git initial branch contract\n'
