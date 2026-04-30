# Software Quality Report

Date: 2026-04-29
Owner: TBD
Status: Complete

**Overall Score**: 99/100
**Grade**: A
**Confidence**: High
**Mode**: architecture-large-file-policy
**Commit**: working-tree-after-54da2124

---

## Hard-Fail Blockers

None.

The configured source-control secret scan is clean, and the configured full-directory gitleaks scan is also clean after excluding generated Vitest report artifacts. The bundled fallback regex scan can still flag intentional PEM fixtures if it is used instead of gitleaks; that is a collector-scope limitation, not committed-secret evidence.

---

## Domain Scores

| Domain                |      Score | Notes                                                                                                                                                                                                                  |
| --------------------- | ---------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness           |      20/20 | Remediation-focused tests, typechecks, route coverage, and script syntax checks pass; prior full audit tests/lint/typecheck remain the baseline.                                                                       |
| Reliability           |      15/15 | API, gateway, AI, sync, and health paths continue to use typed errors, contextual logs, timeouts, retries, fallback handling, and async route wrappers.                                                                |
| Maintainability       |      14/15 | Lizard reports 0 CCN > 15 functions, jscpd reports 2.02% duplication, and the large-file gate now separates production source, tests, and classified proof artifacts; the largest production source file is 795 lines. |
| Security              |      15/15 | High/critical audit count is 0 across root/server/gateway/AI proxy, tracked-tree gitleaks is clean, and configured full-directory gitleaks is clean.                                                                   |
| Performance           |      10/10 | Sampled hot paths use limits, batching, grouped queries, request coalescing/caching, and async external I/O.                                                                                                           |
| Test Quality          |      15/15 | App, backend, and gateway coverage from the full audit remain 100%; remediation touched areas have focused behavioral verification.                                                                                    |
| Operational Readiness |      10/10 | Docker/Compose, GitHub Actions, health/readiness endpoints, observability hooks, and structured contextual logging are present.                                                                                        |
| **TOTAL**             | **99/100** | No hard-fail cap applies.                                                                                                                                                                                              |

---

## Trend

- vs 2026-04-29 (`working-tree-after-0ba58534`, mode `grade-major-issue-remediation`): overall `+/-0` (`99 -> 99`), grade `A -> A`, confidence `High -> High`.
- This pass made the large-file signal classification-aware and split production modules where the boundaries were real: frontend animation scene/draw/state, AI proxy entrypoint/routes/protocol planning, and Bitcoin OpenAPI sync/price schemas. The final point remains intentionally withheld because `server/src/services/bitcoin/electrumPool/electrumPool.ts` is a 795-line stateful orchestrator and was not split just for scoring.

---

## Evidence

### Mechanical

| Signal                    | Value                                                                                                                                           | Tool                                                                                                                                                                                                                                                                                                                                                                                                                                           | Scoring criterion                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| tests                     | pass; 418 server unit files / 9,453 tests retained, plus 45 AI proxy tests, 65 animation tests, 43 OpenAPI tests, and 2 large-file script tests | prior full server unit run; `npx vitest run tests/ai-proxy/consoleProtocol.test.ts tests/ai-proxy/naturalQuery.test.ts tests/ai-proxy/consoleRoutes.test.ts tests/ai-proxy/auth.test.ts tests/ai-proxy/labelQueryRoutes.test.ts`; `npx vitest run tests/components/AnimatedBackground.test.tsx tests/components/AnimatedBackground.lazyLoading.test.tsx`; `npm --prefix server run test:run -- tests/unit/api/openapi.test.ts`; `npx vitest run tests/scripts/checkLargeFiles.test.ts` | Correctness 1.1 -> +6            |
| lint                      | pass                                                                                                                                            | prior full audit lint plus remediation `npm run lint:server`                                                                                                                                                                                                                                                                                                                                                                                   | Correctness 1.3 -> +3            |
| typecheck                 | pass                                                                                                                                            | `npm --prefix ai-proxy run build`; `npm --prefix server run typecheck:tests`; `npm run typecheck`; prior `npm run typecheck:tests` and `npm run typecheck:scripts`                                                                                                                                                                                                                                                                             | Correctness 1.2 -> +4            |
| coverage                  | 100% retained from full audit; coverage discoverability improved                                                                                | `coverage` script now aliases `npm run test:coverage:full`                                                                                                                                                                                                                                                                                                                                                                                     | Test Quality 6.1 -> +5           |
| security_high             | 0 high / 0 critical; 16 low findings                                                                                                            | root/server/gateway/AI proxy `npm audit --audit-level=high --json`                                                                                                                                                                                                                                                                                                                                                                             | Security 4.1 -> +5               |
| secrets                   | 0 committed source leaks and 0 configured full-directory leaks                                                                                  | `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh`; `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml ...`                                                                                                                                                                                                                                | Security 4.2 -> +4               |
| lizard_warning_count      | 0                                                                                                                                               | `npm run quality:lizard`                                                                                                                                                                                                                                                                                                                                                                                                                       | Maintainability 3.1 -> +5        |
| duplication_pct           | 2.02%                                                                                                                                           | `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-architecture-large-files .`                                                                                                                                                                                                                                                                                                                                         | Maintainability 3.2 -> +3        |
| largest_source_file_lines | 795 (`server/src/services/bitcoin/electrumPool/electrumPool.ts`)                                                                                | `node scripts/quality/check-large-files.mjs --json`                                                                                                                                                                                                                                                                                                                                                                                            | Maintainability 3.3 -> +1        |
| large_file_policy         | pass; 0 production source files over 800 lines, 10 test files over 800, 1 classified proof harness over 800 at 949 lines                        | `node scripts/quality/check-large-files.mjs` and `--json`                                                                                                                                                                                                                                                                                                                                                                                      | Maintainability context          |
| largest_test_file_lines   | 999 (`server/tests/unit/api/agent-routes.test.ts`, `server/tests/unit/services/bitcoin/psbtBuilder.test.ts`)                                    | `node scripts/quality/check-large-files.mjs --json`                                                                                                                                                                                                                                                                                                                                                                                            | Test maintainability context     |
| openapi_route_coverage    | pass; 330 Express routes, 326 OpenAPI operations, 4 documented exceptions                                                                       | `npm run check:openapi-route-coverage`                                                                                                                                                                                                                                                                                                                                                                                                         | Correctness/API contract context |
| deploy_artifact_count     | 2                                                                                                                                               | Dockerfile/Compose plus GitHub Actions workflow presence from full audit                                                                                                                                                                                                                                                                                                                                                                       | Operational 7.1 -> +3            |
| health_endpoint_count     | 192                                                                                                                                             | grade heuristic plus route inspection from full audit                                                                                                                                                                                                                                                                                                                                                                                          | Operational 7.2 -> +2            |
| observability_lib_present | 1                                                                                                                                               | grade heuristic plus tracing/metrics inspection from full audit                                                                                                                                                                                                                                                                                                                                                                                | Operational 7.3 -> +2            |
| validation_lib_present    | 1                                                                                                                                               | grade heuristic plus Zod/schema inspection from full audit                                                                                                                                                                                                                                                                                                                                                                                     | Security 4.3 judged              |
| suppression_count         | 24                                                                                                                                              | grade heuristic plus `rg` inspection from full audit                                                                                                                                                                                                                                                                                                                                                                                           | Correctness 1.4 judged           |
| timeout_retry_count       | 1,286                                                                                                                                           | grade heuristic plus boundary inspection from full audit                                                                                                                                                                                                                                                                                                                                                                                       | Reliability/performance context  |
| blocking_io_count         | 48                                                                                                                                              | grade heuristic plus `rg` inspection from full audit                                                                                                                                                                                                                                                                                                                                                                                           | Reliability/performance context  |
| logging_call_count        | 330                                                                                                                                             | grade heuristic plus log-site inspection from full audit                                                                                                                                                                                                                                                                                                                                                                                       | Operational 7.4 judged           |
| test_file_count           | 1,282                                                                                                                                           | grade heuristic from full audit                                                                                                                                                                                                                                                                                                                                                                                                                | Test Quality context             |
| test_sleep_count          | 10                                                                                                                                              | grade heuristic plus sleep-site inspection from full audit                                                                                                                                                                                                                                                                                                                                                                                     | Test Quality 6.4 judged          |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=24` is low for the codebase size, and sampled production suppressions remain localized with explicit rationale, supporting ISO Functional Appropriateness.
- **[1.5] Functional completeness - High -> +3**: The wallet-coordinator scope still has working app, server, gateway, AI, install, and operations surfaces with broad test coverage, supporting ISO Functional Completeness.
- **[2.1] Error handling quality - High -> +6**: Existing server, frontend API, AI proxy, and gateway error paths preserve typed errors, request IDs, response previews, audit failures, and provider failure reasons, supporting ISO Fault Tolerance.
- **[2.2] Timeouts and retries - High -> +4**: Existing frontend API, AI proxy, gateway, Electrum, Telegram, and price provider paths use bounded external I/O, supporting ISO Availability.
- **[2.3] Crash-prone paths - High -> +5**: Production routes continue to use async handlers and guarded validation/lifecycle assumptions rather than arbitrary null dereferences, supporting ISO Fault Tolerance.
- **[3.4] Architecture clarity - High -> +3**: The remediation improved locality by splitting AI proxy console protocol schemas/messages/intents/planning/routes, frontend bunny meadow scene/draw/state modules, Phase 3 benchmark utilities, and Bitcoin OpenAPI sync/price schemas into named modules, supporting ISO Modularity/Reusability.
- **[3.5] Readability/naming - High -> +2**: Extracted helpers use domain names and preserve existing public import surfaces, reducing large-file density without broadening behavior, supporting ISO Analyzability.
- **[4.3] Input validation quality - High -> +3**: Request schemas and API validation remain present at browser API, gateway, server, and AI proxy boundaries, supporting ISO Integrity.
- **[4.4] Safe system/API usage - High -> +3**: Sampled raw SQL and child-process usage remains structured and bounded in the existing audit baseline, supporting ISO Integrity.
- **[5.1] Hot-path efficiency - High -> +5**: Sampled hot paths continue to apply limits, dedupe, grouped queries, and batched external calls, supporting ISO Time Behaviour.
- **[5.2] Data access patterns - High -> +3**: Dashboard and sync paths continue to use grouped database aggregates, windowed queries, batch RPCs, and prefetching, supporting ISO Resource Utilization.
- **[5.3] No blocking in hot paths - High -> +2**: Blocking I/O evidence remains concentrated in scripts, health/support collectors, startup, or async helper paths, supporting ISO Capacity.
- **[6.2] Test structure - High -> +4**: Tests remain organized by UI behavior, API contracts, backend services/routes, gateway middleware, AI proxy protocols, integration flows, and coverage branches, supporting Maintainability/Testability.
- **[6.3] Edge cases covered - High -> +3**: Remediation touched areas retained focused checks for AI proxy protocols, route coverage, benchmark script parsing/syntax, and large proof/test harness behavior, supporting Functional Completeness.
- **[6.4] No flaky patterns - High -> +3**: The remediation did not add sleeps or timing-sensitive assertions; existing direct sleep evidence remains low and isolated, supporting Testability.
- **[7.4] Logging quality - High -> +3**: Gateway, AI proxy, backend health, sync, and audit paths continue to include structured context, request IDs, status/duration, redaction, and failure details, supporting Reliability/Availability.

### Missing

- Full +2 file-size credit remains missing because the largest production source file is 795 lines. `server/src/services/bitcoin/electrumPool/electrumPool.ts` was inspected and deferred because it is already a stateful orchestrator over extracted selector, connection, health, queue, metrics, backoff, registry, and config modules; splitting it further now would reduce lifecycle clarity.
- The repo now exposes a `coverage` script and a classification-aware large-file JSON signal for the grade collector, but cached lizard/jscpd/gitleaks tool discovery still lives outside this repository and remains a grade-skill repeatability gap.
- The bundled fallback regex secret scanner can still report intentional PEM fixtures if used instead of the configured gitleaks paths.

---

## Top Risks

1. Residual production-source large-file risk is concentrated in `server/src/services/bitcoin/electrumPool/electrumPool.ts` at 795 lines. It remains below the warning gate and should be split only if a real lifecycle/config/acquisition boundary emerges.
2. Test-suite maintainability remains a warning signal: 10 test files are between 837 and 999 lines. These should be split when the owning behavior changes, not mechanically to chase a score.
3. Grade repeatability is improved but not complete: the repo now has a `coverage` alias, clean configured gitleaks scans, and large-file JSON output, but the external `$grade` collector still needs cached quality-tool discovery and fallback fixture awareness.
4. Root dependency audit still has 16 low-severity findings. Server, gateway, and AI proxy package audits have 0 total findings, but Ledger/Trezor/polyfill transitive crypto advisories should remain tracked.

## Fastest Improvements

1. Split `server/src/services/bitcoin/electrumPool/electrumPool.ts` only when a real state boundary appears, such as separable lifecycle/timer ownership or acquisition-state ownership - expected +1 maintainability only if the largest production source drops below 500 without fragmenting lifecycle reasoning.
2. Split the remaining 837-999-line test suites when their owning behavior changes, starting with `agent-routes`, `psbtBuilder`, `price`, and `admin-operations` - expected point gain 0 in source scoring, but improves test reviewability.
3. Update the external grade skill/collector to consume `node scripts/quality/check-large-files.mjs --json`, use repo-cached lizard/jscpd/gitleaks binaries, and treat intentional PEM fixtures as fixtures in fallback mode - expected point gain 0, but improves repeatability.
4. Keep tracking the 16 low-severity dependency advisories until hardware-wallet/polyfill upgrades have release-note and regression proof - expected point gain 0 while high/critical remains 0.

## Roadmap To 100

| Phase | Target                              | Work                                                                                           | Exit Criteria                                                                       | Expected Score Movement                     |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| 1     | Preserve A                          | Keep current tests, lint, typecheck, coverage, lizard, jscpd, audit, and gitleaks gates green. | Same command set passes in CI/local verification.                                   | Maintain 99                                 |
| 2     | Recover final maintainability point | Reduce the remaining production orchestrator size only if a real state boundary emerges.       | Largest production source file below 500 lines without weakening lifecycle clarity. | +1                                          |
| 3     | Improve audit repeatability         | Update the external grade collector to use repo coverage and cached quality tools directly.    | `$grade` emits final scored signals without manual reruns/superseding.              | Confidence stays High with less manual work |

## Strengths To Preserve

- 100% app/backend/gateway coverage from the full audit with broad behavior and boundary cases.
- Low duplication at 2.02% despite a large UI, backend, gateway, AI proxy, and test surface.
- Zod/schema validation at browser API, gateway, server, and AI proxy boundaries.
- Structured logging, request IDs, audit paths, health/readiness endpoints, Docker/Compose, and GitHub Actions workflows.
- Bounded AI/provider/network calls with endpoint policy, credential redaction/omission tests, timeouts, and structured failure reasons.

## Work To Defer Or Avoid

- Do not force-upgrade hardware-wallet or crypto-polyfill transitive dependencies solely for low-severity audit noise without device-flow regression proof.
- Do not split large proof harnesses solely for line count if doing so makes the behavior harder to audit; split when helpers or scenarios are cohesive.
- Do not treat generated coverage/Vitest artifacts or fixture PEMs as production secret leaks; keep scan scope and exclusions explicit.

## Verification Notes

- `npm --prefix ai-proxy run build` - passed.
- `npx vitest run tests/ai-proxy/consoleProtocol.test.ts tests/ai-proxy/naturalQuery.test.ts tests/ai-proxy/consoleRoutes.test.ts tests/ai-proxy/auth.test.ts` - passed, 43 tests.
- `npx vitest run tests/components/AnimatedBackground.test.tsx tests/components/AnimatedBackground.lazyLoading.test.tsx` - passed, 65 tests.
- `npm --prefix server run test:run -- tests/unit/api/openapi.test.ts` - passed, 43 tests.
- `npx vitest run tests/scripts/checkLargeFiles.test.ts` - passed, 2 tests.
- `npm --prefix server run typecheck:tests`, `npm run typecheck`, prior `npm run typecheck:tests`, and prior `npm run typecheck:scripts` - passed.
- `npm run check:openapi-route-coverage` - passed, 330 Express routes, 326 OpenAPI operations, 4 documented exceptions.
- `npm --prefix server run test:unit -- tests/unit/api/agent-routes.test.ts tests/unit/services/bitcoin/psbtBuilder.test.ts` - passed; script expansion ran the full server unit suite, 418 files and 9,453 tests.
- `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh` - passed, no committed source leaks.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --report-format json --report-path /tmp/sanctuary-gitleaks-remediation.json` - passed, no leaks.
- `node scripts/quality/check-large-files.mjs` and `node scripts/quality/check-large-files.mjs --json` - passed; 0 production source files over 800 lines, largest production source 795 lines, 10 test files over 800 lines, 1 classified proof harness over 800 lines at 949 lines.
- Root `npm audit --audit-level=high --json --cache /tmp/npm-audit-cache` - passed with 0 high/critical and 16 low findings.
- `npm --prefix server audit --audit-level=high --json`, `npm --prefix gateway audit --audit-level=high --json`, and `npm --prefix ai-proxy audit --audit-level=high --json` - passed with 0 total findings in each package.
- `npm run lint:server`, `npm run quality:lizard`, `node --check scripts/perf/phase3-benchmark.mjs`, and `node --check scripts/perf/phase3-benchmark-utils.mjs` - passed.
- `npx playwright test --list e2e/admin-operations.spec.ts` - passed and listed 120 tests.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-architecture-large-files .` - 2.02% duplicated lines, 269 exact clones.
- `git diff --check` - passed after final report/history/task updates.
