#!/usr/bin/env bash
# Documentation-only early exit for .github/workflows/verify-vectors.yml.
#
# This is NOT a positive path filter. verify-vectors.yml's own trigger block
# (and scripts/ci/check-wallet-safety-classifier.mjs's
# validateWorkflowPathFilters, enforced by node scripts/ci/check-wallet-safety-classifier.mjs)
# forbid gating the funds-safety proof jobs by which paths changed, because a
# positive filter can silently omit a newly introduced address, wallet-policy,
# or hardware integration boundary. This script instead computes, per run,
# whether the changed-file set is PROVABLY LIMITED to documentation — every
# changed file must match the small allowlist below. Any file this script does
# not recognize, any git failure, any unresolved event context, and every
# non-pull_request/merge_group/push event all fail CLOSED to "run the proofs".
# There is no code path that can produce a false "skip" for a change to
# runtime, test, or CI-control-plane source: the allowlist only ever narrows
# toward *.md/*.mdx/docs/**/tasks/**, never widens.
#
# Emits exactly one output: run_verify_vectors=true|false

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

event_name="$(ci_event_name)"
workflow_sha="$(ci_event_head_sha)"

emit_run() {
  ci_emit_output "run_verify_vectors=true"
}

emit_skip() {
  ci_emit_output "run_verify_vectors=false"
}

case "$event_name" in
  schedule|workflow_dispatch|merge_group)
    emit_run
    exit 0
    ;;
esac

zero_sha='0000000000000000000000000000000000000000'
base_sha=''
head_sha="$workflow_sha"
diff_mode='three-dot'

case "$event_name" in
  pull_request)
    base_sha="$(ci_event_base_sha)"
    head_sha="$(ci_event_head_sha)"
    diff_mode='three-dot'
    ;;
  push)
    base_sha="$(ci_event_base_sha)"
    head_sha="$workflow_sha"
    diff_mode='two-dot'
    if [ "$base_sha" = "$zero_sha" ]; then
      # First push of a branch/ref: nothing to diff against, fail closed.
      emit_run
      exit 0
    fi
    ;;
  *)
    # Unknown event: fail closed.
    emit_run
    exit 0
    ;;
esac

if [ -z "$base_sha" ] || [ -z "$head_sha" ]; then
  emit_run
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

if ! git rev-parse --verify "$base_sha^{commit}" >/dev/null 2>&1 \
  || ! git rev-parse --verify "$head_sha^{commit}" >/dev/null 2>&1; then
  emit_run
  exit 0
fi

diff_range="$base_sha $head_sha"
if [ "$diff_mode" = 'three-dot' ]; then
  diff_range="$base_sha...$head_sha"
fi

changed_files=""
if ! changed_files="$(git diff --no-renames --name-only $diff_range 2>/dev/null)"; then
  emit_run
  exit 0
fi

if [ -z "$changed_files" ]; then
  emit_run
  exit 0
fi

# These paths intentionally fail the documentation allowlist even though they
# are not documentation: they are the proof's own control-plane inputs, and a
# change to them must always re-run the funds-safety proofs. Listed here only
# as an explanatory comment; the allowlist function below already rejects
# them because none of these patterns are *.md/*.mdx/docs/**/tasks/**:
#   config/wallet-safety-critical-paths.json
#   scripts/verify-psbt/**
#   .github/workflows/verify-vectors.yml
#   scripts/ci/classify-verify-vectors-scope.sh (this script)

is_documentation_only_file() {
  case "$1" in
    *.md|*.mdx)
      return 0
      ;;
    docs/*)
      return 0
      ;;
    tasks/*)
      return 0
      ;;
  esac
  return 1
}

while IFS= read -r file; do
  [ -n "$file" ] || continue
  if ! is_documentation_only_file "$file"; then
    emit_run
    exit 0
  fi
done <<< "$changed_files"

emit_skip
