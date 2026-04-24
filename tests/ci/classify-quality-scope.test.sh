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
  local event_name="${5:-push}"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME="$event_name"
    export GITHUB_OUTPUT="$output_file"
    export MERGE_GROUP_BASE_SHA="$base_sha"
    export MERGE_GROUP_HEAD_SHA="$head_sha"
    export PUSH_BEFORE_SHA="$base_sha"
    export WORKFLOW_SHA="$head_sha"
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

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "schedule"
  assert_exact_output "$output_file" "run_repo_quality" "true"
  assert_exact_output "$output_file" "run_workflow_quality" "true"
  assert_exact_output "$output_file" "run_ci_classifier_tests" "true"

  mkdir -p "$repo_dir/docs/images"
  printf '# Docs only\n' > "$repo_dir/README.md"
  printf 'fakepng' > "$repo_dir/docs/images/logo.png"
  git -C "$repo_dir" add README.md docs/images/logo.png
  git -C "$repo_dir" commit -qm "docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "run_repo_quality" "false"
  assert_exact_output "$output_file" "run_workflow_quality" "false"
  assert_exact_output "$output_file" "run_ci_classifier_tests" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/.github/workflows"
  printf 'name: Example\non: pull_request\njobs: {}\n' > "$repo_dir/.github/workflows/example.yml"
  git -C "$repo_dir" add .github/workflows/example.yml
  git -C "$repo_dir" commit -qm "workflow change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "run_repo_quality" "false"
  assert_exact_output "$output_file" "run_workflow_quality" "true"
  assert_exact_output "$output_file" "run_ci_classifier_tests" "false"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "merge_group"
  assert_exact_output "$output_file" "run_repo_quality" "false"
  assert_exact_output "$output_file" "run_workflow_quality" "true"
  assert_exact_output "$output_file" "run_ci_classifier_tests" "false"

  base_sha="$head_sha"
  printf 'name: CodeQL\non: pull_request\njobs: {}\n' > "$repo_dir/.github/workflows/codeql.yml"
  git -C "$repo_dir" add .github/workflows/codeql.yml
  git -C "$repo_dir" commit -qm "codeql workflow change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "run_repo_quality" "false"
  assert_exact_output "$output_file" "run_workflow_quality" "true"
  assert_exact_output "$output_file" "run_ci_classifier_tests" "true"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/scripts/ci"
  printf '#!/usr/bin/env bash\necho classifier\n' > "$repo_dir/scripts/ci/classify-quality-scope.sh"
  git -C "$repo_dir" add scripts/ci/classify-quality-scope.sh
  git -C "$repo_dir" commit -qm "ci classifier change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "run_repo_quality" "true"
  assert_exact_output "$output_file" "run_workflow_quality" "false"
  assert_exact_output "$output_file" "run_ci_classifier_tests" "true"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/server/src"
  printf 'export const example = 1;\n' > "$repo_dir/server/src/example.ts"
  git -C "$repo_dir" add server/src/example.ts
  git -C "$repo_dir" commit -qm "code change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "run_repo_quality" "true"
  assert_exact_output "$output_file" "run_workflow_quality" "false"
  assert_exact_output "$output_file" "run_ci_classifier_tests" "false"

  echo "classify-quality-scope regression checks passed"
}

main "$@"
