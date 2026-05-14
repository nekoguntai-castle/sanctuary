#!/usr/bin/env bash
# Sourceable library of file-classification predicates used by
# classify-test-changes.sh (KEY=VALUE emitter, legacy contract) and
# plan-test-run.sh (JSON emitter, Phase 3+ contract).
#
# Each function takes one argument — a repo-relative path string — and exits
# 0 (true) or 1 (false). The patterns must stay in lockstep across both
# emitters; that's the whole point of having one library.

if [ "${SANCTUARY_CI_CLASSIFY_FILES_LIB_LOADED:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi
SANCTUARY_CI_CLASSIFY_FILES_LIB_LOADED=1

is_frontend_file() {
  case "$1" in
    App.tsx|index.html|index.tsx|src/*|components/*|hooks/*|contexts/*|providers/*|services/*|themes/*|utils/*|shared/*|vitest.config.ts|vitest.coverage-shard.config.ts|scripts/ci/frontend-coverage-*.sh|package.json|package-lock.json|tests/*.ts|tests/*.tsx|tests/*.mts|tests/*.cts|tests/*.js|tests/*.jsx|tests/*.mjs|tests/*.cjs|tests/*.json)
      return 0
      ;;
  esac
  return 1
}

is_backend_file() {
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
    server/src/services/bitcoin/addressDerivation.ts|server/src/services/bitcoin/addressDerivation/*|server/src/services/bitcoin/psbtValidation.ts|server/src/services/bitcoin/psbtInfo.ts|server/src/services/bitcoin/validationEvidenceContracts.ts|server/src/services/bitcoin/transactions/broadcastContracts.ts|server/src/services/bitcoin/blockchain/broadcastPreflight.ts|server/src/api/transactions/broadcasting.ts|server/src/api/transactions/broadcastIntent.ts|server/src/middleware/auth.ts|server/src/services/accessControl.ts|server/tests/unit/services/bitcoin/addressDerivation.verified.test.ts|server/tests/unit/services/bitcoin/psbt.verified.test.ts|server/tests/unit/services/bitcoin/psbtValidation.test.ts|server/tests/unit/services/bitcoin/psbtInfo.test.ts|server/tests/unit/services/bitcoin/validationEvidenceContracts.test.ts|server/tests/unit/services/bitcoin/transactionServiceBroadcast/broadcastContracts.test.ts|server/tests/unit/services/bitcoin/blockchain/broadcastPreflight.test.ts|server/tests/unit/services/bitcoin/industry/broadcastSafety.test.ts|server/tests/unit/api/transactionsBroadcastIntent.test.ts|server/tests/unit/api/transactions-http-routes.test.ts|server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.broadcast.contracts.ts|server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.rawBroadcast.contracts.ts|server/tests/unit/middleware/auth.test.ts|server/tests/unit/services/accessControl.test.ts|server/stryker.critical.config.mjs|server/scripts/mutation/*|.github/mutation-baseline.json)
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
    e2e/*|playwright.config.ts)
      return 0
      ;;
  esac
  return 1
}

is_browser_smoke_file() {
  case "$1" in
    App.tsx|index.tsx|index.html|playwright.config.ts)
      return 0
      ;;
    src/app/*|src/api/*|components/Layout/*|components/Login/*|components/DraftList/*|components/AuditLogs/*|components/Monitoring/*|components/WalletDetail/*)
      return 0
      ;;
    e2e/*)
      case "$1" in
        e2e/render-regression.spec.ts|e2e/render-regression/*|e2e/render-regression.spec.ts-snapshots/*)
          return 1
          ;;
      esac
      return 0
      ;;
    server/src/api/*|server/src/routes.ts|server/src/index.ts|server/prisma/*)
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
    App.tsx|index.tsx|index.html|package.json|package-lock.json|playwright.config.ts)
      return 0
      ;;
    src/app/*|components/*|hooks/*|contexts/*|providers/*|themes/*|utils/*)
      return 0
      ;;
    e2e/render-regression.spec.ts|e2e/render-regression/*|e2e/render-regression.spec.ts-snapshots/*)
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
    Dockerfile|server/Dockerfile|vite.config.*|tsconfig*.json|server/tsconfig*.json)
      return 0
      ;;
    App.tsx|index.tsx|index.html|server/src/index.ts|server/prisma/*)
      return 0
      ;;
  esac
  return 1
}

is_test_file() {
  case "$1" in
    tests/*.test.ts|tests/*.test.tsx|tests/*.spec.ts|tests/*.spec.tsx|tests/llm-egress-proxy/*.test.ts|tests/llm-egress-proxy/*.spec.ts|server/tests/*.test.ts|server/tests/*.spec.ts|gateway/tests/*.test.ts|gateway/tests/*.spec.ts|e2e/*.spec.ts)
      return 0
      ;;
  esac
  return 1
}

is_test_suite_file() {
  case "$1" in
    .github/workflows/test.yml|scripts/ci/backend-integration-groups.sh|scripts/ci/browser-e2e-groups.sh)
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

# Anything that touches dependency manifests, root configs, or workflow files
# forces a full scan because the change blast-radius can't be inferred from
# directory placement alone.
is_full_scan_trigger_file() {
  case "$1" in
    package.json|package-lock.json|server/package.json|server/package-lock.json|gateway/package.json|gateway/package-lock.json|llm-egress-proxy/package.json|llm-egress-proxy/package-lock.json)
      return 0
      ;;
    vitest.config.*|vitest.coverage-shard.config.ts|server/vitest.config.*|gateway/vitest.config.*|llm-egress-proxy/vitest.config.*|tsconfig*.json|server/tsconfig*.json|gateway/tsconfig*.json)
      return 0
      ;;
    .github/workflows/*.yml|.github/workflows/*.yaml|.github/actions/*/action.yml)
      return 0
      ;;
  esac
  return 1
}
