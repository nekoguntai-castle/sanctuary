#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLASSIFIER_SCRIPT="$ROOT_DIR/scripts/ci/classify-test-changes.sh"

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

assert_contains_output() {
  local output_file="$1"
  local key="$2"
  local expected_substring="$3"
  local actual

  actual="$(sed -n "s/^${key}=//p" "$output_file")"
  case "$actual" in
    *"$expected_substring"*) ;;
    *) fail "expected ${key} to contain ${expected_substring}, got ${actual}" ;;
  esac
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
    export EVENT_NAME=push
    export GITHUB_OUTPUT="$output_file"
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

  mkdir -p "$repo_dir/tests/install"
  cat <<'EOF_DOC' > "$repo_dir/tests/install/README.md"
# Install Tests
EOF_DOC
  git -C "$repo_dir" add tests/install/README.md
  git -C "$repo_dir" commit -qm "docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "false"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/scripts/ci"
  printf '#!/usr/bin/env bash\necho classifier\n' > "$repo_dir/scripts/ci/classify-quality-scope.sh"
  git -C "$repo_dir" add scripts/ci/classify-quality-scope.sh
  git -C "$repo_dir" commit -qm "ci classifier script"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "false"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  printf '#!/usr/bin/env bash\necho shard\n' > "$repo_dir/scripts/ci/frontend-coverage-shard.sh"
  git -C "$repo_dir" add scripts/ci/frontend-coverage-shard.sh
  git -C "$repo_dir" commit -qm "frontend coverage shard script"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "false"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  printf 'export default {};\n' > "$repo_dir/vitest.coverage-shard.config.ts"
  git -C "$repo_dir" add vitest.coverage-shard.config.ts
  git -C "$repo_dir" commit -qm "frontend coverage shard config"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_contains_output "$output_file" "frontend_files" "vitest.coverage-shard.config.ts"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/.github/workflows"
  printf 'name: Test Suite\non: pull_request\njobs: {}\n' > "$repo_dir/.github/workflows/test.yml"
  git -C "$repo_dir" add .github/workflows/test.yml
  git -C "$repo_dir" commit -qm "test workflow"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_exact_output "$output_file" "build_changed" "true"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/tests/components"
  printf 'export const example = 1;\n' > "$repo_dir/tests/components/example.test.tsx"
  git -C "$repo_dir" add tests/components/example.test.tsx
  git -C "$repo_dir" commit -qm "frontend test"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_contains_output "$output_file" "frontend_files" "tests/components/example.test.tsx"
  assert_contains_output "$output_file" "test_files" "tests/components/example.test.tsx"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/services/hardwareWallet"
  printf 'export const helper = true;\n' > "$repo_dir/services/hardwareWallet/service.ts"
  git -C "$repo_dir" add services/hardwareWallet/service.ts
  git -C "$repo_dir" commit -qm "frontend service helper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/src/api"
  printf 'export const login = true;\n' > "$repo_dir/src/api/auth.ts"
  git -C "$repo_dir" add src/api/auth.ts
  git -C "$repo_dir" commit -qm "auth api client"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/components/Dashboard"
  printf 'export const Dashboard = () => null;\n' > "$repo_dir/components/Dashboard/Dashboard.tsx"
  git -C "$repo_dir" add components/Dashboard/Dashboard.tsx
  git -C "$repo_dir" commit -qm "visual component"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  printf 'export default {};\n' > "$repo_dir/vite.config.ts"
  git -C "$repo_dir" add vite.config.ts
  git -C "$repo_dir" commit -qm "build config"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "true"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/e2e/render-regression"
  printf 'export const fixture = true;\n' > "$repo_dir/e2e/render-regression/renderRegressionHarness.ts"
  git -C "$repo_dir" add e2e/render-regression/renderRegressionHarness.ts
  git -C "$repo_dir" commit -qm "render e2e"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "e2e_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/e2e/fixtures"
  printf 'export const browserFixture = true;\n' > "$repo_dir/e2e/fixtures/browserFixture.ts"
  git -C "$repo_dir" add e2e/fixtures/browserFixture.ts
  git -C "$repo_dir" commit -qm "browser e2e fixture"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "e2e_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  echo "classify-test-changes regression checks passed"
}

main "$@"
