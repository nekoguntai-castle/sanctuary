#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLASSIFIER_SCRIPT="$ROOT_DIR/scripts/ci/classify-quality-scope.sh"

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
  printf '{ "name": "fixture" }\n' > "$repo_dir/package.json"
  git -C "$repo_dir" add package.json
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
    EVENT_NAME=push \
    PUSH_BEFORE_SHA="$base_sha" \
    WORKFLOW_SHA="$head_sha" \
    GITHUB_OUTPUT="$output_file" \
    bash "$CLASSIFIER_SCRIPT"
  )
}

main() {
  local temp_dir repo_dir output_file base_sha head_sha

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  repo_dir="$temp_dir/repo"
  output_file="$temp_dir/output"

  create_repo "$repo_dir"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  mkdir -p "$repo_dir/docs/images"
  printf '# Docs only\n' > "$repo_dir/README.md"
  printf 'fakepng' > "$repo_dir/docs/images/logo.png"
  git -C "$repo_dir" add README.md docs/images/logo.png
  git -C "$repo_dir" commit -qm "docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "run_repo_quality" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/server/src"
  printf 'export const example = 1;\n' > "$repo_dir/server/src/example.ts"
  git -C "$repo_dir" add server/src/example.ts
  git -C "$repo_dir" commit -qm "code change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "run_repo_quality" "true"

  echo "classify-quality-scope regression checks passed"
}

main "$@"
