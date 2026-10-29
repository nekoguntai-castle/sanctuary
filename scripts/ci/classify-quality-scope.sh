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
run_lifecycle_callsites=false

emit_outputs() {
  ci_emit_output \
    "run_repo_quality=$run_repo_quality" \
    "run_source_quality=$run_source_quality" \
    "run_dependency_audit=$run_dependency_audit" \
    "run_workflow_quality=$run_workflow_quality" \
    "run_ci_classifier_tests=$run_ci_classifier_tests" \
    "run_lifecycle_callsites=$run_lifecycle_callsites"
}

mark_full_quality() {
  run_repo_quality=true
  run_source_quality=true
  run_dependency_audit=true
  run_workflow_quality=true
  run_ci_classifier_tests=true
  run_lifecycle_callsites=true
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
    scripts/ci/*|tests/ci/*|server/tests/integration/*|scripts/ownership/*|tests/ownership/*|config/resource-ownership-contract.json|config/operator-recovery-contract.json|config/operator-recovery-incident.json|config/resource-lifecycle-callsites.json|config/application-lifecycle-authorities.json|docs/adr/0005-resource-ownership-and-cleanup-receipts.md|docs/reference/resource-ownership-cleanup.md|config/ci-toolchain-lock.json|config/hardware-emulator-source-inventory.json|.github/actions/setup-node-toolchain/action.yml|.github/workflows/test.yml|.github/workflows/install-test.yml|.github/workflows/quality.yml|.github/workflows/verify-vectors.yml)
      return 0
      ;;
    # Exact gate, backup and pre-commit scripts whose fail-closed regression
    # suites run only in ci-classifier-tests (D-11.18); not a scripts/quality*
    # or scripts/ops/* glob. The lockfile-peer allowlist is optional and
    # untracked: creating it must run its suite.
    scripts/quality.sh|scripts/quality/jscpd-only.sh|scripts/quality/lizard-only.sh|scripts/quality/check-lockfile-peer-resolution.sh|scripts/quality/lockfile-peer-resolution-allowlist.txt)
      return 0
      ;;
    scripts/ops/sanctuary-backup.sh|scripts/ops/install-sanctuary-backup.sh|server/.husky/pre-commit)
      return 0
      ;;
    # Files the ci-classifier-tests suites execute: modules they import, and
    # scripts or configs they source, run or copy from the checkout (D-17.C2),
    # plus the root-layout schema its suite pins. Exact paths, not globs.
    # tests/ci/classify-quality-scope.test.sh derives the executed set from
    # quality.yml and fails when one of them is missing here.
    scripts/lib/is-main-module.mjs|scripts/quality/check-root-layout.mjs|scripts/quality/root-layout-classification.schema.json|scripts/bump-funds-critical.sh|scripts/create-forge-release.sh|scripts/offline/apply-bundle.sh|scripts/offline/bundle-common.sh|config/tooling/jscpd.json|config/wallet-safety-critical-paths.json|.github/ci-performance-budget.json)
      return 0
      ;;
    scripts/perf/wallet-sync-database-readiness.mjs|scripts/perf/wallet-sync-health-probe.mjs|scripts/perf/wallet-sync-high-fanout-replay.mjs|scripts/perf/wallet-sync-replay-cleanup.mjs|scripts/perf/wallet-sync-replay-creation.mjs|scripts/perf/wallet-sync-replay-ownership.mjs)
      return 0
      ;;
    server/scripts/check-runtime-prisma-deps.cjs|server/scripts/project-runtime-dependencies.cjs|server/scripts/mutation/shards.mjs|server/stryker.critical.config.mjs|scripts/integration-test-defaults.sh|tests/install/run-all-tests.sh|tests/install/utils/assertion-tracking.sh|tests/install/utils/collect-upgrade-artifacts.sh|tests/install/utils/helpers.sh|tests/install/utils/upgrade-selection.sh|tests/install/utils/upgrade-source-refs.sh)
      return 0
      ;;
    scripts/reset-user-2fa.sh|scripts/support-package-runner.mjs|scripts/generate-signer-inventory.mjs|scripts/check-server-cycle-baseline.mjs|scripts/check-wallet-sync-lifecycle-contract.mjs|scripts/check-wallet-sync-mutation-boundaries.mjs|scripts/architecture/generate-graphs.mjs|scripts/architecture/extract-call-graphs.mjs)
      return 0
      ;;
    # The Phase 2/3 Compose smoke scripts phase-smoke-cleanup-composition.test.mjs
    # runs through process.execPath, and their import closure (D-17.C2).
    scripts/ops/phase2-alert-receiver-smoke.mjs|scripts/ops/phase2-gateway-audit-compose-smoke.mjs|scripts/perf/phase3-compose-benchmark-smoke.mjs|scripts/perf/phase3-benchmark-utils.mjs|scripts/perf/phase3-compose/api.mjs|scripts/perf/phase3-compose/backend-scale-out-proof.mjs|scripts/perf/phase3-compose/benchmark-harness.mjs|scripts/perf/phase3-compose/benchmark-proof.mjs|scripts/perf/phase3-compose/capacity-snapshots.mjs|scripts/perf/phase3-compose/common.mjs|scripts/perf/phase3-compose/compose-runtime.mjs|scripts/perf/phase3-compose/config.mjs|scripts/perf/phase3-compose/large-wallet-history-proof.mjs|scripts/perf/phase3-compose/postgres.mjs|scripts/perf/phase3-compose/proofs.mjs|scripts/perf/phase3-compose/report.mjs|scripts/perf/phase3-compose/sized-backup-restore-proof.mjs|scripts/perf/phase3-compose/worker-proofs.mjs|scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs|scripts/perf/phase3-compose/proof-scripts/worker-queue.mjs|scripts/perf/phase3-compose/proof-scripts/worker-scale-out.mjs)
      return 0
      ;;
    # Real checkout files read by the classifier-only contract suites (D-14.C6).
    # Exact paths: other compose files and Dockerfiles are covered by the
    # always-on supply-chain lock step in determine-scope (D-14.C5).
    docker/compose/test.yml|docker/frontend/Dockerfile|docker/test/backend.Dockerfile|docker/test/backend.Dockerfile.dockerignore|scripts/run-tests.sh|scripts/run-integration-tests.sh|scripts/verify-addresses/verify-repeatable.sh|scripts/verify-addresses/docker-compose.yml|scripts/verify-addresses/implementations/go.mod|scripts/verify-addresses/implementations/go.sum)
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
run_lifecycle_callsites=false

changed_files="$(git diff --no-renames --name-only "$base_sha" "$head_sha")"

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
done <<< "$changed_files"

# The lifecycle callsite gate covers whatever its scanner reads, which is far
# wider than the classifier suites. Ask the scanner's own scope predicate once
# for the whole changed-file list rather than mirroring it in shell patterns.
# The module path travels in the environment, not argv: a module path in
# argv[1] would make the scanner's isMainModule guard run the full scan.
run_lifecycle_callsites="$(printf '%s\n' "$changed_files" \
  | LIFECYCLE_SCANNER_MODULE="$SCRIPT_DIR/../ownership/check-lifecycle-callsites.mjs" \
    node --input-type=module -e '
      import { readFileSync } from "node:fs";
      import { pathToFileURL } from "node:url";
      const scanner = pathToFileURL(process.env.LIFECYCLE_SCANNER_MODULE).href;
      const { isLifecycleScannedPath } = await import(scanner);
      const files = readFileSync(0, "utf8").split("\n").filter(Boolean);
      process.stdout.write(String(files.some(isLifecycleScannedPath)));
    ')"

emit_outputs
