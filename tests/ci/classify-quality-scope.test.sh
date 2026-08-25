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

assert_quality_scope() {
  local output_file="$1"
  local repo="$2"
  local source="$3"
  local dependency="$4"
  local workflow="$5"
  local classifier="$6"

  assert_exact_output "$output_file" "run_repo_quality" "$repo"
  assert_exact_output "$output_file" "run_source_quality" "$source"
  assert_exact_output "$output_file" "run_dependency_audit" "$dependency"
  assert_exact_output "$output_file" "run_workflow_quality" "$workflow"
  assert_exact_output "$output_file" "run_ci_classifier_tests" "$classifier"
}

create_repo() {
  local repo_dir="$1"

  git init -q "$repo_dir"
  git -C "$repo_dir" config user.name "Codex Test"
  git -C "$repo_dir" config user.email "codex@example.com"
  # The fixture creates enough commits to trip runner-specific auto-maintenance
  # thresholds. Keep cleanup deterministic by preventing detached Git writers
  # from racing the EXIT trap inside .git/objects.
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

classify_commit() {
  local repo_dir="$1"
  local base_sha="$2"
  local output_file="$3"
  local path="$4"
  local content="$5"
  local message="$6"
  local repo="$7"
  local source="$8"
  local dependency="$9"
  local workflow="${10}"
  local classifier="${11}"
  local head_sha

  commit_file "$repo_dir" "$path" "$content" "$message"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" "$repo" "$source" "$dependency" "$workflow" "$classifier"
  printf '%s\n' "$head_sha"
}

main() {
  local temp_dir repo_dir output_file base_sha head_sha entry path expected_source expected_dependency expected_classifier

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  repo_dir="$temp_dir/repo"
  output_file="$temp_dir/output"

  create_repo "$repo_dir"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "schedule"
  assert_quality_scope "$output_file" true true true true true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "workflow_dispatch"
  assert_quality_scope "$output_file" true true true true true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "repository_dispatch"
  assert_quality_scope "$output_file" true true true true true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "push" false
  assert_quality_scope "$output_file" true true true true true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "pull_request" false
  assert_quality_scope "$output_file" true true true true true

  mkdir -p "$repo_dir/docs/images"
  printf '# Docs only\n' > "$repo_dir/README.md"
  printf 'fakepng' > "$repo_dir/docs/images/logo.png"
  git -C "$repo_dir" add README.md docs/images/logo.png
  git -C "$repo_dir" commit -qm "docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" false false false false false

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    .github/workflows/example.yml 'name: Example' 'workflow change' \
    false false false true false)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "merge_group"
  assert_quality_scope "$output_file" false false false true false

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    .github/workflows/verify-vectors.yml 'name: Verify Bitcoin Vectors' 'vector workflow change' \
    false false false true true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    .github/workflows/quality.yml 'name: Code Quality' 'quality workflow change' \
    false true true true true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    scripts/ci/classify-quality-scope.sh 'echo classifier' 'ci classifier change' \
    true true true false true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    config/hardware-emulator-source-inventory.json '{"schemaVersion":1}' \
    'hardware emulator source inventory change' true false false false true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    server/src/example.ts 'export const example = 1;' 'code change' \
    true true false false false)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    package-lock.json '{"lockfileVersion": 3}' 'lockfile change' \
    true true true false false)"

  base_sha="$head_sha"
  commit_file "$repo_dir" src/mixed.ts 'export const mixed = true;' 'mixed source'
  printf '{"name":"fixture","version":"1.0.0"}\n' > "$repo_dir/package.json"
  git -C "$repo_dir" add package.json
  git -C "$repo_dir" commit --amend -qm 'mixed source and manifest'
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" true true true false false

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    fixtures/archive.bin binary 'binary fixture' true false false false false)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    .gitignore '*.generated.ts' 'root gitignore change' \
    true true false false false)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    server/.gitignore 'generated/' 'nested gitignore change' \
    true true false false false)"

  for entry in \
    'scripts/ci/run-quality-lint.sh|true|false' \
    'scripts/quality.sh|true|false' \
    'scripts/quality/lizard-only.sh|true|false' \
    'scripts/quality/jscpd-only.sh|true|false' \
    'scripts/quality/lizard-requirements.txt|true|false' \
    'config/tooling/jscpd.json|true|false' \
    'scripts/quality/check-lockfile-peer-resolution.sh|false|true' \
    'scripts/quality/lockfile-peer-resolution-allowlist.txt|false|true' \
    'scripts/ci/npm-policy.json|false|true'; do
    IFS='|' read -r path expected_source expected_dependency <<< "$entry"
    expected_classifier=false
    case "$path" in
      scripts/ci/*) expected_classifier=true ;;
    esac
    base_sha="$head_sha"
    head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
      "$path" tool "classify $path" true "$expected_source" "$expected_dependency" false \
      "$expected_classifier")"
  done

  base_sha="$head_sha"
  commit_file "$repo_dir" src/renamed.ts 'export const renamed = true;' 'add source before rename'
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  mkdir -p "$repo_dir/docs"
  git -C "$repo_dir" mv src/renamed.ts docs/renamed.md
  git -C "$repo_dir" commit -qm "rename source to docs"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" true true false false false

  base_sha="$head_sha"
  commit_file "$repo_dir" nested/package-lock.json '{"lockfileVersion":3}' 'add nested lockfile'
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  git -C "$repo_dir" rm -q nested/package-lock.json
  git -C "$repo_dir" commit -qm 'delete nested lockfile'
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" true true true false false

  echo "classify-quality-scope regression checks passed"
}

main "$@"
