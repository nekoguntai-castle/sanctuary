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
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "ai_proxy_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/server/src/services"
  printf '# Server Notes\n' > "$repo_dir/server/src/services/DEPENDENCIES.md"
  git -C "$repo_dir" add server/src/services/DEPENDENCIES.md
  git -C "$repo_dir" commit -qm "server docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "false"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "ai_proxy_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/gateway"
  printf '# Gateway Notes\n' > "$repo_dir/gateway/README.md"
  git -C "$repo_dir" add gateway/README.md
  git -C "$repo_dir" commit -qm "gateway docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "false"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "ai_proxy_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/ai-proxy"
  printf '# AI Proxy Notes\n' > "$repo_dir/ai-proxy/README.md"
  git -C "$repo_dir" add ai-proxy/README.md
  git -C "$repo_dir" commit -qm "ai proxy docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "false"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "ai_proxy_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/ai-proxy/src"
  printf 'export const schema = true;\n' > "$repo_dir/ai-proxy/src/requestSchemas.ts"
  git -C "$repo_dir" add ai-proxy/src/requestSchemas.ts
  git -C "$repo_dir" commit -qm "ai proxy source"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "ai_proxy_changed" "true"
  assert_contains_output "$output_file" "ai_proxy_files" "ai-proxy/src/requestSchemas.ts"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/tests/ai-proxy"
  printf 'import { schema } from "../../ai-proxy/src/requestSchemas"; test("schema", () => schema);\n' > "$repo_dir/tests/ai-proxy/requestSchemas.test.ts"
  git -C "$repo_dir" add tests/ai-proxy/requestSchemas.test.ts
  git -C "$repo_dir" commit -qm "ai proxy test"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "ai_proxy_changed" "true"
  assert_contains_output "$output_file" "ai_proxy_files" "tests/ai-proxy/requestSchemas.test.ts"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_contains_output "$output_file" "test_files" "tests/ai-proxy/requestSchemas.test.ts"

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
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  printf '#!/usr/bin/env bash\necho integration groups\n' > "$repo_dir/scripts/ci/backend-integration-groups.sh"
  git -C "$repo_dir" add scripts/ci/backend-integration-groups.sh
  git -C "$repo_dir" commit -qm "backend integration groups script"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "true"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_exact_output "$output_file" "build_changed" "true"

  base_sha="$head_sha"
  printf '#!/usr/bin/env bash\necho browser groups\n' > "$repo_dir/scripts/ci/browser-e2e-groups.sh"
  git -C "$repo_dir" add scripts/ci/browser-e2e-groups.sh
  git -C "$repo_dir" commit -qm "browser e2e groups script"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "true"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_exact_output "$output_file" "build_changed" "true"

  base_sha="$head_sha"
  printf '#!/usr/bin/env bash\necho shard\n' > "$repo_dir/scripts/ci/frontend-coverage-shard.sh"
  git -C "$repo_dir" add scripts/ci/frontend-coverage-shard.sh
  git -C "$repo_dir" commit -qm "frontend coverage shard script"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "false"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
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
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "e2e_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  printf 'export default {};\n' > "$repo_dir/playwright.config.ts"
  git -C "$repo_dir" add playwright.config.ts
  git -C "$repo_dir" commit -qm "playwright config"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "e2e_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/e2e/fixtures"
  printf 'export const browserFixture = true;\n' > "$repo_dir/e2e/fixtures/browserFixture.ts"
  git -C "$repo_dir" add e2e/fixtures/browserFixture.ts
  git -C "$repo_dir" commit -qm "browser e2e fixture"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "e2e_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/server/src/services/notifications"
  printf 'export const normalize = true;\n' > "$repo_dir/server/src/services/notifications/normalizeNotification.ts"
  git -C "$repo_dir" add server/src/services/notifications/normalizeNotification.ts
  git -C "$repo_dir" commit -qm "backend unit scoped helper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "backend_changed" "true"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_contains_output "$output_file" "backend_files" "server/src/services/notifications/normalizeNotification.ts"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/server/src/api/wallets"
  printf 'export const route = true;\n' > "$repo_dir/server/src/api/wallets/settings.ts"
  git -C "$repo_dir" add server/src/api/wallets/settings.ts
  git -C "$repo_dir" commit -qm "backend api route"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "backend_changed" "true"
  assert_exact_output "$output_file" "backend_integration_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/server/prisma/migrations/20260425000000_example"
  printf 'SELECT 1;\n' > "$repo_dir/server/prisma/migrations/20260425000000_example/migration.sql"
  git -C "$repo_dir" add server/prisma/migrations/20260425000000_example/migration.sql
  git -C "$repo_dir" commit -qm "backend migration"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "backend_changed" "true"
  assert_exact_output "$output_file" "backend_integration_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "build_changed" "true"

  echo "classify-test-changes regression checks passed"
}

main "$@"
