#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLASSIFIER_SCRIPT="$ROOT_DIR/scripts/ci/classify-verify-vectors-scope.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_exact_output() {
  local output_file="$1"
  local expected="$2"
  local actual

  actual="$(sed -n 's/^run_verify_vectors=//p' "$output_file")"
  [ "$actual" = "$expected" ] || fail "expected run_verify_vectors=${expected}, got run_verify_vectors=${actual}"
}

create_repo() {
  local repo_dir="$1"

  git init -q "$repo_dir"
  git -C "$repo_dir" config user.name "Codex Test"
  git -C "$repo_dir" config user.email "codex@example.com"
  git -C "$repo_dir" config gc.auto 0
  git -C "$repo_dir" config gc.autoDetach false
  git -C "$repo_dir" config maintenance.auto false
  git -C "$repo_dir" config maintenance.autoDetach false
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
  local include_base_sha="${6:-true}"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME="$event_name"
    export GITHUB_OUTPUT="$output_file"
    export MERGE_GROUP_BASE_SHA="$base_sha"
    export MERGE_GROUP_HEAD_SHA="$head_sha"
    if [ "$include_base_sha" = true ]; then
      export PUSH_BEFORE_SHA="$base_sha"
      export PR_BASE_SHA="$base_sha"
    else
      unset PUSH_BEFORE_SHA PR_BASE_SHA MERGE_GROUP_BASE_SHA
    fi
    export PR_HEAD_SHA="$head_sha"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
}

commit_file() {
  local repo_dir="$1"
  local path="$2"
  local content="$3"
  local message="$4"

  mkdir -p "$repo_dir/$(dirname "$path")"
  printf '%s\n' "$content" > "$repo_dir/$path"
  git -C "$repo_dir" add "$path"
  git -C "$repo_dir" commit -qm "$message"
}

main() {
  local temp_dir repo_dir output_file base_sha head_sha

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  repo_dir="$temp_dir/repo"
  output_file="$temp_dir/output"

  create_repo "$repo_dir"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  # schedule / workflow_dispatch / merge_group / unknown event: fail closed.
  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "schedule"
  assert_exact_output "$output_file" true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "workflow_dispatch"
  assert_exact_output "$output_file" true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "merge_group"
  assert_exact_output "$output_file" true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "repository_dispatch"
  assert_exact_output "$output_file" true

  # Unresolvable base: fail closed.
  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "push" false
  assert_exact_output "$output_file" true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "pull_request" false
  assert_exact_output "$output_file" true

  # Zero-sha push (first commit on a ref): fail closed.
  (
    cd "$repo_dir"
    export EVENT_NAME="push"
    export GITHUB_OUTPUT="$output_file"
    export PUSH_BEFORE_SHA="0000000000000000000000000000000000000000"
    export WORKFLOW_SHA="$base_sha"
    : > "$output_file"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_exact_output "$output_file" true

  # Empty diff: fail closed.
  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file"
  assert_exact_output "$output_file" true

  # Docs-only push.
  commit_file "$repo_dir" README.md '# Docs only' "docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "push"
  assert_exact_output "$output_file" false

  # Docs-only PR (three-dot semantics collapse to the same result here since
  # base is an ancestor of head).
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "pull_request"
  assert_exact_output "$output_file" false

  base_sha="$head_sha"

  # docs/** and tasks/** also count as docs-only.
  commit_file "$repo_dir" docs/reference/example.md '# Reference' "docs dir change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "push"
  assert_exact_output "$output_file" false
  base_sha="$head_sha"

  commit_file "$repo_dir" tasks/plan.md '# Plan' "tasks dir change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "push"
  assert_exact_output "$output_file" false
  base_sha="$head_sha"

  # Mixed docs+code: run.
  mkdir -p "$repo_dir/docs" "$repo_dir/server/src"
  printf '# more docs\n' > "$repo_dir/docs/more.md"
  printf 'export const x = 1;\n' > "$repo_dir/server/src/example.ts"
  git -C "$repo_dir" add docs/more.md server/src/example.ts
  git -C "$repo_dir" commit -qm "mixed docs and code"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "push"
  assert_exact_output "$output_file" true
  base_sha="$head_sha"

  # Single .ts change: run.
  commit_file "$repo_dir" server/src/other.ts 'export const y = 2;' "ts only change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "push"
  assert_exact_output "$output_file" true
  base_sha="$head_sha"

  # Wallet-safety critical-paths manifest change: run.
  commit_file "$repo_dir" config/wallet-safety-critical-paths.json '{"schemaVersion":1}' "manifest change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "push"
  assert_exact_output "$output_file" true
  base_sha="$head_sha"

  # verify-vectors.yml itself: run.
  commit_file "$repo_dir" .github/workflows/verify-vectors.yml 'name: Verify Bitcoin Vectors' "workflow change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "push"
  assert_exact_output "$output_file" true
  base_sha="$head_sha"

  # The classifier script itself: run.
  commit_file "$repo_dir" scripts/ci/classify-verify-vectors-scope.sh 'echo classifier' "classifier change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "push"
  assert_exact_output "$output_file" true
  base_sha="$head_sha"

  # scripts/verify-psbt/**: run.
  commit_file "$repo_dir" scripts/verify-psbt/index.mjs 'export {};' "verify-psbt change"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "push"
  assert_exact_output "$output_file" true
  base_sha="$head_sha"

  echo "classify-verify-vectors-scope regression checks passed"
}

main "$@"
