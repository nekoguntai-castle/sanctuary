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
    src/*|shared/*|config/tooling/vitest*.ts|scripts/ci/frontend-coverage-*.sh|scripts/ci/verify-jade-junit.mjs|scripts/perf/*|scripts/ci/setup-verifier-test-dependencies.sh|package.json|package-lock.json|tests/*.ts|tests/*.tsx|tests/*.mts|tests/*.cts|tests/*.js|tests/*.jsx|tests/*.mjs|tests/*.cjs|tests/*.json|README.md|scripts/templates/README.template.md|docs/architecture/generated/frontend.md|docs/reference/generated/hardware-wallet-compatibility.md|docs/reference/generated/hardware-wallet-compatibility.json)
      return 0
      ;;
  esac
  is_root_vitest_input_file "$1"
}

# Repo files outside the frontend trees that a root Vitest suite reads (by
# readFileSync, a relative import, or an import reached transitively from one).
# Exact paths only, never directory globs: a glob would also claim proof inputs
# that verify-vectors re-runs and would weaken the test.yml script drift check.
# tests/ci/vitestRepoInputsClassified.test.ts keeps the list honest; add a path
# here when it reports one. server/src/** stays out (a known residual).
# POSIX sh: the pre-commit hook sources this library under sh.
is_root_vitest_input_file() {
  case "$1" in
    .github/workflows/verify-vectors.yml|\
    .nvmrc|\
    config/address-key-corpus-sources.json|\
    config/hardware-physical-evidence-trust.json|\
    config/hardware-wallet-implementation-inventory.json|\
    config/jade-emulator-proof.json|\
    config/jade-protocol-harness.json|\
    config/ledger-emulator/Dockerfile|\
    config/ledger-emulator/automation.json|\
    config/ledger-emulator/proof.json|\
    config/signing-dependency-scope.json|\
    config/trezor-emulator-proof.json|\
    docker-compose.yml|\
    docker/compose/tor.yml|\
    docker/monitoring/alert_rules.yml|\
    docker/monitoring/grafana/dashboards/sanctuary-wallet-sync.json|\
    docker/monitoring/loki-config.yml|\
    docker/monitoring/promtail-config.yml|\
    docker/nginx/default-ssl.conf.template|\
    docker/nginx/default.conf.template|\
    docker/nginx/docker-entrypoint.sh|\
    docker/tor/payjoin-ingress.conf|\
    docs/architecture/containers.md|\
    docs/site/package-lock.json|\
    docs/site/package.json|\
    docs/site/src/plugins/remark-mermaid-click-rewrite.mjs|\
    scripts/architecture/extract-call-graphs.mjs|\
    scripts/architecture/generate-graphs.mjs|\
    scripts/check-architecture-boundaries.mjs|\
    scripts/check-bitcoin-network-boundaries.mjs|\
    scripts/check-safety-catch-guards.mjs|\
    scripts/check-server-cycle-baseline.mjs|\
    scripts/ci/check-trezor-transport-provenance.sh|\
    scripts/ci/docker-endpoint-lib.sh|\
    scripts/ci/docker-exec-tcp-forwarder.mjs|\
    scripts/ci/download-verified-source.sh|\
    scripts/ci/hardware-compatibility-report.ts|\
    scripts/ci/jade-vendor-protocol-harness.py|\
    scripts/ci/resolve-trezor-publish-binding.sh|\
    scripts/ci/run-jade-emulator-proof.sh|\
    scripts/ci/run-jade-protocol-harness.sh|\
    scripts/ci/run-ledger-emulator-proof.sh|\
    scripts/ci/run-psbt-core-subject.sh|\
    scripts/ci/run-trezor-emulator-proof.sh|\
    scripts/ci/validate-jade-protocol-manifest.jq|\
    scripts/demo/lib/api-client.mjs|\
    scripts/demo/lib/env.mjs|\
    scripts/demo/lib/seed.mjs|\
    scripts/demo/manifest.json|\
    scripts/diagnose-wallet-sync.sh|\
    scripts/generate-address-key-corpora.mjs|\
    scripts/generate-readme.sh|\
    scripts/generate-signer-inventory.mjs|\
    scripts/ops/runtime-environment.mjs|\
    scripts/quality/architecture-boundary-exceptions.json|\
    scripts/quality/architecture-exception-budget.mjs|\
    scripts/quality/bitcoin-network-boundary-allowlist.json|\
    scripts/quality/check-large-files.mjs|\
    scripts/quality/check-semgrep-baseline.mjs|\
    scripts/quality/large-file-classification.json|\
    scripts/quality/safety-catch-allowlist.json|\
    scripts/quality/server-cycle-baseline.json|\
    scripts/release/canary/fleet-manifest.json|\
    scripts/support-package-runner.mjs|\
    scripts/verify-addresses/docker-compose.yml|\
    scripts/verify-addresses/generate-vectors.ts|\
    scripts/verify-addresses/implementations/bitcoincore.ts|\
    scripts/verify-addresses/implementations/bitcoinjs.ts|\
    scripts/verify-addresses/implementations/go-verify.go|\
    scripts/verify-addresses/implementations/go.mod|\
    scripts/verify-addresses/implementations/go.sum|\
    scripts/verify-addresses/implementations/go.ts|\
    scripts/verify-addresses/implementations/python-verify.py|\
    scripts/verify-addresses/implementations/python.ts|\
    scripts/verify-addresses/output/verified-vectors.ts|\
    scripts/verify-addresses/outputFile.ts|\
    scripts/verify-addresses/python-verifier.Dockerfile|\
    scripts/verify-addresses/requirements.in|\
    scripts/verify-addresses/requirements.lock|\
    scripts/verify-addresses/sourceManifest.ts|\
    scripts/verify-addresses/standardsOracle.ts|\
    scripts/verify-addresses/testCases.ts|\
    scripts/verify-addresses/types.ts|\
    scripts/verify-addresses/verify-repeatable.sh|\
    scripts/verify-addresses/xpub.ts|\
    scripts/verify-psbt/implementations/bitcoincore.ts|\
    scripts/verify-psbt/package-lock.json|\
    scripts/verify-psbt/package.json|\
    scripts/verify-psbt/proof-manifest.json|\
    scripts/verify-psbt/provenance.ts|\
    scripts/verify-psbt/types.ts|\
    server/Dockerfile|\
    server/prisma/schema.prisma|\
    server/prisma/seed.ts|\
    server/tests/fixtures/bip173-bip350-test-vectors.ts|\
    server/tests/fixtures/bip174-test-vectors.ts|\
    server/tests/fixtures/bip32-test-vectors.ts|\
    server/tests/fixtures/bitcoin-core-key-io-vectors.ts|\
    server/tests/fixtures/generated-psbt-vectors.ts|\
    server/tests/fixtures/generated-signed-psbt-vectors.ts|\
    server/tests/fixtures/generated/address-key-corpora.ts|\
    server/tests/fixtures/hardware-signed-psbt-vectors.ts|\
    server/tests/fixtures/verified-address-vectors.ts|\
    server/tests/helpers/hardwareSignedEvidenceProvenance.ts|\
    server/tests/helpers/hardwareSignedFixtureIntake.ts|\
    server/tests/helpers/hardwareSignedPolicyBinding.ts|\
    server/tests/helpers/hardwareSignedPsbtReplay.ts)
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

# Repo files outside server/ that a server/tests Vitest suite reads. Adapters
# treat a match like is_backend_file (lane flag and backend_files entry). Every
# entry is also a root Vitest input. Kept honest by
# tests/ci/vitestRepoInputsClassified.test.ts.
is_backend_vitest_input_file() {
  case "$1" in
    config/hardware-physical-evidence-trust.json|config/jade-emulator-proof.json|config/jade-protocol-harness.json|scripts/verify-psbt/proof-manifest.json)
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
    # Every test-tree input the named critical entries (CRITICAL_TEST_FILES)
    # load: contracts files, harnesses, shared fixtures/helpers/mocks, the
    # Vitest setup and config. Kept complete by
    # scripts/ci/check-critical-mutation-config.mjs (D-12.C4). The default
    # Vitest runner can also kill critical mutants from other server tests;
    # a change to one of those is re-proved by the scheduled full scan, not on
    # the PR that makes it.
    server/tests/unit/services/bitcoin/psbtValidation/*|server/tests/unit/middleware/auth/*|server/tests/unit/api/transactionsHttpRoutes/*|server/tests/unit/services/bitcoin/transactionServiceBroadcast/*|server/tests/unit/api/transactionsSigningIntentBroadcast*.test.ts|server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts|server/tests/unit/repositories/transactionSigningIntentRepository.test.ts|server/tests/unit/services/accessControl.resource-access.contracts.ts)
      return 0
      ;;
    server/tests/fixtures/bip174-test-vectors.ts|server/tests/fixtures/bitcoin.ts|server/tests/fixtures/generated-psbt-vectors.ts|server/tests/fixtures/generated-signed-psbt-vectors.ts|server/tests/fixtures/verified-address-vectors.ts|server/tests/helpers/testUtils.ts|server/tests/helpers/validatedBroadcastArtifact.ts|server/tests/mocks/prisma.ts|server/tests/setup.ts|server/vitest.config.ts)
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
    # Exact shared e2e files the render harness imports (D-11.17); kept in sync
    # by tests/ci/renderHarnessInputsClassified.test.ts. Not a fixtures glob:
    # browser-only fixtures must not select the render lane.
    tests/e2e/helpers.ts|tests/e2e/apiSimulator.ts|tests/e2e/fixtures/apiBaseline.ts|tests/e2e/fixtures/balanceHistory.ts)
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

# Wallet-safety critical paths: the manifest at
# config/wallet-safety-critical-paths.json lists every path whose change must
# re-run the funds-safety proofs, including some documentation (an ADR hashed
# into the Jade proof sources). The manifest is resolved from this library's own
# location, never the cwd, so fixture repos that copy only the scripts resolve
# the same way. The matcher mirrors matchesClassifierPath in
# check-wallet-safety-classifier.mjs (`**` any characters, `*` any characters
# except `/`, everything else literal, anchored); a parity test keeps them in
# step. The verify-vectors job is bash + git only, so this reads the manifest
# with POSIX tools and needs no jq or node.
# The pre-commit hook sources this library from a POSIX shell, so this block is
# POSIX sh: no arrays, process substitution or [[ ]]. Under sh there is no
# BASH_SOURCE, and the hook's REPO_ROOT locates the manifest instead.
if [ -n "${BASH_SOURCE:-}" ]; then
  SANCTUARY_CI_WALLET_SAFETY_MANIFEST="$(cd "$(dirname "$BASH_SOURCE")/../.." && pwd)/config/wallet-safety-critical-paths.json"
else
  SANCTUARY_CI_WALLET_SAFETY_MANIFEST="${REPO_ROOT:-.}/config/wallet-safety-critical-paths.json"
fi
SANCTUARY_CI_WALLET_SAFETY_REGEX=
SANCTUARY_CI_WALLET_SAFETY_REGEX_LOADED=0

# One ERE alternation of every manifest pattern: regex metacharacters escaped,
# then `**` -> `.*` and `*` -> `[^/]*` (the placeholder keeps `**` from being
# rewritten twice; no manifest path contains `@`).
load_wallet_safety_regex() {
  [ "$SANCTUARY_CI_WALLET_SAFETY_REGEX_LOADED" = "0" ] || return 0
  SANCTUARY_CI_WALLET_SAFETY_REGEX_LOADED=1
  [ -r "$SANCTUARY_CI_WALLET_SAFETY_MANIFEST" ] || return 0
  SANCTUARY_CI_WALLET_SAFETY_REGEX=$(
    sed -n '/"paths"[[:space:]]*:[[:space:]]*\[/,/\]/p' "$SANCTUARY_CI_WALLET_SAFETY_MANIFEST" \
      | sed -n 's/^[[:space:]]*"\([^"]*\)"[[:space:]]*,\{0,1\}[[:space:]]*$/\1/p' \
      | sed -e 's/[].+^${}()|[\\]/\\&/g' -e 's/\*\*/@@ANY@@/g' -e 's/\*/[^\/]*/g' -e 's/@@ANY@@/.*/g' \
      | paste -sd '|' -
  )
}

# Fail closed: a missing, unreadable or empty manifest makes every path critical.
is_wallet_safety_critical_file() {
  load_wallet_safety_regex
  [ -n "$SANCTUARY_CI_WALLET_SAFETY_REGEX" ] || return 0
  printf '%s\n' "$1" | grep -Eq "^(${SANCTUARY_CI_WALLET_SAFETY_REGEX})\$"
}

# Hardware emulator proof sources: config/hardware-emulator-source-inventory.json
# lists every file (and `shared/**`-style pattern) hashed into the emulator proof
# sources, including documentation. A docs-only change to one breaks the next
# proof, so the docs allowlists treat them like wallet-safety critical paths.
# Unlike the wallet-safety manifest, arrays are sometimes inline, so this takes
# every quoted string on each line and drops the object keys (strings followed
# by `:`). Same location rule, escape chain and fail-closed behaviour as above.
if [ -n "${BASH_SOURCE:-}" ]; then
  SANCTUARY_CI_HARDWARE_PROOF_INVENTORY="$(cd "$(dirname "$BASH_SOURCE")/../.." && pwd)/config/hardware-emulator-source-inventory.json"
else
  SANCTUARY_CI_HARDWARE_PROOF_INVENTORY="${REPO_ROOT:-.}/config/hardware-emulator-source-inventory.json"
fi
SANCTUARY_CI_HARDWARE_PROOF_REGEX=
SANCTUARY_CI_HARDWARE_PROOF_REGEX_LOADED=0

load_hardware_proof_regex() {
  [ "$SANCTUARY_CI_HARDWARE_PROOF_REGEX_LOADED" = "0" ] || return 0
  SANCTUARY_CI_HARDWARE_PROOF_REGEX_LOADED=1
  [ -r "$SANCTUARY_CI_HARDWARE_PROOF_INVENTORY" ] || return 0
  SANCTUARY_CI_HARDWARE_PROOF_REGEX=$(
    awk -F'"' '{
      for (i = 2; i < NF; i += 2) {
        if ($(i + 1) !~ /^[ \t]*:/) print $i
      }
    }' "$SANCTUARY_CI_HARDWARE_PROOF_INVENTORY" \
      | sed -e 's/[].+^${}()|[\\]/\\&/g' -e 's/\*\*/@@ANY@@/g' -e 's/\*/[^\/]*/g' -e 's/@@ANY@@/.*/g' \
      | paste -sd '|' -
  )
}

# Fail closed: a missing, unreadable or empty inventory makes every path a proof source.
is_hardware_proof_source_file() {
  load_hardware_proof_regex
  [ -n "$SANCTUARY_CI_HARDWARE_PROOF_REGEX" ] || return 0
  printf '%s\n' "$1" | grep -Eq "^(${SANCTUARY_CI_HARDWARE_PROOF_REGEX})\$"
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
is_test_lane_excluded_file() {
  case "$1" in
    scripts/ci/backend-integration-groups.sh|scripts/ci/browser-e2e-groups.sh|scripts/ci/frontend-coverage-*|scripts/ci/setup-verifier-test-dependencies.sh|scripts/ci/verify-jade-junit.mjs|scripts/ci/classify-quality-scope.sh)
      return 0
      ;;
  esac
  return 1
}

is_test_lane_infrastructure_file() {
  is_test_lane_excluded_file "$1" && return 1
  case "$1" in
    scripts/ci/aggregate-runner-locks.sh|\
    scripts/ci/backend-coverage-merge.sh|\
    scripts/ci/backend-coverage-shard.sh|\
    scripts/ci/bootstrap-node.sh|\
    scripts/ci/check-actions-cache-service.sh|\
    scripts/ci/action-runtime-workflow-guards.mjs|\
    scripts/ci/check-critical-mutation-config.mjs|\
    scripts/ci/check-github-action-runtimes.mjs|\
    scripts/ci/check-integration-db.mjs|\
    scripts/ci/check-provider-leaks.sh|\
    scripts/ci/check-redis-service.mjs|\
    scripts/ci/classify-files-lib.sh|\
    scripts/ci/classify-integration-failure.sh|\
    scripts/ci/classify-test-changes.sh|\
    scripts/ci/cleanup-ci-callsite.sh|\
    scripts/ci/create-isolated-workspace.sh|\
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
    scripts/ci/record-command-timing.mjs|\
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
    scripts/ci/subject-budget.mjs|\
    scripts/ci/time-command.sh|\
    scripts/ci/with-runner-lock.sh|\
    scripts/ci/write-diagnostic-summary.sh|\
    scripts/ci/write-empty-diagnostic-breadcrumb.sh|\
    scripts/lib/is-main-module.mjs|\
    .github/ci-performance-budget.json)
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
# Workflows a Vitest suite reads (verify-vectors.yml) are exact-path frontend
# inputs (is_root_vitest_input_file), not full-scan triggers, and proof inputs
# re-run through verify-vectors (classify-verify-vectors-scope.sh), not a full scan.
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
