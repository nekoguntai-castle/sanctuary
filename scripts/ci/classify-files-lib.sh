#!/usr/bin/env bash
# Sourceable library of file-classification predicates used by
# classify-test-changes.sh (CI scalar-output adapter) and plan-test-run.sh
# (local/developer JSON adapter).
#
# Each function takes one argument — a repo-relative path string — and exits
# 0 (true) or 1 (false). The patterns must stay in lockstep across both
# adapters; that is the purpose of having one predicate library.

if [ "${SANCTUARY_CI_CLASSIFY_FILES_LIB_LOADED:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi
SANCTUARY_CI_CLASSIFY_FILES_LIB_LOADED=1

is_frontend_file() {
  case "$1" in
    tests/e2e/*|tests/release/*)
      return 1
      ;;
  esac
  case "$1" in
    src/*|shared/*|config/tooling/vitest*.ts|scripts/ci/frontend-coverage-*.sh|scripts/ci/verify-jade-junit.mjs|scripts/perf/*|scripts/ci/setup-verifier-test-dependencies.sh|package.json|package-lock.json|tests/*.ts|tests/*.tsx|tests/*.mts|tests/*.cts|tests/*.js|tests/*.jsx|tests/*.mjs|tests/*.cjs|tests/*.json)
      return 0
      ;;
  esac
  return 1
}

is_backend_file() {
  case "$1" in
    server/.husky/*)
      return 1
      ;;
  esac
  case "$1" in
    server/*)
      return 0
      ;;
  esac
  return 1
}

is_backend_integration_file() {
  case "$1" in
    server/package.json|server/package-lock.json|server/vitest.config.ts|server/tsconfig*.json)
      return 0
      ;;
    server/prisma/*|server/tests/integration/*)
      return 0
      ;;
    # Phase 4 tier convention — *.integration.test.* anywhere under server/
    # routes to the backend_integration lane regardless of directory.
    # (In bash case patterns `*` matches across slashes, so this catches
    # any depth.)
    server/*.integration.test.*)
      return 0
      ;;
    server/src/api/*|server/src/routes.ts|server/src/index.ts)
      return 0
      ;;
    server/src/middleware/*|server/src/repositories/*)
      return 0
      ;;
    server/src/infrastructure/*|server/src/worker*|server/src/worker/*)
      return 0
      ;;
  esac
  return 1
}

is_critical_mutation_file() {
  case "$1" in
    server/src/services/bitcoin/addressDerivation.ts|server/src/services/bitcoin/addressDerivation/*|server/src/services/bitcoin/psbtValidation.ts|server/src/services/bitcoin/psbtInfo.ts|server/src/services/bitcoin/validationEvidenceContracts.ts|server/src/services/bitcoin/signingIntent/*|server/src/services/bitcoin/transactions/broadcastContracts.ts|server/src/services/bitcoin/transactions/broadcasting.ts|server/src/services/bitcoin/blockchain/broadcastPreflight.ts|server/src/services/bitcoin/blockchain/networkOperations.ts|server/src/repositories/transactionSigningIntentRepository.ts|server/src/api/transactions/broadcasting.ts|server/src/api/transactions/drafting.ts|server/src/api/drafts.ts|server/src/middleware/auth.ts|server/src/services/accessControl.ts|server/tests/unit/services/bitcoin/signingIntent/*|server/tests/unit/services/bitcoin/addressDerivation.verified.test.ts|server/tests/unit/services/bitcoin/psbt.verified.test.ts|server/tests/unit/services/bitcoin/psbtValidation.test.ts|server/tests/unit/services/bitcoin/psbtInfo.test.ts|server/tests/unit/services/bitcoin/validationEvidenceContracts.test.ts|server/tests/unit/services/bitcoin/transactionServiceBroadcast/broadcastContracts.test.ts|server/tests/unit/services/bitcoin/blockchain/broadcastPreflight.test.ts|server/tests/unit/services/bitcoin/industry/broadcastSafety.test.ts|server/tests/unit/api/transactions-http-routes.test.ts|server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.broadcast.contracts.ts|server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.rawBroadcast.contracts.ts|server/tests/unit/middleware/auth.test.ts|server/tests/unit/services/accessControl.test.ts|server/stryker.critical.config.mjs|server/scripts/mutation/*|.github/mutation-baseline.json)
      return 0
      ;;
  esac
  return 1
}

# shared/ is built into shared/dist and consumed by the frontend, server and
# gateway. It is deliberately not part of is_backend_file/is_gateway_file: those
# feed related-file lists that run `vitest related` from server/ or gateway/,
# where a shared/... path selects nothing. Callers set the lane flags directly.
is_shared_workspace_file() {
  case "$1" in
    shared/*)
      return 0
      ;;
  esac
  return 1
}

is_gateway_file() {
  case "$1" in
    gateway/*)
      return 0
      ;;
  esac
  return 1
}

is_llm_egress_proxy_file() {
  case "$1" in
    llm-egress-proxy/*|tests/llm-egress-proxy/*)
      return 0
      ;;
  esac
  return 1
}

is_e2e_file() {
  case "$1" in
    tests/e2e/*|config/tooling/playwright.config.ts)
      return 0
      ;;
  esac
  return 1
}

is_browser_smoke_file() {
  case "$1" in
    src/App.tsx|src/main.tsx|src/index.html|config/tooling/playwright.config.ts)
      return 0
      ;;
    src/app/*|src/api/*|src/components/Layout/*|src/components/Login/*|src/components/DraftList/*|src/components/AuditLogs/*|src/components/Monitoring/*|src/components/WalletDetail/*)
      return 0
      ;;
    tests/e2e/*)
      case "$1" in
        tests/e2e/render-regression.spec.ts|tests/e2e/render-regression/*|tests/e2e/render-regression.spec.ts-snapshots/*)
          return 1
          ;;
      esac
      return 0
      ;;
    server/src/api/*|server/src/routes.ts|server/src/index.ts|server/prisma/*|server/scripts/seed-browser-e2e.ts)
      return 0
      ;;
    server/src/middleware/auth.ts|server/src/middleware/csrf.ts|server/src/middleware/corsOrigin.ts|server/src/middleware/bodyParsing.ts|server/src/middleware/validate.ts)
      return 0
      ;;
  esac
  return 1
}

is_render_file() {
  case "$1" in
    src/App.tsx|src/main.tsx|src/index.html|package.json|package-lock.json|config/tooling/playwright.config.ts)
      return 0
      ;;
    src/app/*|src/components/*|src/hooks/*|src/contexts/*|src/providers/*|src/themes/*|src/utils/*)
      return 0
      ;;
    tests/e2e/render-regression.spec.ts|tests/e2e/render-regression/*|tests/e2e/render-regression.spec.ts-snapshots/*)
      return 0
      ;;
  esac
  return 1
}

is_build_file() {
  case "$1" in
    package.json|package-lock.json|server/package.json|server/package-lock.json)
      return 0
      ;;
    docker/frontend/Dockerfile|server/Dockerfile|config/tooling/vite.config.*|config/tooling/vite.nodePolyfills.ts|config/tooling/tsconfig*.json|server/tsconfig*.json)
      return 0
      ;;
    src/App.tsx|src/main.tsx|src/index.html|server/src/index.ts|server/prisma/*)
      return 0
      ;;
  esac
  return 1
}

is_test_file() {
  case "$1" in
    tests/release/*)
      return 1
      ;;
  esac
  case "$1" in
    tests/*.test.ts|tests/*.test.tsx|tests/*.spec.ts|tests/*.spec.tsx|tests/llm-egress-proxy/*.test.ts|tests/llm-egress-proxy/*.spec.ts|server/tests/*.test.ts|server/tests/*.spec.ts|gateway/tests/*.test.ts|gateway/tests/*.spec.ts)
      return 0
      ;;
  esac
  return 1
}

is_test_suite_file() {
  case "$1" in
    .github/workflows/test.yml|scripts/ci/backend-integration-groups.sh|scripts/ci/browser-e2e-groups.sh|scripts/ci/setup-verifier-test-dependencies.sh)
      return 0
      ;;
  esac
  return 1
}

is_docs_only_file() {
  case "$1" in
    *.md|*.mdx)
      return 0
      ;;
  esac
  return 1
}

# Root scripts/ci helpers that test.yml (or a composite action) executes, plus
# the scripts those helpers call or source. They wrap every lane, so the
# narrowest safe answer to "this file changed" is a full scan; a per-lane map
# would drift. Helpers with a dedicated, narrower predicate stay out of this
# list and keep that classification (checked first, below):
# backend-integration-groups.sh and browser-e2e-groups.sh (is_test_suite_file),
# frontend-coverage-*, setup-verifier-test-dependencies.sh and
# verify-jade-junit.mjs (is_frontend_file), and classify-quality-scope.sh
# (quality lane only).
is_test_lane_infrastructure_file() {
  case "$1" in
    scripts/ci/backend-integration-groups.sh|scripts/ci/browser-e2e-groups.sh|scripts/ci/frontend-coverage-*|scripts/ci/setup-verifier-test-dependencies.sh|scripts/ci/verify-jade-junit.mjs|scripts/ci/classify-quality-scope.sh)
      return 1
      ;;
    scripts/ci/aggregate-runner-locks.sh|\
    scripts/ci/backend-coverage-merge.sh|\
    scripts/ci/backend-coverage-shard.sh|\
    scripts/ci/bootstrap-node.sh|\
    scripts/ci/check-actions-cache-service.sh|\
    scripts/ci/check-critical-mutation-config.mjs|\
    scripts/ci/check-github-action-runtimes.mjs|\
    scripts/ci/check-integration-db.mjs|\
    scripts/ci/check-provider-leaks.sh|\
    scripts/ci/check-redis-service.mjs|\
    scripts/ci/classify-files-lib.sh|\
    scripts/ci/classify-integration-failure.sh|\
    scripts/ci/classify-test-changes.sh|\
    scripts/ci/cleanup-ci-callsite.sh|\
    scripts/ci/create-registered-staging.sh|\
    scripts/ci/ensure-go.sh|\
    scripts/ci/ensure-node.sh|\
    scripts/ci/ensure-python.sh|\
    scripts/ci/forward-live-annotations.mjs|\
    scripts/ci/install-playwright-chromium.sh|\
    scripts/ci/integration-db-guard.mjs|\
    scripts/ci/prepare-integration-db.sh|\
    scripts/ci/provider-context.mjs|\
    scripts/ci/provider-context.sh|\
    scripts/ci/redactor.sh|\
    scripts/ci/registered-collector-process.sh|\
    scripts/ci/registered-start-gate.mjs|\
    scripts/ci/related-test-args.sh|\
    scripts/ci/resolve-postgres-service.sh|\
    scripts/ci/resolve-redis-service.sh|\
    scripts/ci/retry-command.sh|\
    scripts/ci/retry-playwright-infrastructure-failure.sh|\
    scripts/ci/retry-vitest-infrastructure-failure.sh|\
    scripts/ci/run-browser-e2e-subject.sh|\
    scripts/ci/run-in-isolated-workspace.sh|\
    scripts/ci/run-with-log.sh|\
    scripts/ci/setup-server-dependencies.sh|\
    scripts/ci/time-command.sh|\
    scripts/ci/with-runner-lock.sh|\
    scripts/ci/write-diagnostic-summary.sh|\
    scripts/ci/write-empty-diagnostic-breadcrumb.sh)
      return 0
      ;;
  esac
  return 1
}

# Anything that touches dependency manifests, root configs, or the workflow
# definitions that shape the test lane forces a full scan, because the change
# blast-radius can't be inferred from directory placement alone.
#
# `full_scan` is a Test Suite concept: it drives the lane plan consumed by
# .github/workflows/test.yml. Only test.yml defines those lanes, so only test.yml
# is listed here. The other workflows (install-test, quality, architecture,
# docker-build, verify-vectors, podman-socket-canary, release-candidate) own
# separate lanes with their own triggers and classifiers, and editing them cannot
# change what test.yml runs — forcing a full test scan for them re-ran the three
# heaviest lanes for nothing.
#
# Composite actions stay in: test.yml consumes them, and a change to one can
# change how its jobs behave. Note `*` in a bash `case` pattern matches `/` too,
# so `.github/actions/*/action.yml` already covers the nested vendored composites
# under `.github/actions/vendor/...`; do not add deeper globs for them.
is_full_scan_trigger_file() {
  case "$1" in
    package.json|package-lock.json|server/package.json|server/package-lock.json|gateway/package.json|gateway/package-lock.json|llm-egress-proxy/package.json|llm-egress-proxy/package-lock.json|scripts/verify-addresses/package.json|scripts/verify-addresses/package-lock.json)
      return 0
      ;;
    config/tooling/*|server/vitest.config.*|gateway/vitest.config.*|llm-egress-proxy/vitest.config.*|server/tsconfig*.json|gateway/tsconfig*.json)
      return 0
      ;;
    .github/workflows/test.yml|.github/actions/*/action.yml)
      return 0
      ;;
  esac
  is_test_lane_infrastructure_file "$1"
}
