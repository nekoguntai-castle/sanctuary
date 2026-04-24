#!/usr/bin/env bash
set -euo pipefail

output_file="${GITHUB_OUTPUT:-/dev/stdout}"
event_name="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
workflow_sha="${WORKFLOW_SHA:-${GITHUB_SHA:-HEAD}}"
origin_main_ref="${ORIGIN_MAIN_REF:-origin/main}"

actions_changed=false
javascript_typescript_changed=false
go_changed=false
python_changed=false

emit_outputs() {
  {
    echo "actions_changed=$actions_changed"
    echo "javascript_typescript_changed=$javascript_typescript_changed"
    echo "go_changed=$go_changed"
    echo "python_changed=$python_changed"
  } >> "$output_file"
}

mark_full_scan() {
  actions_changed=true
  javascript_typescript_changed=true
  go_changed=true
  python_changed=true
}

case "$event_name" in
  schedule|workflow_dispatch)
    mark_full_scan
    emit_outputs
    exit 0
    ;;
esac

zero_sha='0000000000000000000000000000000000000000'
base_sha=''
head_sha="$workflow_sha"

case "$event_name" in
  pull_request)
    base_sha="${PR_BASE_SHA:-}"
    head_sha="${PR_HEAD_SHA:-$workflow_sha}"
    ;;
  merge_group)
    base_sha="${MERGE_GROUP_BASE_SHA:-}"
    head_sha="${MERGE_GROUP_HEAD_SHA:-$workflow_sha}"
    ;;
  push)
    base_sha="${PUSH_BEFORE_SHA:-}"
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

is_actions_file() {
  case "$1" in
    .github/workflows/*|.github/actions/*|.github/dependabot.yml)
      return 0
      ;;
  esac
  return 1
}

is_javascript_typescript_file() {
  case "$1" in
    *.js|*.jsx|*.mjs|*.cjs|*.ts|*.tsx|*.mts|*.cts|*.vue)
      return 0
      ;;
    package.json|package-lock.json|tsconfig*.json|vite.config.*|vitest.config.*|playwright.config.*|eslint.config.*|stryker*.config.*)
      return 0
      ;;
    server/package.json|server/package-lock.json|server/tsconfig*.json|server/vitest.config.*|server/stryker*.config.*)
      return 0
      ;;
    gateway/package.json|gateway/package-lock.json|gateway/tsconfig*.json|gateway/vitest.config.*)
      return 0
      ;;
    scripts/verify-addresses/package.json|scripts/verify-addresses/package-lock.json|scripts/verify-addresses/tsconfig.json|scripts/verify-psbt/package.json)
      return 0
      ;;
  esac
  return 1
}

is_go_file() {
  case "$1" in
    *.go|go.mod|go.sum|*/go.mod|*/go.sum)
      return 0
      ;;
  esac
  return 1
}

is_python_file() {
  case "$1" in
    *.py|requirements*.txt|*/requirements*.txt|pyproject.toml|*/pyproject.toml|poetry.lock|*/poetry.lock)
      return 0
      ;;
  esac
  return 1
}

while IFS= read -r file; do
  [ -n "$file" ] || continue

  if is_actions_file "$file"; then
    actions_changed=true
  fi

  if is_javascript_typescript_file "$file"; then
    javascript_typescript_changed=true
  fi

  if is_go_file "$file"; then
    go_changed=true
  fi

  if is_python_file "$file"; then
    python_changed=true
  fi
done < <(git diff --name-only "$base_sha" "$head_sha")

emit_outputs
