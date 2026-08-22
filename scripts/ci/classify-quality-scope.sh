#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

event_name="$(ci_event_name)"
workflow_sha="$(ci_event_head_sha)"

run_repo_quality=true
run_workflow_quality=false
run_ci_classifier_tests=false

emit_outputs() {
  ci_emit_output \
    "run_repo_quality=$run_repo_quality" \
    "run_workflow_quality=$run_workflow_quality" \
    "run_ci_classifier_tests=$run_ci_classifier_tests"
}

mark_full_quality() {
  run_repo_quality=true
  run_workflow_quality=true
  run_ci_classifier_tests=true
}

case "$event_name" in
  schedule|workflow_dispatch)
    mark_full_quality
    emit_outputs
    exit 0
    ;;
esac

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
    mark_full_quality
    emit_outputs
    exit 0
    ;;
esac

if [ -z "$base_sha" ]; then
  mark_full_quality
  emit_outputs
  exit 0
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

is_repo_quality_exempt_file() {
  case "$1" in
    *.md|docs/*|.github/workflows/*.yml|.github/workflows/*.yaml)
      return 0
      ;;
  esac
  return 1
}

is_workflow_file() {
  case "$1" in
    .github/workflows/*.yml|.github/workflows/*.yaml)
      return 0
      ;;
  esac
  return 1
}

is_ci_classifier_file() {
  case "$1" in
    scripts/ci/*|tests/ci/*|.github/workflows/test.yml|.github/workflows/install-test.yml|.github/workflows/quality.yml)
      return 0
      ;;
  esac
  return 1
}

run_repo_quality=false
run_workflow_quality=false
run_ci_classifier_tests=false

while IFS= read -r file; do
  [ -n "$file" ] || continue
  if is_workflow_file "$file"; then
    run_workflow_quality=true
  fi
  if is_ci_classifier_file "$file"; then
    run_ci_classifier_tests=true
  fi
  if ! is_repo_quality_exempt_file "$file"; then
    run_repo_quality=true
  fi
done < <(git diff --no-renames --name-only "$base_sha" "$head_sha")

emit_outputs
