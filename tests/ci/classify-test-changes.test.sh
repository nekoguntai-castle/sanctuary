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

assert_not_contains_output() {
  local output_file="$1"
  local key="$2"
  local unexpected_substring="$3"
  local actual

  actual="$(sed -n "s/^${key}=//p" "$output_file")"
  case "$actual" in
    *"$unexpected_substring"*) fail "expected ${key} not to contain ${unexpected_substring}, got ${actual}" ;;
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
  local event_name="${5:-push}"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME="$event_name"
    export GITHUB_OUTPUT="$output_file"
    export PUSH_BEFORE_SHA="$base_sha"
    export PR_BASE_SHA="$base_sha"
    export PR_HEAD_SHA="$head_sha"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
}

# Drift guard: every file that test.yml or a composite action executes, and
# every file those transitively call, source or import, must be classified,
# either as a full-scan trigger or by the dedicated predicate of one of the
# narrower lanes. Adding a helper (or a dependency of one) without classifying
# it fails here.
#
# The walk follows `$SCRIPT_DIR/NAME` / `$script_dir/NAME` (a single path
# segment, never `../`, so `../`-relative inputs such as
# scripts/verify-addresses/implementations/go.mod are not walked: verify-vectors
# has its own provenance pin for those), `scripts/ci/NAME`, relative ESM
# imports, and JSON config reads under .github.
#
# It neither reports nor descends into is_test_lane_excluded_file scripts (a
# narrower lane owns them) or scripts/ownership (quality/architecture own it).
transitive_dependencies() {
  local rel="$1" dir
  dir="$(dirname "$rel")"
  # Each grep may legitimately match nothing, so tolerate exit 1 under set -e.
  {
    { grep -Eo '\$\{?(script_dir|SCRIPT_DIR)\}?/[A-Za-z0-9_.-]+' "$ROOT_DIR/$rel" || true; } \
      | sed -E 's|^.*\}?/||; s|^|'"$dir"'/|'
    grep -Eo 'scripts/ci/[A-Za-z0-9_.-]+' "$ROOT_DIR/$rel" || true
    { grep -Eo "from '\.\.?/[^']+'" "$ROOT_DIR/$rel" || true; } \
      | sed -E "s|^from '||; s|'\$||; s|^|$dir/|"
    grep -Eo '\.github/[A-Za-z0-9_.-]+\.json' "$ROOT_DIR/$rel" || true
  } | while IFS= read -r dep; do
    realpath -m --relative-to="$ROOT_DIR" "$ROOT_DIR/$dep"
  done
}

assert_every_test_workflow_script_is_classified() {
  local path dep
  # shellcheck source=scripts/ci/classify-files-lib.sh
  . "$ROOT_DIR/scripts/ci/classify-files-lib.sh"

  local -a queue=()
  local -A seen=()
  while IFS= read -r path; do
    queue+=("$path")
  done < <(
    {
      # Already-classified lane helpers seed the walk too: some are only reached
      # through other helpers, and their own imports must be classified as well.
      for path in $(cd "$ROOT_DIR" && find scripts/ci -maxdepth 1 -type f | sort); do
        ! is_test_lane_infrastructure_file "$path" || printf '%s\n' "$path"
      done
      grep -ho 'scripts/ci/[A-Za-z0-9_.-]*' "$ROOT_DIR/.github/workflows/test.yml"
      find "$ROOT_DIR/.github/actions" -name action.yml -exec grep -ho 'scripts/ci/[A-Za-z0-9_.-]*' {} +
    } | sort -u
  )

  while [ "${#queue[@]}" -gt 0 ]; do
    path="${queue[0]}"
    queue=("${queue[@]:1}")
    [ -z "${seen[$path]:-}" ] || continue
    seen[$path]=1
    [ -f "$ROOT_DIR/$path" ] || continue
    [[ "$path" != "scripts/ownership/"* ]] || continue
    ! is_test_lane_excluded_file "$path" || continue
    if ! { is_full_scan_trigger_file "$path" || is_frontend_file "$path" || is_test_suite_file "$path" \
      || is_critical_mutation_file "$path" || is_backend_file "$path"; }; then
      fail "test.yml reaches $path but no classifier predicate covers it"
    fi
    while IFS= read -r dep; do
      [ -n "$dep" ] && queue+=("$dep")
    done < <(transitive_dependencies "$path")
  done
}

main() {
  local temp_dir repo_dir output_file base_sha head_sha

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  repo_dir="$temp_dir/repo"
  output_file="$temp_dir/output"

  create_repo "$repo_dir"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  git -C "$repo_dir" update-ref refs/remotes/origin/main "$base_sha"

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
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  local release_base_sha="$base_sha"
  mkdir -p "$repo_dir/tests/release"
  printf 'export const releaseContract = true;\n' > "$repo_dir/tests/release/contract.test.ts"
  git -C "$repo_dir" add tests/release/contract.test.ts
  git -C "$repo_dir" commit -qm "release contract test"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "pull_request"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "frontend_files" ""
  assert_exact_output "$output_file" "full_scan" "false"
  assert_exact_output "$output_file" "test_suite_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/server/.husky"
  printf '#!/bin/sh\n' > "$repo_dir/server/.husky/pre-commit"
  git -C "$repo_dir" add server/.husky/pre-commit
  git -C "$repo_dir" commit -qm "pre-commit hook only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "pull_request"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_files" ""
  assert_exact_output "$output_file" "full_scan" "false"

  mkdir -p "$repo_dir/src/components/ReleaseMixed"
  printf 'export const ReleaseMixed = () => null;\n' > "$repo_dir/src/components/ReleaseMixed/ReleaseMixed.tsx"
  git -C "$repo_dir" add src/components/ReleaseMixed/ReleaseMixed.tsx
  git -C "$repo_dir" commit -qm "mixed release and frontend range"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$release_base_sha" "$head_sha" "$output_file" "pull_request"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_contains_output "$output_file" "frontend_files" "src/components/ReleaseMixed/ReleaseMixed.tsx"
  assert_not_contains_output "$output_file" "frontend_files" "tests/release/contract.test.ts"
  base_sha="$head_sha"

  mkdir -p "$repo_dir/src/components/ForcePush"
  printf 'export const ForcePushed = () => null;\n' > "$repo_dir/src/components/ForcePush/ForcePushed.tsx"
  git -C "$repo_dir" add src/components/ForcePush/ForcePushed.tsx
  git -C "$repo_dir" commit -qm "old pr head"
  local old_pr_head
  old_pr_head="$(git -C "$repo_dir" rev-parse HEAD)"

  git -C "$repo_dir" reset -q --soft "$base_sha"
  printf '# Follow-up\n' > "$repo_dir/tasks.md"
  git -C "$repo_dir" add src/components/ForcePush/ForcePushed.tsx tasks.md
  git -C "$repo_dir" commit -qm "amended pr head"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$old_pr_head" "$head_sha" "$output_file" "pull_request"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_contains_output "$output_file" "frontend_files" "src/components/ForcePush/ForcePushed.tsx"

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
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  # A wallet-safety critical doc (proof input) is never skipped as docs-only.
  base_sha="$head_sha"
  mkdir -p "$repo_dir/docs/adr"
  printf '# ADR\n' > "$repo_dir/docs/adr/0003-jade-plus-authentication-boundary.md"
  git -C "$repo_dir" add docs/adr/0003-jade-plus-authentication-boundary.md
  git -C "$repo_dir" commit -qm "wallet-safety ADR only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "full_scan" "true"

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
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/llm-egress-proxy"
  printf '# LLM Egress Proxy Notes\n' > "$repo_dir/llm-egress-proxy/README.md"
  git -C "$repo_dir" add llm-egress-proxy/README.md
  git -C "$repo_dir" commit -qm "ai proxy docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "false"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/llm-egress-proxy/src"
  printf 'export const schema = true;\n' > "$repo_dir/llm-egress-proxy/src/requestSchemas.ts"
  git -C "$repo_dir" add llm-egress-proxy/src/requestSchemas.ts
  git -C "$repo_dir" commit -qm "ai proxy source"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "true"
  assert_contains_output "$output_file" "llm_egress_proxy_files" "llm-egress-proxy/src/requestSchemas.ts"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_exact_output "$output_file" "test_files" ""

  base_sha="$head_sha"
  mkdir -p "$repo_dir/tests/llm-egress-proxy"
  printf 'import { schema } from "../../llm-egress-proxy/src/requestSchemas"; test("schema", () => schema);\n' > "$repo_dir/tests/llm-egress-proxy/requestSchemas.test.ts"
  git -C "$repo_dir" add tests/llm-egress-proxy/requestSchemas.test.ts
  git -C "$repo_dir" commit -qm "ai proxy test"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "true"
  assert_contains_output "$output_file" "llm_egress_proxy_files" "tests/llm-egress-proxy/requestSchemas.test.ts"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"
  assert_contains_output "$output_file" "test_files" "tests/llm-egress-proxy/requestSchemas.test.ts"

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
  mkdir -p "$repo_dir/server/scripts"
  printf 'export const seedBrowserE2E = true;\n' > "$repo_dir/server/scripts/seed-browser-e2e.ts"
  git -C "$repo_dir" add server/scripts/seed-browser-e2e.ts
  git -C "$repo_dir" commit -qm "browser e2e seeder"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "render_changed" "false"

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
  mkdir -p "$repo_dir/config/tooling"
  printf 'export default {};\n' > "$repo_dir/config/tooling/vitest.coverage-shard.config.ts"
  git -C "$repo_dir" add config/tooling/vitest.coverage-shard.config.ts
  git -C "$repo_dir" commit -qm "frontend coverage shard config"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "full_scan" "true"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_contains_output "$output_file" "frontend_files" "config/tooling/vitest.coverage-shard.config.ts"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "false"
  assert_exact_output "$output_file" "critical_mutation_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/llm-egress-proxy"
  printf 'export default {};\n' > "$repo_dir/llm-egress-proxy/vitest.config.ts"
  git -C "$repo_dir" add llm-egress-proxy/vitest.config.ts
  git -C "$repo_dir" commit -qm "ai proxy vitest config"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "full_scan" "true"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "true"
  assert_exact_output "$output_file" "critical_mutation_changed" "false"
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
  assert_exact_output "$output_file" "full_scan" "true"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "false"
  assert_exact_output "$output_file" "critical_mutation_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/.github/actions/upload-artifact"
  printf 'name: Upload\nruns:\n  using: composite\n  steps: []\n' > "$repo_dir/.github/actions/upload-artifact/action.yml"
  git -C "$repo_dir" add .github/actions/upload-artifact/action.yml
  git -C "$repo_dir" commit -qm "artifact action wrapper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "full_scan" "true"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "gateway_changed" "false"
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "false"
  assert_exact_output "$output_file" "critical_mutation_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  # A nested vendored composite must behave like a top-level one: `*` matches `/`
  # in a bash case pattern, so `.github/actions/*/action.yml` covers both depths.
  base_sha="$head_sha"
  mkdir -p "$repo_dir/.github/actions/vendor/forgejo-artifact-v4/upload"
  printf 'name: Upload\nruns:\n  using: composite\n  steps: []\n' \
    > "$repo_dir/.github/actions/vendor/forgejo-artifact-v4/upload/action.yml"
  git -C "$repo_dir" add .github/actions/vendor/forgejo-artifact-v4/upload/action.yml
  git -C "$repo_dir" commit -qm "vendored artifact action"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "full_scan" "true"

  # Only test.yml shapes the Test Suite lanes; every other workflow owns separate
  # lanes with their own triggers, so editing one must not force a full test scan.
  base_sha="$head_sha"
  printf 'name: Install Tests\non: push\njobs: {}\n' > "$repo_dir/.github/workflows/install-test.yml"
  git -C "$repo_dir" add .github/workflows/install-test.yml
  git -C "$repo_dir" commit -qm "install workflow"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "full_scan" "false"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "backend_changed" "false"
  assert_exact_output "$output_file" "backend_integration_changed" "false"
  assert_exact_output "$output_file" "critical_mutation_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

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
  mkdir -p "$repo_dir/scripts/verify-addresses"
  printf '{}\n' > "$repo_dir/scripts/verify-addresses/package-lock.json"
  git -C "$repo_dir" add scripts/verify-addresses/package-lock.json
  git -C "$repo_dir" commit -qm "verifier dependency lock"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "full_scan" "true"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/scripts/ci"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$repo_dir/scripts/ci/setup-verifier-test-dependencies.sh"
  git -C "$repo_dir" add scripts/ci/setup-verifier-test-dependencies.sh
  git -C "$repo_dir" commit -qm "verifier test dependency setup"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "test_suite_changed" "true"
  assert_exact_output "$output_file" "frontend_changed" "true"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/src/services/hardwareWallet"
  printf 'export const helper = true;\n' > "$repo_dir/src/services/hardwareWallet/service.ts"
  git -C "$repo_dir" add src/services/hardwareWallet/service.ts
  git -C "$repo_dir" commit -qm "frontend service helper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  printf '<script type="module" src="/main.tsx"></script>\n' > "$repo_dir/src/index.html"
  git -C "$repo_dir" add src/index.html
  git -C "$repo_dir" commit -qm "frontend html entry"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "true"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_exact_output "$output_file" "build_changed" "true"

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
  mkdir -p "$repo_dir/src/components/Dashboard"
  printf 'export const Dashboard = () => null;\n' > "$repo_dir/src/components/Dashboard/Dashboard.tsx"
  git -C "$repo_dir" add src/components/Dashboard/Dashboard.tsx
  git -C "$repo_dir" commit -qm "visual component"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "true"
  assert_exact_output "$output_file" "build_changed" "false"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/config/tooling"
  printf 'export default {};\n' > "$repo_dir/config/tooling/vite.config.ts"
  git -C "$repo_dir" add config/tooling/vite.config.ts
  git -C "$repo_dir" commit -qm "build config"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "false"
  assert_exact_output "$output_file" "browser_smoke_changed" "false"
  assert_exact_output "$output_file" "render_changed" "false"
  assert_exact_output "$output_file" "build_changed" "true"

  base_sha="$head_sha"
  mkdir -p "$repo_dir/tests/e2e/render-regression"
  printf 'export const fixture = true;\n' > "$repo_dir/tests/e2e/render-regression/renderRegressionHarness.ts"
  git -C "$repo_dir" add tests/e2e/render-regression/renderRegressionHarness.ts
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
  mkdir -p "$repo_dir/config/tooling"
  printf 'export default {};\n' > "$repo_dir/config/tooling/playwright.config.ts"
  git -C "$repo_dir" add config/tooling/playwright.config.ts
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
  mkdir -p "$repo_dir/tests/e2e/fixtures"
  printf 'export const browserFixture = true;\n' > "$repo_dir/tests/e2e/fixtures/browserFixture.ts"
  git -C "$repo_dir" add tests/e2e/fixtures/browserFixture.ts
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

  base_sha="$head_sha"
  mkdir -p "$repo_dir/src/components/RenameSource"
  printf 'export const RenameSource = () => null;\n' > "$repo_dir/src/components/RenameSource/RenameSource.tsx"
  git -C "$repo_dir" add src/components/RenameSource/RenameSource.tsx
  git -C "$repo_dir" commit -qm "add frontend source before rename"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  mkdir -p "$repo_dir/docs"
  git -C "$repo_dir" mv src/components/RenameSource/RenameSource.tsx docs/RenameSource.md
  git -C "$repo_dir" commit -qm "rename frontend source to docs"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_exact_output "$output_file" "frontend_changed" "true"
  assert_contains_output "$output_file" "frontend_files" "src/components/RenameSource/RenameSource.tsx"

  # Code whose tests run in the frontend lane: the Jade JUnit verifier (vitest
  # suite) and the wallet-sync replay driver (node test in Full Frontend
  # Typechecks). Editing either must run that lane.
  for frontend_tested in scripts/ci/verify-jade-junit.mjs scripts/perf/wallet-sync-high-fanout-replay.mjs; do
    base_sha="$(git -C "$repo_dir" rev-parse HEAD)"
    mkdir -p "$repo_dir/$(dirname "$frontend_tested")"
    printf '// %s\n' "$frontend_tested" > "$repo_dir/$frontend_tested"
    git -C "$repo_dir" add "$frontend_tested"
    git -C "$repo_dir" commit -qm "touch $frontend_tested"
    head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
    run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
    assert_exact_output "$output_file" "frontend_changed" "true"
    assert_contains_output "$output_file" "frontend_files" "$frontend_tested"
  done

  # shared/ is consumed by every workspace through shared/dist, so a shared-only
  # diff must select the backend, gateway, render and build lanes without
  # appending to any related-file list (vitest related would no-op on them).
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  mkdir -p "$repo_dir/shared/schemas"
  printf 'export const walletSchema = {};\n' > "$repo_dir/shared/schemas/wallet.ts"
  git -C "$repo_dir" add shared/schemas/wallet.ts
  git -C "$repo_dir" commit -qm "shared schema only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" pull_request
  for shared_output in backend_changed backend_integration_changed gateway_changed render_changed build_changed frontend_changed shared_changed; do
    assert_exact_output "$output_file" "$shared_output" "true"
  done
  assert_exact_output "$output_file" "llm_egress_proxy_changed" "false"
  assert_exact_output "$output_file" "full_scan" "false"
  assert_exact_output "$output_file" "backend_files" ""
  assert_exact_output "$output_file" "gateway_files" ""

  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  mkdir -p "$repo_dir/server/src/services" "$repo_dir/gateway/src" "$repo_dir/shared/schemas"
  printf 'export const s = 1;\n' > "$repo_dir/server/src/services/sharedMixed.ts"
  printf 'export const g = 1;\n' > "$repo_dir/gateway/src/sharedMixed.ts"
  printf 'export const w = 2;\n' > "$repo_dir/shared/schemas/wallet.ts"
  git -C "$repo_dir" add server/src/services/sharedMixed.ts gateway/src/sharedMixed.ts shared/schemas/wallet.ts
  git -C "$repo_dir" commit -qm "mixed server gateway shared"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" pull_request
  assert_exact_output "$output_file" "shared_changed" "true"
  assert_exact_output "$output_file" "backend_files" "server/src/services/sharedMixed.ts"
  assert_exact_output "$output_file" "gateway_files" "gateway/src/sharedMixed.ts"

  # Lane-infrastructure helpers that test.yml executes wrap every lane, so a
  # diff that touches only one of them must force a full scan.
  local infra_script
  for infra_script in backend-coverage-shard.sh prepare-integration-db.sh with-runner-lock.sh \
    subject-budget.mjs record-command-timing.mjs create-isolated-workspace.sh; do
    base_sha="$(git -C "$repo_dir" rev-parse HEAD)"
    printf '#!/usr/bin/env bash\necho %s\n' "$infra_script" > "$repo_dir/scripts/ci/$infra_script"
    git -C "$repo_dir" add "scripts/ci/$infra_script"
    git -C "$repo_dir" commit -qm "lane infrastructure $infra_script"
    head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

    run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" pull_request
    assert_exact_output "$output_file" "full_scan" "true"
  done

  # The time-command.sh budget file is read by every wrapped lane too.
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  printf '{}\n' > "$repo_dir/.github/ci-performance-budget.json"
  git -C "$repo_dir" add .github/ci-performance-budget.json
  git -C "$repo_dir" commit -qm "lane performance budget"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" pull_request
  assert_exact_output "$output_file" "full_scan" "true"

  assert_every_test_workflow_script_is_classified

  echo "classify-test-changes regression checks passed"
}

main "$@"
