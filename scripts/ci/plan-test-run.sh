#!/usr/bin/env bash
# Emits a unified test plan as JSON. Workflow YAML and local devs both consume
# this instead of the 19 boolean outputs from classify-test-changes.sh.
#
# Usage:
#   plan-test-run.sh                      # auto-detect via provider-context
#   plan-test-run.sh --base SHA --head SHA
#   plan-test-run.sh --since main         # diff against a ref (local dev)
#
# Honors the same env contract as classify-test-changes.sh (EVENT_NAME,
# PR_BASE_SHA, PR_HEAD_SHA, MERGE_GROUP_*, PUSH_BEFORE_SHA, WORKFLOW_SHA),
# falling back through provider-context.sh.
#
# Tier rules:
#   pull_request                       -> quick   (no coverage gate)
#   push to main / merge_group         -> full    (coverage required)
#   workflow_dispatch full=true        -> full    (coverage required)
#   schedule                           -> nightly (mutation + extended)
#   anything else                      -> full    (safety default)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"
# shellcheck source=scripts/ci/classify-files-lib.sh
. "$SCRIPT_DIR/classify-files-lib.sh"

usage() {
  cat <<'EOF'
Usage: plan-test-run.sh [--base SHA] [--head SHA] [--since REF] [--full]

  --base SHA   Base SHA to diff from (defaults to provider-context).
  --head SHA   Head SHA to diff to   (defaults to provider-context).
  --since REF  Diff from a ref name  (e.g. --since main; local dev).
  --full       Force tier=full + coverage_required=true (overrides event).
EOF
}

base_sha=""
head_sha=""
since_ref=""
force_full=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base)  base_sha="$2"; shift 2 ;;
    --head)  head_sha="$2"; shift 2 ;;
    --since) since_ref="$2"; shift 2 ;;
    --full)  force_full=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; printf 'plan-test-run: unknown option %s\n' "$1" >&2; exit 2 ;;
  esac
done

event_name="$(ci_event_name)"
[ -n "$event_name" ] || event_name="local"

if [ -z "$head_sha" ]; then
  head_sha="$(ci_event_head_sha)"
fi
[ -n "$head_sha" ] || head_sha="HEAD"

if [ -z "$base_sha" ]; then
  if [ -n "$since_ref" ]; then
    base_sha="$(git merge-base "$since_ref" "$head_sha" 2>/dev/null || git rev-parse "$since_ref")"
  else
    base_sha="$(ci_event_base_sha)"
  fi
fi

zero_sha='0000000000000000000000000000000000000000'
origin_main_ref="${ORIGIN_MAIN_REF:-origin/main}"

# Push from a fresh ref reports 0000... as the base; treat it as "from the
# repo's first commit" so we don't fail the diff.
if [ "$base_sha" = "$zero_sha" ]; then
  base_sha="$(git rev-list --max-parents=0 "$head_sha")"
fi

# Tier and coverage decision.
tier="quick"
coverage_required="false"
case "$event_name" in
  pull_request)
    tier="quick"
    coverage_required="false"
    ;;
  merge_group|push)
    tier="full"
    coverage_required="true"
    ;;
  schedule)
    tier="nightly"
    coverage_required="true"
    ;;
  workflow_dispatch)
    if [ "$force_full" = true ] || [ "${SANCTUARY_PLAN_FORCE_FULL:-false}" = "true" ]; then
      tier="full"
      coverage_required="true"
    else
      tier="quick"
      coverage_required="false"
    fi
    ;;
  ''|local)
    # Local dev (no provider event) defaults to the quick tier so
    # `npm run test:related` gives fast feedback without enforcing the
    # 100%-coverage gate. Use `--full` to opt into the strict path.
    tier="quick"
    coverage_required="false"
    ;;
  *)
    tier="full"
    coverage_required="true"
    ;;
esac

if [ "$force_full" = true ]; then
  tier="full"
  coverage_required="true"
fi

# Resolve file diff. For unknown events (no base) or schedule, run everything.
full_scan="false"
if [ "$tier" = "nightly" ] || [ "$event_name" = "schedule" ] || [ "$event_name" = "workflow_dispatch" ] && [ "$force_full" = true ]; then
  full_scan="true"
fi

# Lane state
frontend_unit_run="false";       frontend_unit_files=()
backend_unit_run="false";        backend_unit_files=()
backend_integration_run="false"; backend_integration_files=()
gateway_unit_run="false";        gateway_unit_files=()
llm_egress_proxy_unit_run="false";       llm_egress_proxy_unit_files=()
critical_mutation_run="false";   critical_mutation_files=()
browser_smoke_run="false"
render_regression_run="false"
e2e_full_run="false"
build_run="false";               build_files=()

mark_full_scan() {
  full_scan="true"
  frontend_unit_run="true";       frontend_unit_files=()
  backend_unit_run="true";        backend_unit_files=()
  backend_integration_run="true"; backend_integration_files=()
  gateway_unit_run="true";        gateway_unit_files=()
  llm_egress_proxy_unit_run="true";       llm_egress_proxy_unit_files=()
  critical_mutation_run="true";   critical_mutation_files=()
  browser_smoke_run="true"
  render_regression_run="true"
  e2e_full_run="true"
  build_run="true";               build_files=()
}

if [ "$full_scan" = "true" ] || [ -z "$base_sha" ]; then
  mark_full_scan
else
  ensure_commit() {
    local sha="$1"
    if ! git rev-parse --verify "$sha^{commit}" >/dev/null 2>&1; then
      git fetch --no-tags --depth=1 origin "$sha" || true
    fi
  }
  ensure_commit "$base_sha"
  ensure_commit "$head_sha"

  # Iterate diff. Anything that touches a global trigger forces full_scan.
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    if is_docs_only_file "$file"; then
      continue
    fi
    if is_full_scan_trigger_file "$file"; then
      mark_full_scan
      break
    fi

    if is_llm_egress_proxy_file "$file"; then
      llm_egress_proxy_unit_run="true"
      llm_egress_proxy_unit_files+=("$file")
      continue
    fi
    if is_test_suite_file "$file"; then
      browser_smoke_run="true"
      render_regression_run="true"
      build_run="true"
    fi
    if is_frontend_file "$file"; then
      frontend_unit_run="true"
      frontend_unit_files+=("$file")
    fi
    if is_backend_file "$file"; then
      backend_unit_run="true"
      backend_unit_files+=("$file")
    fi
    if is_backend_integration_file "$file"; then
      backend_integration_run="true"
      backend_integration_files+=("$file")
    fi
    if is_critical_mutation_file "$file"; then
      critical_mutation_run="true"
      critical_mutation_files+=("$file")
    fi
    if is_gateway_file "$file"; then
      gateway_unit_run="true"
      gateway_unit_files+=("$file")
    fi
    if is_e2e_file "$file"; then
      e2e_full_run="true"
    fi
    if is_browser_smoke_file "$file"; then
      browser_smoke_run="true"
    fi
    if is_render_file "$file"; then
      render_regression_run="true"
    fi
    if is_build_file "$file"; then
      build_run="true"
      build_files+=("$file")
    fi
  done < <(git diff --name-only "$base_sha" "$head_sha")
fi

# JSON emit. We hand-build the document so jq is not required at runtime.
json_string() {
  # Escapes a single string for JSON: backslash, double-quote, control chars.
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}

json_array() {
  local first=true
  printf '['
  local item
  for item in "$@"; do
    # The `"${arr[@]:-}"` idiom expands to a single empty string when the
    # source array is empty; drop those so we emit `[]` not `[""]`.
    [ -z "$item" ] && continue
    if [ "$first" = true ]; then
      first=false
    else
      printf ','
    fi
    json_string "$item"
  done
  printf ']'
}

emit_lane() {
  local name="$1"; shift
  local run="$1"; shift
  printf '"%s":{"run":%s,"files":' "$name" "$run"
  json_array "$@"
  printf '}'
}

{
  printf '{'
  printf '"tier":%s,' "$(json_string "$tier")"
  printf '"coverage_required":%s,' "$coverage_required"
  printf '"full_scan":%s,' "$full_scan"
  printf '"provider":%s,' "$(json_string "$(ci_provider)")"
  printf '"event":%s,' "$(json_string "$event_name")"
  printf '"base_sha":%s,' "$(json_string "$base_sha")"
  printf '"head_sha":%s,' "$(json_string "$head_sha")"
  printf '"lanes":{'
  emit_lane "frontend_unit"       "$frontend_unit_run"        "${frontend_unit_files[@]:-}"; printf ','
  emit_lane "backend_unit"        "$backend_unit_run"         "${backend_unit_files[@]:-}"; printf ','
  emit_lane "backend_integration" "$backend_integration_run"  "${backend_integration_files[@]:-}"; printf ','
  emit_lane "gateway_unit"        "$gateway_unit_run"         "${gateway_unit_files[@]:-}"; printf ','
  emit_lane "llm_egress_proxy_unit"       "$llm_egress_proxy_unit_run"        "${llm_egress_proxy_unit_files[@]:-}"; printf ','
  emit_lane "critical_mutation"   "$critical_mutation_run"    "${critical_mutation_files[@]:-}"; printf ','
  emit_lane "browser_smoke"       "$browser_smoke_run";       printf ','
  emit_lane "render_regression"   "$render_regression_run";   printf ','
  emit_lane "e2e_full"            "$e2e_full_run";            printf ','
  emit_lane "build"               "$build_run"                "${build_files[@]:-}"
  printf '}'
  printf '}'
  printf '\n'
}
