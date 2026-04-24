#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLASSIFIER_SCRIPT="$ROOT_DIR/scripts/ci/classify-codeql-languages.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_exact_output() {
  local output_file="$1"
  local key="$2"
  local expected="$3"
  local actual

  actual="$(sed -n "s/^${key}=//p" "$output_file")"
  [ "$actual" = "$expected" ] || fail "expected ${key}=${expected}, got ${key}=${actual}"
}

create_repo() {
  local repo_dir="$1"

  git init -q "$repo_dir"
  git -C "$repo_dir" config user.name "Codex Test"
  git -C "$repo_dir" config user.email "codex@example.com"
  printf '# Fixture\n' > "$repo_dir/README.md"
  git -C "$repo_dir" add README.md
  git -C "$repo_dir" commit -qm "base"
}

run_classifier() {
  local repo_dir="$1"
  local base_sha="$2"
  local head_sha="$3"
  local output_file="$4"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=push
    export GITHUB_OUTPUT="$output_file"
    export PUSH_BEFORE_SHA="$base_sha"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
}

commit_file() {
  local repo_dir="$1"
  local path="$2"
  local content="$3"
  local message="$4"

  mkdir -p "$(dirname "$repo_dir/$path")"
  printf '%s\n' "$content" > "$repo_dir/$path"
  git -C "$repo_dir" add "$path"
  git -C "$repo_dir" commit -qm "$message"
}

assert_only_language() {
  local output_file="$1"
  local actions="$2"
  local javascript_typescript="$3"
  local go="$4"
  local python="$5"

  assert_exact_output "$output_file" "actions_changed" "$actions"
  assert_exact_output "$output_file" "javascript_typescript_changed" "$javascript_typescript"
  assert_exact_output "$output_file" "go_changed" "$go"
  assert_exact_output "$output_file" "python_changed" "$python"
}

main() {
  local temp_dir repo_dir output_file base_sha head_sha

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  repo_dir="$temp_dir/repo"
  output_file="$temp_dir/output"

  create_repo "$repo_dir"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  commit_file "$repo_dir" ".github/workflows/test.yml" "name: Test" "workflow"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_only_language "$output_file" "true" "false" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "server/src/api/auth.ts" "export const auth = true;" "typescript"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_only_language "$output_file" "false" "true" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/verify-addresses/implementations/go-verify.go" "package main" "go"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_only_language "$output_file" "false" "false" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/verify-addresses/implementations/python-verify.py" "print('ok')" "python"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_only_language "$output_file" "false" "false" "false" "true"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=workflow_dispatch
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_only_language "$output_file" "true" "true" "true" "true"

  echo "classify-codeql-languages regression checks passed"
}

main "$@"
