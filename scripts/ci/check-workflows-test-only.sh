#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow_dir="${1:-$repo_root/.github/workflows}"
actions_dir="$(dirname "$workflow_dir")/actions"

if [ ! -d "$workflow_dir" ]; then
  echo "workflow policy: directory not found: $workflow_dir" >&2
  exit 1
fi

failures=0
scan_roots=("$workflow_dir")
if [ -d "$actions_dir" ]; then
  scan_roots+=("$actions_dir")
fi

find_policy_files() {
  find "${scan_roots[@]}" -type f \( -name '*.yml' -o -name '*.yaml' \) -print0
}

check_rule() {
  local label="$1"
  local pattern="$2"
  local matches

  matches="$(
    find_policy_files |
      sort -z |
      xargs -0 grep -nE "$pattern" 2>/dev/null |
      grep -Ev '^[^:]+:[0-9]+:[[:space:]]*#' || true
  )"
  if [ -n "$matches" ]; then
    echo "workflow policy violation ($label):" >&2
    printf '%s\n' "$matches" >&2
    failures=$((failures + 1))
  fi
}

check_rule "write permission" \
  'permissions:[[:space:]]+["'\'']?write-all["'\'']?([[:space:]]|$)|(^|[,{[:space:]])(actions|checks|contents|deployments|id-token|packages|pull-requests|statuses):[[:space:]]*["'\'']?write["'\'']?([,}[:space:]]|$)'
check_rule "registry login" \
  'uses:[[:space:]]+docker/login-action|(^|[[:space:]])(docker|podman|oras)[[:space:]]+login([[:space:]]|$)|helm[[:space:]]+registry[[:space:]]+login'
check_rule "image publication" \
  '^[[:space:]]+push:[[:space:]]*["'\'']?(true|yes|\$\{\{)|(^|[[:space:]])(docker|podman|oras)[[:space:]]+push([[:space:]]|$)|skopeo[[:space:]]+copy|buildx[[:space:]].*(--push|type=registry|imagetools[[:space:]]+create)|docker[[:space:]]+manifest[[:space:]]+push'
check_rule "distribution credential" \
  'CODEBERG_(USER|PACKAGE_TOKEN)|UMBREL_DISPATCH_TOKEN|GHCR_(TOKEN|PAT)|GITHUB_RELEASE_TOKEN'
check_rule "release mutation" \
  'create-forge-release\.sh|(^|[[:space:]])gh[[:space:]]+release[[:space:]]+(create|delete|edit|upload)([[:space:]]|$)|api\.github\.com/repos/[^/]+/[^/]+/releases|/api/v[0-9]+/repos/[^/]+/[^/]+/releases'
check_rule "Pages deployment" \
  'actions/(configure-pages|deploy-pages|upload-pages-artifact)|pages:[[:space:]]+write'
check_rule "downstream dispatch" \
  '/dispatches([/?"]|$)'
check_rule "outbound API mutation" \
  'curl[^#]*(--request[ =]|-X[[:space:]]*)(POST|PATCH|DELETE)([[:space:]]|$)'

unexpected_secrets="$(
  find_policy_files |
    sort -z |
    xargs -0 grep -nE '\$\{\{[[:space:]]*secrets\.[A-Za-z0-9_]+' 2>/dev/null || true
)"
if [ -n "$unexpected_secrets" ]; then
  echo "workflow policy violation (non-diagnostic secret):" >&2
  printf '%s\n' "$unexpected_secrets" >&2
  failures=$((failures + 1))
fi

if [ "$failures" -ne 0 ]; then
  echo "workflow policy: $failures mutation class(es) detected" >&2
  exit 1
fi

echo "workflow policy: all workflows are test-only"
