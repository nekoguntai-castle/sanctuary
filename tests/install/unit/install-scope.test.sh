#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLASSIFIER_SCRIPT="$ROOT_DIR/tests/install/utils/classify-install-scope.sh"

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

assert_scope() {
  local output_file="$1"
  local should_run="$2"
  local run_unit="$3"
  local run_fresh_install="$4"
  local run_install_script="$5"
  local run_container_health="$6"
  local run_auth_flow="$7"
  local run_upgrade="$8"
  local run_reuse_stack="$9"

  assert_exact_output "$output_file" "should_run" "$should_run"
  assert_exact_output "$output_file" "run_unit" "$run_unit"
  assert_exact_output "$output_file" "run_fresh_install" "$run_fresh_install"
  assert_exact_output "$output_file" "run_install_script" "$run_install_script"
  assert_exact_output "$output_file" "run_container_health" "$run_container_health"
  assert_exact_output "$output_file" "run_auth_flow" "$run_auth_flow"
  assert_exact_output "$output_file" "run_upgrade" "$run_upgrade"
  assert_exact_output "$output_file" "run_reuse_stack" "$run_reuse_stack"
}

main() {
  local temp_dir repo_dir output_file base_sha head_sha

  unset GITHUB_REF GITHUB_EVENT_NAME GITHUB_SHA \
    WORKFLOW_INPUT_TEST_SUITE PR_BASE_SHA PR_HEAD_SHA

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  repo_dir="$temp_dir/repo"
  output_file="$temp_dir/output"

  create_repo "$repo_dir"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  commit_file "$repo_dir" "docs/install.md" "# docs" "irrelevant docs"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "false" "false" "false" "false" "false" "false" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "tests/install/unit/install-script.test.sh" "echo unit" "unit"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "install.sh" "#!/usr/bin/env bash" "installer"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "false" "true" "false" "false" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docker-compose.yml" "services: {}" "compose"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "true" "false" "true" "false" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "tests/install/e2e/auth-flow.test.sh" "echo auth" "auth"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "true" "false" "false" "true" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "server/prisma/schema.prisma" "datasource db {}" "migration"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "true" "false"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=workflow_dispatch
    export WORKFLOW_INPUT_TEST_SUITE=all
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_scope "$output_file" "true" "true" "true" "true" "true" "true" "true" "true"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=push
    export GITHUB_REF=refs/tags/v0.9.0
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_exact_output "$output_file" "is_release" "true"
  assert_exact_output "$output_file" "test_suite" "release-critical"
  assert_scope "$output_file" "true" "true" "true" "true" "true" "true" "true" "true"

  echo "install scope classifier regression checks passed"
}

main "$@"
