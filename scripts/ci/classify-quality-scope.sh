#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

event_name="$(ci_event_name)"
workflow_sha="$(ci_event_head_sha)"

run_repo_quality=true
run_source_quality=true
run_dependency_audit=true
run_workflow_quality=false
run_ci_classifier_tests=false

emit_outputs() {
  ci_emit_output \
    "run_repo_quality=$run_repo_quality" \
    "run_source_quality=$run_source_quality" \
    "run_dependency_audit=$run_dependency_audit" \
    "run_workflow_quality=$run_workflow_quality" \
    "run_ci_classifier_tests=$run_ci_classifier_tests"
}

mark_full_quality() {
  run_repo_quality=true
  run_source_quality=true
  run_dependency_audit=true
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
    scripts/ci/*|tests/ci/*|scripts/ownership/*|tests/ownership/*|config/resource-ownership-contract.json|config/operator-recovery-contract.json|config/operator-recovery-incident.json|config/resource-lifecycle-callsites.json|config/application-lifecycle-authorities.json|docs/adr/0005-resource-ownership-and-cleanup-receipts.md|docs/reference/resource-ownership-cleanup.md|config/ci-toolchain-lock.json|config/hardware-emulator-source-inventory.json|.github/actions/setup-node-toolchain/action.yml|.github/workflows/test.yml|.github/workflows/install-test.yml|.github/workflows/quality.yml|.github/workflows/verify-vectors.yml)
      return 0
      ;;
    package.json|scripts/bump-version.sh|scripts/release/*|tests/release/*|CLAUDE.md|.claude/commands/release.md|.claude/commands/pre-release.md|.github/CONTRIBUTING.md|docs/reference/release-distribution.md|docs/reference/release-gates.md|docs/reference/changelog.md|docs/how-to/release-candidate-canary.md)
      return 0
      ;;
  esac
  return 1
}

is_quality_control_plane_file() {
  case "$1" in
    .github/workflows/quality.yml|scripts/ci/classify-quality-scope.sh)
      return 0
      ;;
  esac
  return 1
}

# Package manifests and locks intentionally belong to both scopes: lint installs
# its parser/plugin runtime from them, so dependency-only changes still exercise
# the lint gate. Each scoped tool's own script/config is also an owning input;
# otherwise the required-check aggregate would accept its skipped job.
is_source_quality_file() {
  case "$1" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
      return 0
      ;;
    .gitignore|*/.gitignore)
      # jscpd runs with --gitignore, so ignore-rule changes alter its scan set.
      return 0
      ;;
    package.json|*/package.json|package-lock.json|*/package-lock.json)
      return 0
      ;;
    scripts/ci/run-quality-lint.sh|scripts/quality.sh)
      return 0
      ;;
    .github/actions/setup-node-toolchain/action.yml|.github/actions/setup-python-toolchain/action.yml)
      return 0
      ;;
    scripts/ci/bootstrap-node.sh|scripts/ci/ensure-node.sh|scripts/ci/ensure-python.sh)
      return 0
      ;;
    config/ci-toolchain-lock.json)
      return 0
      ;;
    scripts/quality/lizard-only.sh|scripts/quality/jscpd-only.sh)
      return 0
      ;;
    scripts/quality/lizard-requirements.txt|config/tooling/jscpd.json)
      return 0
      ;;
  esac
  is_quality_control_plane_file "$1"
}

is_dependency_audit_file() {
  case "$1" in
    package.json|*/package.json|package-lock.json|*/package-lock.json)
      return 0
      ;;
    scripts/ci/npm-*.json|scripts/ci/npm-*.mjs|scripts/ci/check-npm-*.mjs)
      return 0
      ;;
    scripts/quality/check-lockfile-peer-resolution.sh)
      return 0
      ;;
    scripts/quality/lockfile-peer-resolution-allowlist.txt)
      return 0
      ;;
    .github/actions/setup-node-toolchain/action.yml|scripts/ci/bootstrap-node.sh|scripts/ci/ensure-node.sh|config/ci-toolchain-lock.json)
      return 0
      ;;
  esac
  is_quality_control_plane_file "$1"
}

run_repo_quality=false
run_source_quality=false
run_dependency_audit=false
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
  if is_source_quality_file "$file"; then
    run_source_quality=true
  fi
  if is_dependency_audit_file "$file"; then
    run_dependency_audit=true
  fi
  if ! is_repo_quality_exempt_file "$file"; then
    run_repo_quality=true
  fi
done < <(git diff --no-renames --name-only "$base_sha" "$head_sha")

emit_outputs
