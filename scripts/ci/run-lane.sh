#!/usr/bin/env bash
# Runs a single test lane based on the JSON plan emitted by plan-test-run.sh.
#
# Usage:
#   run-lane.sh <lane> [--plan PATH]
#
# Lanes recognized today:
#   frontend_unit, backend_unit, backend_integration, gateway_unit,
#   ai_proxy_unit, critical_mutation, browser_smoke, render_regression,
#   e2e_full, build
#
# The plan is read from --plan PATH or, if omitted, from
# $SANCTUARY_TEST_PLAN_FILE (default: ./test-plan.json). When the lane's
# `run` flag is false, the script exits 0 without doing anything.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

usage() {
  cat <<'EOF'
Usage: run-lane.sh <lane> [--plan PATH]
EOF
}

lane=""
plan_path="${SANCTUARY_TEST_PLAN_FILE:-./test-plan.json}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --plan) plan_path="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) usage >&2; printf 'run-lane: unknown option %s\n' "$1" >&2; exit 2 ;;
    *)
      if [ -z "$lane" ]; then
        lane="$1"; shift
      else
        usage >&2; exit 2
      fi
      ;;
  esac
done

if [ -z "$lane" ]; then
  usage >&2
  exit 2
fi

case "$lane" in
  frontend_unit|backend_unit|backend_integration|gateway_unit|ai_proxy_unit|critical_mutation|browser_smoke|render_regression|e2e_full|build)
    ;;
  *)
    printf 'run-lane: unknown lane %s\n' "$lane" >&2
    exit 2
    ;;
esac

if [ ! -f "$plan_path" ]; then
  printf 'run-lane: plan file not found at %s\n' "$plan_path" >&2
  exit 2
fi

# Read JSON via node — every Sanctuary lane has a Node toolchain available,
# and we already source provider-context.sh which lives in the same repo.
plan_json="$(cat "$plan_path")"

lane_field() {
  local field="$1"
  PLAN_JSON="$plan_json" LANE="$lane" FIELD="$field" node -e '
    const plan = JSON.parse(process.env.PLAN_JSON);
    const lane = plan.lanes?.[process.env.LANE];
    if (!lane) {
      process.exit(2);
    }
    const value = lane[process.env.FIELD];
    if (Array.isArray(value)) {
      process.stdout.write(value.join("\n"));
    } else {
      process.stdout.write(String(value));
    }
  '
}

plan_field() {
  local field="$1"
  PLAN_JSON="$plan_json" FIELD="$field" node -e '
    const plan = JSON.parse(process.env.PLAN_JSON);
    process.stdout.write(String(plan[process.env.FIELD] ?? ""));
  '
}

run_flag="$(lane_field run || echo false)"
if [ "$run_flag" != "true" ]; then
  ci_emit_notice "lane '$lane' is not selected (run=$run_flag); nothing to do"
  exit 0
fi

coverage_required="$(plan_field coverage_required)"
tier="$(plan_field tier)"
files_str="$(lane_field files)"

# Parse files into an array.
files=()
if [ -n "$files_str" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] && files+=("$f")
  done <<< "$files_str"
fi

ci_emit_notice "lane=$lane tier=$tier coverage_required=$coverage_required files=${#files[@]}"

# Local helper: run vitest at $1 with related/run mode based on files.
# Uses --pool threads --maxWorkers=1 --no-file-parallelism for coverage runs
# (segfault-safe), defaults otherwise.
run_vitest_in() {
  local dir="$1"
  shift
  local extra_args=("$@")

  local mode_args=()
  if [ "$coverage_required" = "true" ]; then
    mode_args+=(--coverage --pool threads --maxWorkers=1 --no-file-parallelism)
  fi

  if [ "${#files[@]}" -gt 0 ] && [ "$coverage_required" != "true" ]; then
    # Change-scoped run on PR (no coverage).
    (
      cd "$dir"
      exec npx vitest related --run --passWithNoTests "${mode_args[@]}" "${extra_args[@]}" -- "${files[@]}"
    )
  else
    # Full lane run (push/main/full or no specific files).
    (
      cd "$dir"
      exec npx vitest run "${mode_args[@]}" "${extra_args[@]}"
    )
  fi
}

case "$lane" in
  frontend_unit)
    run_vitest_in .
    ;;
  backend_unit)
    run_vitest_in server --exclude 'tests/integration/**'
    ;;
  backend_integration)
    (cd server && exec npm run test:integration:db)
    ;;
  gateway_unit)
    run_vitest_in gateway
    ;;
  ai_proxy_unit)
    (cd ai-proxy && exec npm test)
    ;;
  critical_mutation)
    (cd server && exec npm run test:critical-mutation)
    ;;
  browser_smoke)
    exec npx playwright test --project=chromium --grep '@smoke|browser-smoke'
    ;;
  render_regression)
    exec npx playwright test --project=chromium e2e/render-regression.spec.ts
    ;;
  e2e_full)
    exec npx playwright test
    ;;
  build)
    exec npm run build
    ;;
esac
