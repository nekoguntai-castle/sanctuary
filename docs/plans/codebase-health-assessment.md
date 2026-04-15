# Software Quality Report

Date: 2026-04-14 (Pacific/Honolulu)
Owner: TBD
Status: Draft

**Overall Score**: 91/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: working tree after 4558470a

The hard-fail caps from the prior run remain cleared. The score is unchanged from the last `91/A` working-tree assessment, but the evidence is stronger: oversized proof/generated files are classified, dependency advisory debt is freshly triaged, full Docker install/upgrade e2e proof passed with external runtime secrets, browser-auth drift is executable, architecture dependency boundaries are enforced, Express route coverage is checked against OpenAPI in `npm run quality`, server background lifecycle wiring is tested, direct route-to-repository imports are blocked for new API routes, the route-to-repository exception baseline is lower after the admin settings, admin monitoring, admin group, and wallet policy service extractions, selected OpenAPI response-key parity guards cover admin settings/monitoring/groups and wallet policy response envelopes, and the Phase 3 generated capacity proof passed after the lifecycle/startup change.

---

## Hard-Fail Blockers

None.

Notes:

- `npm run test:coverage` passes `388` test files and `5505` tests with `100%` statements, branches, functions, and lines.
- Full working-tree, tracked-tree, and latest-commit `gitleaks` scans are clean.
- The quality gate's high-severity audit lane passes for root, server, and gateway packages. Remaining lower-severity debt is triaged in `docs/DEPENDENCY_AUDIT_TRIAGE.md`: root has `16` low, server has `3` moderate through Prisma tooling, gateway has `8` low in full installs and `0` vulnerabilities with production optional dependencies omitted.
- The bundled `grade.sh` fallback secret scan still reports placeholder-like matches, but the configured `gitleaks` scans are the higher-confidence security source for this report.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Tests, typecheck, lint, browser-auth contract checks, architecture-boundary checks, OpenAPI route coverage, lifecycle wiring tests, and the browser-auth coverage gate pass. Suppression density remains low for the repo size and no active functional regression is visible in the measured suite. |
| Reliability | 12/15 | Error handling and timeout/retry patterns are strong, including centralized auth-refresh policy and external-call backoff. Deductions remain for cold-path `process.exit` usage and some non-null assumptions in authenticated route code. |
| Maintainability | 13/15 | Duplication is low at `2.21%`, the boundary checker passes `9` dependency rules across `1281` files and `5386` imports with `45` documented route-to-repository exceptions, naming is readable, and pinned `lizard 1.21.2` reports `0` warnings with `avg_ccn=1.35` and `max_ccn=15`. The largest physical file is now `2637` lines after the proof harness TLS fix, so mechanical god-file scoring remains capped even though every `>1000` line file is classified as proof/generated/test-fixture. |
| Security | 14/15 | No high/critical audit findings and no `gitleaks` findings. Zod validation, CSRF/cookie policy, redaction, auth boundaries, and maintenance disk probing use safer fixed-argument paths; remaining deduction is for low/moderate dependency advisory debt. |
| Performance | 9/10 | Request-facing paths use batching, async I/O, AbortSignal timeouts, retries, and backoff, and the Phase 3 generated capacity proof passed with 25k synthetic transactions and 100/100 two-backend WebSocket fanout. Remaining synchronous or shell/process work appears mostly in startup, admin, support, or maintenance paths. |
| Test Quality | 13/15 | Coverage is now measured at `100%`, and the suite has broad behavioral and edge-case coverage. Notification toast timing and sidebar retry noise were reduced, but deductions remain for broader sleep/time patterns and recurring React `act(...)`/jsdom capability warnings. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability hooks, structured logging, redaction, runbooks, runtime-secret documentation, and full install/upgrade e2e proof are present. |
| **TOTAL** | **91/100** | Grade A; no hard-fail cap applied. |

---

## Trend

- vs 2026-04-14 (`cdfa959c`): overall `+22` (`69 -> 91`), grade `D -> A`, confidence `Medium -> High`.
- vs latest full pre-follow-up report (`87/B`): overall `+4` from measured complexity and safer maintenance process execution.
- vs prior working-tree report (`91/A`): overall `+0`; score is stable while evidence improved through large-file classification, dependency triage, Docker install/upgrade e2e proof, browser-auth contract checks, architecture-boundary checks, OpenAPI route coverage checks, lifecycle wiring tests, route-to-repository boundary enforcement, admin settings, admin monitoring, admin group, and wallet policy service extraction, selected admin/wallet policy OpenAPI response-key parity, reduced test-suite noise, and fresh Phase 3 generated capacity proof.
- Hard-fail movement: `tests=fail -> pass`, `secrets=7 -> 0`, `coverage=unknown -> 100`.
- Architecture-first movement: browser auth policy is centralized in `src/api/authPolicy.ts`; runtime secrets live outside the checkout by default; `docs/RUNTIME_SECRETS.md` defines the local runtime-secret contract; `server/src/services/maintenance/diskMonitoring.ts` uses `execFile` with fixed args; `server/src/infrastructure/accessCache.ts`, `server/src/validation/commonSchemas.ts`, and `server/src/services/health/` lower dependency direction; `npm run quality` owns repeatable quality and architecture evidence.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass | `npm run test:coverage`; `388` files / `5505` tests passed | Correctness 1.1 |
| lint | pass | `npm run lint` | Correctness 1.3 |
| typecheck | pass | `npm run typecheck` | Correctness 1.2 |
| browser_auth_contract | pass | `npm run check:browser-auth-contract`; `545` browser files scanned | Correctness 1.5 / Security 4.3 |
| architecture_boundaries | pass | `npm run check:architecture-boundaries`; `1281` files / `5386` imports / `9` rules / `45` exceptions scanned | Maintainability 3.4 |
| openapi_route_coverage | pass | `npm run check:openapi-route-coverage`; `288` Express routes / `284` OpenAPI operations / `4` documented exceptions | Correctness 1.5 / Maintainability 3.4 |
| lifecycle_wiring | pass | `npm --prefix server run test:run -- tests/unit/services/serverBackgroundServices.test.ts tests/unit/services/serviceRegistry.test.ts tests/unit/services/startupManager.test.ts`; `31` tests | Reliability 2.2 / Maintainability 3.4 |
| route_repository_boundary | pass | `npm run check:architecture-boundaries`; new direct API route-to-repository imports fail unless documented, current exception baseline `45` | Maintainability 3.4 |
| admin_settings_service_boundary | pass | `npm --prefix server run test:run -- tests/unit/services/adminSettingsService.test.ts`; settings defaults, redaction, encryption, cache clearing, and threshold validation live behind `server/src/services/adminSettingsService.ts` | Maintainability 3.4 / Security 4.3 |
| admin_settings_openapi_runtime_key_parity | pass | `npx vitest run tests/unit/api/admin-routes.test.ts`; GET `/api/v1/admin/settings` asserts runtime response keys are documented by the `AdminSettings` OpenAPI schema | Correctness 1.5 |
| admin_monitoring_service_boundary | pass | `npm --prefix server run test:run -- tests/unit/services/adminMonitoringService.test.ts`; monitoring URL overrides, Grafana settings, and health-status lookup live behind `server/src/services/adminMonitoringService.ts` | Maintainability 3.4 / Operational Readiness 7.4 |
| admin_monitoring_openapi_runtime_key_parity | pass | `npx vitest run tests/unit/api/admin-monitoring-routes.test.ts`; GET `/api/v1/admin/monitoring/services` asserts response and service item runtime keys are documented by OpenAPI schemas | Correctness 1.5 |
| admin_group_service_boundary | pass | `npm --prefix server run test:run -- tests/unit/services/adminGroupService.test.ts`; group persistence, member validation, membership mutation, and access-cache invalidation live behind `server/src/services/adminGroupService.ts` | Maintainability 3.4 / Security 4.3 |
| admin_group_openapi_runtime_key_parity | pass | `npx vitest run tests/unit/api/admin-routes.test.ts`; GET `/api/v1/admin/groups` asserts group and member runtime keys are documented by OpenAPI schemas | Correctness 1.5 |
| wallet_policy_service_boundary | pass | `npm --prefix server run test:run -- tests/unit/services/vaultPolicyService.test.ts`; wallet policy listing, event lookup, and address list mutations route through `server/src/services/vaultPolicy/vaultPolicyService.ts` | Maintainability 3.4 / Security 4.3 |
| wallet_policy_openapi_runtime_key_parity | pass | `npx vitest run tests/unit/api/openapi.test.ts`; wallet policy event/evaluation/list/detail/address/delete response envelopes assert documented runtime keys | Correctness 1.5 |
| phase3_compose_capacity_proof | pass | `docs/plans/phase3-compose-benchmark-smoke-2026-04-15T06-25-20-675Z.md`; 25k synthetic tx, p95 `70ms`, p99 `77.17ms`, 100/100 fanout | Performance 5.1 / Operational Readiness 7.1 |
| coverage | 100% | `npm run test:coverage`; V8 coverage summary | Test Quality 6.1 |
| security_high | 0 | `npm run quality` audit lane with `--audit-level=high` for root, server, and gateway; lower-severity advisories remain | Security 4.1 |
| dependency_triage | documented | `docs/DEPENDENCY_AUDIT_TRIAGE.md`; root `16 low`, server `3 moderate`, gateway `8 low` full / `0` prod optional-omitted | Security 4.1 |
| secrets | 0 | `/tmp/gitleaks detect --source . --no-git --redact --config .gitleaks.toml`; tracked-tree and latest-commit scans also clean | Security 4.2 |
| secrets_tool | gitleaks | `/tmp/gitleaks` | Security 4.2 |
| lizard_warning_count | 0 | `npm run quality` with pinned `lizard==1.21.2` | Maintainability 3.1 |
| lizard_avg_ccn | 1.35 | `lizard --csv` over quality-gate exclusions | Maintainability 3.1 |
| lizard_max_ccn | 15 | `lizard --csv` over quality-gate exclusions | Maintainability 3.1 |
| duplication_pct | 2.21 | `npm run quality` jscpd lane; `5128/232007` duplicated lines, `264` clones, `1493` files | Maintainability 3.2 |
| largest_file_lines | 2637 | `wc -l`; `scripts/perf/phase3-compose-benchmark-smoke.mjs` | Maintainability 3.3 |
| large_file_classification | pass | `npm run quality`; `4` files over `1000` lines, all classified, `0` unclassified oversized files | Maintainability 3.3 |
| docker_install_e2e | pass | `HTTPS_PORT=18443 HTTP_PORT=18080 ./tests/install/e2e/install-script.test.sh`; `9` tests | Operational Readiness 7.1 |
| docker_upgrade_e2e | pass | `HTTPS_PORT=18443 HTTP_PORT=18080 ./tests/install/e2e/upgrade-install.test.sh`; `12` tests | Operational Readiness 7.1 |
| deploy_artifact_count | 2 | `grade.sh`; Docker/Compose plus CI | Operational Readiness 7.1 |
| health_endpoint_count | 169 | `grade.sh` heuristic evidence | Operational Readiness 7.2 |
| observability_lib_present | 1 | `grade.sh` heuristic evidence | Operational Readiness 7.3 |
| validation_lib_present | 1 | `grade.sh` heuristic evidence | Security 4.3 |
| suppression_count | 22 | `grade.sh` heuristic evidence | Correctness 1.4 |
| timeout_retry_count | 1269 | `grade.sh` heuristic evidence | Reliability 2.2 |
| blocking_io_count | 29 | `grade.sh` heuristic evidence | Performance 5.1/5.3 |
| logging_call_count | 315 | `grade.sh` heuristic evidence | Operational Readiness 7.4 |
| test_file_count | 1088 | `grade.sh` heuristic evidence | Test Quality 6.2 |
| test_sleep_count | 90 | `grade.sh` heuristic evidence | Test Quality 6.4 |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=22` is below the `<10/KLOC` high threshold for this repo size, and spot checks show most suppressions are targeted Prisma, metrics-wrapper, Electrum, or test/interop cases rather than broad production masking.
- **[1.5] Functional completeness - High -> +3**: the suite now passes, browser auth behavior has focused policy tests in `tests/api/authPolicy.test.ts`, and no active TODO/FIXME cluster was found that blocks the stated application scope.
- **[2.1] Error handling quality - High -> +6**: `server/src/errors/errorHandler.ts`, gateway request logging, API client error wrapping, and service-level catch/log patterns provide contextual failures instead of silent drops.
- **[2.2] Timeouts and retries - High -> +4**: `src/api/client.ts`, `src/api/refresh.ts`, `ai-proxy/src/index.ts`, Electrum clients/pools, and gateway backend calls use explicit retries, backoff, lock timeouts, or abort behavior.
- **[2.3] Crash-prone paths - Medium -> +2**: production startup/shutdown code still uses `process.exit` in `server/src/index.ts`, `server/src/worker.ts`, `gateway/src/index.ts`, and `ai-proxy/src/index.ts`; most are controlled fatal paths, but not zero.
- **[3.4] Architecture clarity - High -> +3**: frontend API policy, browser refresh behavior, gateway proxying, backend routes, repositories, workers, shared schemas, runtime-secret ownership, lifecycle wiring, dependency direction, route-to-repository exceptions, admin settings service ownership, admin monitoring service ownership, admin group service ownership, wallet policy service ownership, and route documentation now have executable boundaries through `scripts/check-browser-auth-contract.mjs`, `scripts/check-architecture-boundaries.mjs`, `scripts/check-openapi-route-coverage.mjs`, `server/tests/unit/services/serverBackgroundServices.test.ts`, `server/tests/unit/services/adminSettingsService.test.ts`, `server/tests/unit/services/adminMonitoringService.test.ts`, `server/tests/unit/services/adminGroupService.test.ts`, and `server/tests/unit/services/vaultPolicyService.test.ts`.
- **[3.5] Readability/naming - High -> +2**: sampled modules such as `src/api/authPolicy.ts`, `src/api/refresh.ts`, `shared/utils/redact.ts`, and `gateway/src/middleware/validateRequest.ts` use direct names and comments only where policy or security behavior needs context.
- **[4.3] Input validation quality - High -> +3**: gateway and backend trust boundaries use Zod schemas and validation middleware in `gateway/src/middleware/validateRequest.ts`, `server/src/middleware/validate.ts`, `shared/schemas/mobileApiRequests.ts`, and Electrum response validation.
- **[4.4] Safe system/API usage - High -> +2**: no user-fed `eval` or DOM injection path was found, Redis Lua usage is fixed-script infrastructure, and `server/src/services/maintenance/diskMonitoring.ts` now uses `execFile` with fixed argument arrays for Docker and `df`.
- **[5.1] Hot-path efficiency - High -> +5**: request-facing code uses React Query, batched repository operations, Redis coordination, AbortSignal timeouts, and fresh generated performance proof rather than obvious hot-path blocking loops.
- **[5.2] Data access patterns - High -> +3**: repository code uses Prisma transactions, `createMany`, aggregation/grouping, and scoped queries; examples include UTXO, transaction sync, labels, and access-control paths.
- **[5.3] No blocking in hot paths - Medium -> +1**: synchronous reads and process calls exist mainly in startup, support package, admin/version, and maintenance code, while the main request paths remain async.
- **[6.2] Test structure - High -> +4**: tests are split into API, component, hook, service, backend, gateway, install, e2e, and contract-focused suites with clear behavioral names.
- **[6.3] Edge cases covered - High -> +3**: tests cover error branches, empty states, invalid input, retries, auth refresh, CSRF cookie parsing, hardware-wallet adapters, backup/restore, WebSocket behavior, and route contracts.
- **[6.4] No flaky patterns - Medium -> +1**: targeted toast timer, sidebar API retry noise, jsdom canvas warnings, and stale OpenAPI push-route assertions were reduced, but recurring React `act(...)`, jsdom navigation/SVG warnings, and remaining sleep/time patterns show the suite is strong but not cleanly deterministic/noise-free.
- **[7.4] Logging quality - High -> +3**: backend and gateway logging use module-scoped loggers with structured metadata and shared redaction helpers in `shared/utils/redact.ts`, `server/src/utils/logger.ts`, and `gateway/src/utils/logger.ts`.

### Missing

- No universal quality signal is missing after adding the pinned complexity lane. The remaining gaps are classification/triage work rather than absent measurement.

---

## Top Risks

1. Test suite noise can hide regressions - React `act(...)`, jsdom navigation/SVG warnings, expected error-log branches, and remaining sleep/time patterns make failure triage harder even when tests pass.
2. Low/moderate dependency advisories remain accepted-risk items - root, server, and gateway have no high/critical findings, but root low and server Prisma-tooling moderate advisories still need monitoring.
3. Direct route-to-repository debt is now visible but not gone - the boundary gate blocks new imports and stale exceptions, but `45` existing exceptions still need service-facade burn-down.
4. Production files near the warning threshold need ownership attention when touched - the quality gate classifies all `>1000` line files, but files such as `ai-proxy/src/index.ts` and `server/src/repositories/transactionRepository.ts` remain close to the limit.
5. OpenAPI route coverage now checks path/method drift plus selected admin settings, monitoring, and group runtime response keys, but broader request/response schema parity is still selected-surface only.

## Fastest Improvements

1. Pay down noisy/flaky test patterns - expected gain: Test Quality 6.4 can move from Medium to High - effort: medium, focused on React async assertions, jsdom capability shims, and remaining sleeps.
2. Burn down the remaining `45` documented route-to-repository exceptions - expected gain: fewer route modules coupled to persistence details and a smaller architecture allowlist - effort: medium.
3. Use the server background lifecycle module as the pattern for the next manual service migration - expected gain: reliability and operational confidence without startup-order regressions - effort: medium.
4. Split production files near the `1000` line warning only when responsibility boundaries are already clear - expected gain: more reviewable changes and eventual god-file score improvement - effort: medium/high.
5. Extend contract checks beyond the selected admin settings, monitoring, and group response-key parity guards to response/request schema parity where runtime serializers make that practical - expected gain: stronger correctness evidence - effort: medium/high.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 0 | Preserve the cleared baseline | Keep tests, typecheck, lint, coverage, audit, and all `gitleaks` modes green after each architectural change. | Same commands in Verification Notes pass on a clean checkout. | Keeps 91/A stable. |
| 1 | Make quality evidence reproducible | Add a repo-owned quality command and pinned/documented `lizard` invocation. | Quality command emits coverage, duplication, complexity, audit, secret, lint, typecheck, and test summaries. | Completed; maintainability confidence improved. |
| 2 | Harden maintenance system calls | Convert disk monitoring to `execFile`, parse output without shell pipelines, and test failure branches. | No shell-string process execution remains in the maintenance probe. | Completed; Security 4.4 moves to High. |
| 3 | Clarify large-file policy | Classify generated/proof/test-fixture files and block unclassified oversized production files in the quality gate. | `large-file classification` lane passes with `0` unclassified files over `1000` lines. | Completed; maintainability evidence improved while score remains capped by physical largest-file threshold. |
| 4 | Release-level install proof | Run the full fresh-install and upgrade-install e2e scripts with external runtime env paths. | Containerized install/upgrade e2e passes and full-tree `gitleaks` remains clean. | Completed; preserves Security and Operational Readiness. |
| 5 | Enforce architecture boundaries | Add browser-auth contract and dependency-boundary checks to the quality gate. | `check:browser-auth-contract` and `check:architecture-boundaries` pass in `npm run quality`. | Completed; maintainability confidence improved. |
| 6 | Reduce suite noise and timing fragility | Replace sleeps with fake timers/events and fix recurring React async assertions. | Common warning classes are removed and remaining sleep/time patterns trend down. | Test Quality +2 possible. |
| 7 | Complete route contract coverage | Add OpenAPI route coverage drift checks. | New backend routes fail CI unless documented in OpenAPI or explicitly exempted. | Completed; correctness and maintainability confidence improved. |
| 8 | Harden lifecycle wiring | Move a clear manual lifecycle hook into the service registry with dependency-order proof. | Token-revocation cleanup is managed by `serviceRegistry`; `sync` declares its worker-heartbeat dependency; lifecycle tests pass. | Completed; reliability evidence improved. |
| 9 | Freeze route-to-repository debt | Add a route-to-repository dependency rule with owner/removal exceptions and remove easy exceptions. | Boundary gate passes with `45` exceptions and fails stale entries or new undocumented direct imports. | Completed; maintainability confidence improved. |
| 10 | Refresh generated scale proof | Rerun Phase 3 compose proof after startup/lifecycle changes. | 25k synthetic transaction proof, worker proof, two-worker proof, two-backend fanout, backup restore, and capacity snapshots pass. | Completed; performance/ops evidence improved. |
| 11 | Deepen contract validation | Extend OpenAPI checks beyond route presence to selected request/response schema parity. | Selected guards pass for admin settings, monitoring, group, and wallet policy response-key parity; broader schema parity remains follow-up work. | Completed for selected surfaces; correctness confidence improved. |

## Strengths To Preserve

- Browser auth and CSRF decisions now live in `src/api/authPolicy.ts` and are shared by `src/api/client.ts`, `src/api/refresh.ts`, and direct backup fetches.
- Browser auth and architecture dependency boundaries are enforced by `scripts/check-browser-auth-contract.mjs` and `scripts/check-architecture-boundaries.mjs` inside `npm run quality`.
- OpenAPI route presence is enforced by `scripts/check-openapi-route-coverage.mjs`; intentional non-JSON or self-documenting endpoints live in `scripts/quality/openapi-route-coverage-exceptions.json`.
- Server background lifecycle wiring is isolated in `server/src/services/serverBackgroundServices.ts` with unit-test proof.
- Direct API route-to-repository imports now require documented exceptions in `scripts/quality/architecture-boundary-exceptions.json`; stale entries fail the architecture check.
- Admin settings persistence, defaulting, SMTP password redaction/encryption, cache clearing, and confirmation-threshold validation now live behind `server/src/services/adminSettingsService.ts`.
- Admin monitoring URL override persistence, Grafana settings, and optional monitoring health checks now live behind `server/src/services/adminMonitoringService.ts`.
- Admin group persistence, member validation, membership mutation, and access-cache invalidation now live behind `server/src/services/adminGroupService.ts`.
- Wallet policy list, event, and address-list persistence now route through `server/src/services/vaultPolicy/vaultPolicyService.ts`; `server/src/api/wallets/policies.ts` owns HTTP validation/orchestration instead of repository calls.
- Runtime-secret ownership is documented in `docs/RUNTIME_SECRETS.md`, and fresh setup now writes env/TLS material outside the repo checkout by default.
- Access-cache invalidation, common validation schemas, and reusable health checks now sit below API/service callers in `server/src/infrastructure/accessCache.ts`, `server/src/validation/commonSchemas.ts`, and `server/src/services/health/`.
- Shared gateway/backend request schemas and validation are centered in `shared/schemas/mobileApiRequests.ts`, `gateway/src/middleware/validateRequest.ts`, and `server/src/middleware/validate.ts`.
- Structured logging and redaction are consistent across `shared/utils/redact.ts`, `server/src/utils/logger.ts`, and `gateway/src/utils/logger.ts`.
- Docker/Compose, CI, health endpoints, monitoring hooks, and operations proof documents give strong operational readiness evidence.
- Phase 3 generated capacity proof is current in `docs/plans/phase3-compose-benchmark-smoke-2026-04-15T06-25-20-675Z.md`, with disposable TLS material generated outside the checkout.

## Work To Defer Or Avoid

- Do not weaken secret detection now that current full-tree scans are clean; fix setup defaults instead.
- Do not split large proof/generated files purely for a score if they are not production hot paths; classify them first, then split only when it reduces real maintenance cost.
- Do not chase an A by relaxing coverage thresholds or deleting tests; the current coverage gate is valuable because it caught the new auth-policy branch.
- Do not introduce a new architecture framework until existing boundary checks and quality wrappers are exhausted.

## Verification Notes

- `npm run quality` passed end to end after the wallet policy service extraction, OpenAPI route-coverage checker complexity refactor, jsdom canvas shim, and stale push OpenAPI assertion cleanup. It passed lint, typecheck, browser-auth contract, architecture-boundary, OpenAPI route coverage, coverage (`388` files / `5505` tests / `100%` coverage), high-severity audits, all gitleaks modes, pinned lizard, jscpd (`2.21%`, `5128/232007`, `264` clones, `1493` files), and large-file classification.
- `npm run check:architecture-boundaries` passed and scanned `1281` files, `5386` imports, `9` dependency-boundary rules, and `45` documented route-to-repository exceptions after the wallet policy route stopped importing `policyRepository` and `walletRepository`.
- `npm --prefix server run test:run -- tests/unit/services/vaultPolicyService.test.ts` passed `56` vault policy service tests.
- `npx vitest run tests/unit/api/wallets-policies-routes.test.ts` in `server/` passed `55` wallet policy route tests.
- `npx vitest run tests/unit/api/openapi.test.ts` in `server/` passed `42` OpenAPI contract tests after wallet policy response-envelope parity assertions and the gateway-HMAC push-route contract update.
- `npx vitest run tests/components/AnimatedBackground.test.tsx tests/components/AnimatedBackground.lazyLoading.test.tsx tests/components/Dashboard/PriceChart.test.tsx tests/components/qr/AnimatedQRCode.test.tsx` passed `89` frontend tests after adding the jsdom canvas shim and fixing the PriceChart Recharts mock.
- Fresh dependency advisory checks were rerun. Root production audit still reports `14` low advisories; server production audit still reports `3` moderate advisories through Prisma tooling; gateway production audit with optional dependencies omitted reports `0` vulnerabilities. These match the accepted-risk triage in `docs/DEPENDENCY_AUDIT_TRIAGE.md`.
- Target-environment calibration status was re-checked in `docs/RELEASE_GATES.md`: the local generated Phase 3 proof remains current, while release-specific capacity claims remain pending until an exact non-production topology and its required benchmark fields are recorded.
- `npm run quality` passed end to end after adding the auth-contract and architecture-boundary lanes. It passed lint, typecheck, `check:browser-auth-contract`, `check:architecture-boundaries`, coverage, high-severity audits, full/latest/tracked gitleaks scans, pinned lizard, jscpd, and large-file classification.
- `npm run check:openapi-route-coverage` passed after documenting five missing operations; it scanned `288` Express routes and `284` OpenAPI operations with `4` documented exceptions.
- `QUALITY_SKIP_COVERAGE=1 QUALITY_SKIP_AUDIT=1 QUALITY_SKIP_GITLEAKS=1 QUALITY_SKIP_LIZARD=1 QUALITY_SKIP_JSCPD=1 QUALITY_SKIP_LARGE_FILES=1 npm run quality` passed lint, typecheck, browser-auth contract, architecture boundaries, and OpenAPI route coverage through the integrated gate.
- `npm run check:browser-auth-contract` passed and scanned `545` browser files.
- `npm run check:architecture-boundaries` passed and scanned `1281` files, `5387` imports, `9` dependency-boundary rules, and `47` documented route-to-repository exceptions.
- `npm --prefix server run test:run -- tests/unit/services/adminSettingsService.test.ts` passed `3` admin settings service tests.
- `npx vitest run tests/unit/api/admin-routes.test.ts` in `server/` passed `59` admin route tests after elevating for Supertest's ephemeral local listener; the sandboxed run failed with `listen EPERM` before elevation.
- `npm --prefix server run test:run -- tests/unit/services/adminMonitoringService.test.ts` passed `4` admin monitoring service tests.
- `npx vitest run tests/unit/api/admin-monitoring-routes.test.ts` in `server/` passed `16` admin monitoring route tests after elevating for Supertest's ephemeral local listener; the sandboxed run failed with `listen EPERM` before elevation.
- `npm --prefix server run test:run -- tests/unit/services/adminGroupService.test.ts` passed `4` admin group service tests.
- `npx vitest run tests/unit/api/admin-groups-routes.test.ts tests/unit/api/admin-routes.test.ts` in `server/` passed `86` admin group/admin route tests after elevating for Supertest's ephemeral local listener.
- `npm --prefix server run build` passed after extracting the admin settings, admin monitoring, and admin group services.
- `npm run lint:server` passed after extracting the admin group service and adding selected response-key parity assertions.
- `QUALITY_SKIP_COVERAGE=1 QUALITY_SKIP_AUDIT=1 QUALITY_SKIP_GITLEAKS=1 QUALITY_SKIP_LIZARD=1 QUALITY_SKIP_JSCPD=1 npm run quality` passed lint, typecheck, browser-auth contract, architecture boundaries, OpenAPI route coverage, and large-file classification after the admin group extraction.
- `npm --prefix server run test:run -- tests/unit/services/serverBackgroundServices.test.ts tests/unit/services/serviceRegistry.test.ts tests/unit/services/startupManager.test.ts` passed `31` lifecycle tests.
- `npx vitest run tests/unit/services/adminCredentialService.test.ts tests/unit/api/admin-backup-routes.test.ts` in `server/` passed `20` tests after elevating for Supertest's ephemeral local listener.
- `node --check scripts/perf/phase3-compose-benchmark-smoke.mjs` passed after the disposable SSL-dir proof fix.
- `PHASE3_COMPOSE_BENCHMARK_HTTP_PORT=28080 PHASE3_COMPOSE_BENCHMARK_HTTPS_PORT=28443 PHASE3_COMPOSE_BENCHMARK_GATEWAY_PORT=24000 PHASE3_LARGE_WALLET_TRANSACTION_COUNT=25000 PHASE3_LARGE_WALLET_HISTORY_REQUESTS=100 PHASE3_LARGE_WALLET_HISTORY_CONCURRENCY=10 PHASE3_BACKEND_SCALE_OUT_WS_CLIENTS=100 PHASE3_MAX_WEBSOCKET_PER_USER=100 npm run perf:phase3:compose-smoke` passed and wrote `docs/plans/phase3-compose-benchmark-smoke-2026-04-15T06-25-20-675Z.md` plus `docs/plans/phase3-benchmark-2026-04-15T06-25-45-349Z.md`.
- `npm --prefix server run build` passed after extracting access-cache, validation, and health modules.
- `HTTPS_PORT=18443 HTTP_PORT=18080 ./tests/install/e2e/install-script.test.sh` passed `9` Docker install e2e tests with external runtime env paths.
- `HTTPS_PORT=18443 HTTP_PORT=18080 ./tests/install/e2e/upgrade-install.test.sh` passed `12` Docker upgrade e2e tests with external runtime env paths.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed with `tests=pass`, `lint=pass`, `typecheck=pass`, `security_high=0`, `largest_file_lines=2595`, `suppression_count=22`, `timeout_retry_count=1269`, `blocking_io_count=29`, `test_file_count=1088`, and `test_sleep_count=90`.
- The `91/100` score is the working-tree reassessment after the follow-up evidence above and below; the bundled grade script output is retained as the last full automated baseline.
- `npm run test:coverage` passed after adding the missing auth-policy edge test: `388` files, `5505` tests, `100%` statements/branches/functions/lines.
- `npm run quality` coverage lane passed with the other lanes skipped: `388` files, `5505` tests, and `100%` statements/branches/functions/lines.
- `npm run lint` passed, including `check:api-body-validation`.
- `npm run typecheck` passed.
- `npm run quality` audit lane passed with `--audit-level=high` for root, server, and gateway packages. Root still reports `16` low advisories; server and gateway report lower-severity advisory debt for follow-up triage.
- `/tmp/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --report-format json --report-path /tmp/gitleaks-current.json` found no leaks.
- `GITLEAKS_BIN=/tmp/gitleaks bash scripts/gitleaks-tracked-tree.sh` found no leaks.
- `/tmp/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1` found no leaks in the latest commit.
- `npm run quality` gitleaks lane passed full-tree, latest-commit, and tracked-tree scans.
- `npm run quality` pinned `lizard 1.21.2` lane passed with `0` warnings.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard --csv ...` reported `28660` functions, `avg_ccn=1.35`, and `max_ccn=15` using the quality-gate exclusions.
- `npm run quality` jscpd lane reported `2.22%` duplication (`5126` duplicated lines across `1487` scanned files, `264` clones) in the prior baseline; the latest full run reports `2.21%` (`5128/232007`, `264` clones, `1493` files).
- `npm run quality` large-file classification lane reported `4` files over `1000` lines and `46` files over the `800` warning limit; all over-limit files are classified.
- `bash tests/install/unit/install-script.test.sh` passed `73` installer unit tests after adding runtime-secret default assertions.
- A non-start setup smoke with `SANCTUARY_RUNTIME_DIR=/tmp/...` created external `sanctuary.env` and `ssl/*.pem`, did not recreate repo-local `.env` or PEMs, and passed `docker compose config --quiet` with the external env.
- `npm run test:run -- tests/unit/services/maintenanceService.test.ts` in `server/` passed `25` maintenance tests after the `execFile` migration.
- `npm run build` in `server/` passed after the disk-monitoring change.
- `npm run lint:server` passed after the disk-monitoring change.
- `QUALITY_SKIP_COVERAGE=1 QUALITY_SKIP_AUDIT=1 QUALITY_SKIP_GITLEAKS=1 QUALITY_SKIP_LIZARD=1 QUALITY_SKIP_JSCPD=1 npm run quality` passed lint and typecheck through the integrated gate earlier in the implementation pass.
