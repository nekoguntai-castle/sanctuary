#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"
# shellcheck source=scripts/ci/classify-files-lib.sh
. "$SCRIPT_DIR/classify-files-lib.sh"

event_name="$(ci_event_name)"
workflow_sha="$(ci_event_head_sha)"
origin_main_ref="${ORIGIN_MAIN_REF:-origin/main}"

full_scan=false
test_suite_changed=false
frontend_changed=false
backend_changed=false
backend_integration_changed=false
critical_mutation_changed=false
gateway_changed=false
ai_proxy_changed=false
e2e_changed=false
browser_smoke_changed=false
render_changed=false
build_changed=false

frontend_files=''
backend_files=''
critical_mutation_files=''
gateway_files=''
ai_proxy_files=''
test_files=''

append_file() {
  local var_name="$1"
  local file="$2"
  local current_value="${!var_name}"

  if [ -z "$current_value" ]; then
    printf -v "$var_name" '%s' "$file"
  else
    printf -v "$var_name" '%s %s' "$current_value" "$file"
  fi
}

emit_outputs() {
  ci_emit_output \
    "full_scan=$full_scan" \
    "test_suite_changed=$test_suite_changed" \
    "frontend_changed=$frontend_changed" \
    "frontend_files=$frontend_files" \
    "backend_changed=$backend_changed" \
    "backend_integration_changed=$backend_integration_changed" \
    "backend_files=$backend_files" \
    "critical_mutation_changed=$critical_mutation_changed" \
    "critical_mutation_files=$critical_mutation_files" \
    "gateway_changed=$gateway_changed" \
    "gateway_files=$gateway_files" \
    "ai_proxy_changed=$ai_proxy_changed" \
    "ai_proxy_files=$ai_proxy_files" \
    "e2e_changed=$e2e_changed" \
    "browser_smoke_changed=$browser_smoke_changed" \
    "render_changed=$render_changed" \
    "build_changed=$build_changed" \
    "test_files=$test_files"
}

mark_full_scan() {
  full_scan=true
}

if [ "$event_name" = "schedule" ] || [ "$event_name" = "workflow_dispatch" ]; then
  mark_full_scan
  emit_outputs
  exit 0
fi

zero_sha='0000000000000000000000000000000000000000'
base_sha=''
head_sha="$workflow_sha"

case "$event_name" in
  pull_request|merge_group)
    base_sha="$(ci_event_base_sha)"
    head_sha="$(ci_event_head_sha)"
    ;;
  push)
    base_sha="$(ci_event_base_sha)"
    head_sha="$workflow_sha"
    if [ "$base_sha" = "$zero_sha" ]; then
      base_sha="$(git rev-list --max-parents=0 "$head_sha")"
    fi
    ;;
  *)
    mark_full_scan
    emit_outputs
    exit 0
    ;;
esac

if [ -z "$base_sha" ]; then
  base_sha="$(git merge-base "$origin_main_ref" "$head_sha")"
fi

ensure_commit() {
  local sha="$1"
  if ! git rev-parse --verify "$sha^{commit}" >/dev/null 2>&1; then
    git fetch --no-tags --depth=1 origin "$sha" || true
  fi
}

ensure_commit "$base_sha"
ensure_commit "$head_sha"

git rev-parse --verify "$base_sha^{commit}" >/dev/null
git rev-parse --verify "$head_sha^{commit}" >/dev/null

# File-classification predicates live in scripts/ci/classify-files-lib.sh
# (sourced above). plan-test-run.sh shares the same library so the legacy
# KEY=VALUE emitter and the JSON emitter stay in lockstep.

while IFS= read -r file; do
  [ -n "$file" ] || continue

  if is_docs_only_file "$file"; then
    continue
  fi

  if is_full_scan_trigger_file "$file"; then
    mark_full_scan
    break
  fi

  if is_ai_proxy_file "$file"; then
    ai_proxy_changed=true
    append_file ai_proxy_files "$file"
    if is_test_file "$file"; then
      append_file test_files "$file"
    fi
    continue
  fi

  if is_test_suite_file "$file"; then
    test_suite_changed=true
    browser_smoke_changed=true
    render_changed=true
    build_changed=true
  fi

  if is_frontend_file "$file"; then
    frontend_changed=true
    append_file frontend_files "$file"
  fi

  if is_backend_file "$file"; then
    backend_changed=true
    append_file backend_files "$file"
  fi

  if is_backend_integration_file "$file"; then
    backend_integration_changed=true
  fi

  if is_critical_mutation_file "$file"; then
    critical_mutation_changed=true
    append_file critical_mutation_files "$file"
  fi

  if is_gateway_file "$file"; then
    gateway_changed=true
    append_file gateway_files "$file"
  fi

  if is_e2e_file "$file"; then
    e2e_changed=true
  fi

  if is_browser_smoke_file "$file"; then
    browser_smoke_changed=true
  fi

  if is_render_file "$file"; then
    render_changed=true
  fi

  if is_build_file "$file"; then
    build_changed=true
  fi

  if is_test_file "$file"; then
    append_file test_files "$file"
  fi
done < <(git diff --name-only "$base_sha" "$head_sha")

emit_outputs
