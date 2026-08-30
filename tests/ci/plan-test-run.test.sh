#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLANNER="$ROOT_DIR/scripts/ci/plan-test-run.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Extract a JSON field via node — same approach run-lane.sh uses, so the test
# mirrors what production code does when reading the plan.
json_query() {
  local payload="$1"
  local query="$2"
  PAYLOAD="$payload" QUERY="$query" node -e '
    const plan = JSON.parse(process.env.PAYLOAD);
    const parts = process.env.QUERY.split(".");
    let cur = plan;
    for (const p of parts) {
      cur = cur?.[p];
    }
    if (Array.isArray(cur)) process.stdout.write(JSON.stringify(cur));
    else process.stdout.write(String(cur));
  '
}

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  [ "$actual" = "$expected" ] || fail "$label: expected '$expected', got '$actual'"
}

create_repo() {
  local repo="$1"
  git init -q "$repo"
  git -C "$repo" config user.email t@t
  git -C "$repo" config user.name t
  printf '{"name":"fixture"}\n' > "$repo/package.json"
  git -C "$repo" add package.json
  git -C "$repo" commit -qm base
}

run_planner() {
  local repo="$1"
  local base="$2"
  local head="$3"
  shift 3
  local effective_event="${EVENT_NAME:-push}"
  (
    cd "$repo"
    case "$effective_event" in
      pull_request)
        EVENT_NAME=pull_request \
          PR_BASE_SHA="$base" PR_HEAD_SHA="$head" \
          bash "$PLANNER" "$@"
        ;;
      merge_group)
        EVENT_NAME=merge_group \
          MERGE_GROUP_BASE_SHA="$base" MERGE_GROUP_HEAD_SHA="$head" \
          bash "$PLANNER" "$@"
        ;;
      *)
        # push, workflow_dispatch, schedule all read WORKFLOW_SHA (and
        # PUSH_BEFORE_SHA for push) for diff anchors.
        EVENT_NAME="$effective_event" \
          WORKFLOW_SHA="$head" PUSH_BEFORE_SHA="$base" \
          bash "$PLANNER" "$@"
        ;;
    esac
  )
}

main() {
  local tmp repo
  tmp="$(mktemp -d)"
  trap 'rm -rf "'"$tmp"'"' EXIT
  repo="$tmp/repo"
  create_repo "$repo"
  local base
  base="$(git -C "$repo" rev-parse HEAD)"

  # ---- Frontend-only PR ----------------------------------------------------
  mkdir -p "$repo/src/components"
  printf 'export const X = 1\n' > "$repo/src/components/X.tsx"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'frontend change'
  local head
  head="$(git -C "$repo" rev-parse HEAD)"

  local plan
  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "PR tier=quick" "quick" "$(json_query "$plan" tier)"
  assert_eq "PR coverage_required=false" "false" "$(json_query "$plan" coverage_required)"
  assert_eq "PR full_scan=false" "false" "$(json_query "$plan" full_scan)"
  assert_eq "frontend_unit run" "true" "$(json_query "$plan" lanes.frontend_unit.run)"
  assert_eq "frontend_unit files" '["src/components/X.tsx"]' "$(json_query "$plan" lanes.frontend_unit.files)"
  assert_eq "backend_unit not run" "false" "$(json_query "$plan" lanes.backend_unit.run)"

  # ---- Release contract tests are not frontend tests ----------------------
  base="$head"
  local release_base="$base"
  mkdir -p "$repo/tests/release"
  printf 'import test from "node:test"; test("release", () => {});\n' > "$repo/tests/release/contract.test.mjs"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'release contract test'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "release-only frontend_unit" "false" "$(json_query "$plan" lanes.frontend_unit.run)"
  assert_eq "release-only full_scan" "false" "$(json_query "$plan" full_scan)"

  base="$head"
  mkdir -p "$repo/server/.husky"
  printf '#!/bin/sh\n' > "$repo/server/.husky/pre-commit"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'pre-commit hook only'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "hook-only backend_unit" "false" "$(json_query "$plan" lanes.backend_unit.run)"
  assert_eq "hook-only full_scan" "false" "$(json_query "$plan" full_scan)"

  printf 'export const ReleaseMixed = 1\n' > "$repo/src/components/ReleaseMixed.tsx"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'mixed release and frontend range'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$release_base" "$head")"
  assert_eq "mixed release/frontend frontend_unit" "true" "$(json_query "$plan" lanes.frontend_unit.run)"
  assert_eq "mixed release/frontend files" '["src/components/ReleaseMixed.tsx"]' "$(json_query "$plan" lanes.frontend_unit.files)"

  # ---- Push to main: tier=full + coverage required -------------------------
  plan="$(EVENT_NAME=push run_planner "$repo" "$base" "$head")"
  assert_eq "push tier=full" "full" "$(json_query "$plan" tier)"
  assert_eq "push coverage_required=true" "true" "$(json_query "$plan" coverage_required)"

  # ---- Server source change includes integration trigger -------------------
  base="$head"
  mkdir -p "$repo/server/src/services/notifications"
  printf 'export const x = 1\n' > "$repo/server/src/services/notifications/note.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'add backend service'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "backend_unit run" "true" "$(json_query "$plan" lanes.backend_unit.run)"
  assert_eq "backend_integration not run (services dir)" "false" "$(json_query "$plan" lanes.backend_integration.run)"

  # ---- Server middleware change does trigger backend_integration -----------
  base="$head"
  mkdir -p "$repo/server/src/middleware"
  printf 'export const m = 1\n' > "$repo/server/src/middleware/auth.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'middleware change'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "middleware -> backend_integration" "true" "$(json_query "$plan" lanes.backend_integration.run)"
  assert_eq "middleware -> critical_mutation (auth.ts)" "true" "$(json_query "$plan" lanes.critical_mutation.run)"

  # ---- Browser E2E seeder change runs its real browser consumer ------------
  base="$head"
  mkdir -p "$repo/server/scripts"
  printf 'export const seedBrowserE2E = true\n' > "$repo/server/scripts/seed-browser-e2e.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'browser e2e seeder change'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "browser seeder -> backend_unit" "true" "$(json_query "$plan" lanes.backend_unit.run)"
  assert_eq "browser seeder -> browser_smoke" "true" "$(json_query "$plan" lanes.browser_smoke.run)"
  assert_eq "browser seeder does not select render" "false" "$(json_query "$plan" lanes.render_regression.run)"

  # ---- test.yml change forces full scan ------------------------------------
  # Only test.yml defines the lanes this plan drives, so only test.yml triggers
  # a full scan. Any other workflow must not (see the install-test.yml case below).
  base="$head"
  mkdir -p "$repo/.github/workflows"
  printf 'name: Test Suite\non: push\njobs: {}\n' > "$repo/.github/workflows/test.yml"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'test workflow change'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "workflow -> full_scan" "true" "$(json_query "$plan" full_scan)"
  # Every lane should be run=true under full_scan
  assert_eq "full_scan -> backend_unit" "true" "$(json_query "$plan" lanes.backend_unit.run)"
  assert_eq "full_scan -> e2e_full" "true" "$(json_query "$plan" lanes.e2e_full.run)"
  assert_eq "full_scan -> build" "true" "$(json_query "$plan" lanes.build.run)"
  # Files arrays under full_scan are empty (lane runs full suite)
  assert_eq "full_scan -> empty files" "[]" "$(json_query "$plan" lanes.backend_unit.files)"

  # ---- A non-test workflow file does NOT force a full scan -----------------
  base="$head"
  printf 'name: Install Tests\non: push\njobs: {}\n' > "$repo/.github/workflows/install-test.yml"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'install workflow change'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "non-test workflow -> no full_scan" "false" "$(json_query "$plan" full_scan)"
  assert_eq "non-test workflow -> no backend_unit" "false" "$(json_query "$plan" lanes.backend_unit.run)"
  assert_eq "non-test workflow -> no e2e_full" "false" "$(json_query "$plan" lanes.e2e_full.run)"

  # ---- A composite action still forces a full scan -------------------------
  # `*` matches `/` in a bash case pattern, so this also covers the nested
  # vendored composites under .github/actions/vendor/.
  base="$head"
  mkdir -p "$repo/.github/actions/vendor/forgejo-artifact-v4/upload"
  printf 'name: Upload\nruns:\n  using: composite\n  steps: []\n' \
    > "$repo/.github/actions/vendor/forgejo-artifact-v4/upload/action.yml"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'vendored composite change'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "vendored composite -> full_scan" "true" "$(json_query "$plan" full_scan)"

  # ---- Docs-only PR is a no-op -------------------------------------------
  base="$head"
  printf '# notes\n' > "$repo/NOTES.md"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'docs only'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "docs-only frontend_unit" "false" "$(json_query "$plan" lanes.frontend_unit.run)"
  assert_eq "docs-only backend_unit" "false" "$(json_query "$plan" lanes.backend_unit.run)"
  assert_eq "docs-only build" "false" "$(json_query "$plan" lanes.build.run)"

  # ---- workflow_dispatch --full forces full tier --------------------------
  plan="$(EVENT_NAME=workflow_dispatch run_planner "$repo" "$base" "$head" --full)"
  assert_eq "dispatch --full tier=full" "full" "$(json_query "$plan" tier)"
  assert_eq "dispatch --full coverage_required" "true" "$(json_query "$plan" coverage_required)"
  assert_eq "dispatch --full full_scan" "true" "$(json_query "$plan" full_scan)"

  # ---- *.integration.test.* anywhere under server/ routes correctly -------
  base="$head"
  mkdir -p "$repo/server/tests/feature"
  printf 'export const t = 1\n' > "$repo/server/tests/feature/notifications.integration.test.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -qm 'add nested integration test'
  head="$(git -C "$repo" rev-parse HEAD)"

  plan="$(EVENT_NAME=pull_request run_planner "$repo" "$base" "$head")"
  assert_eq "nested .integration.test → backend_integration" "true" \
    "$(json_query "$plan" lanes.backend_integration.run)"

  echo "plan-test-run regression checks passed"
}

main "$@"
