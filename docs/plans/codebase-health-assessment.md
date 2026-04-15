# Software Quality Report

Date: 2026-04-15 (Pacific/Honolulu)
Owner: TBD
Status: Draft

**Overall Score**: 93/100
**Grade**: A
**Confidence**: High
**Mode**: full plus recommendations follow-up
**Commit**: a2109a72

---

## Hard-Fail Blockers

None.

Notes:

- `tests=pass`, `typecheck=pass`, and `lint=pass`; no correctness hard-fail gate fired.
- `npm run quality` completed the high-audit lanes with `0` high and `0` critical advisories. Root still has `16` low advisories; server now reports `0` vulnerabilities; gateway reports `8` low advisories.
- The bundled `grade.sh` rg fallback reports private-key-looking matches in tests/docs, but direct inspection shows placeholder/test/doc strings. The higher-confidence `gitleaks` full-tree, latest-commit, and tracked-tree scans found `0` leaks, so the hardcoded-secret gate is clear.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Tests, lint, typecheck, browser-auth contract, architecture-boundary, OpenAPI route coverage, and coverage gates pass. Suppression density remains low and targeted. |
| Reliability | 12/15 | Error handling, retry, timeout, refresh-lock, DB retry, and shutdown-drain patterns are strong; deductions remain for controlled `process.exit` paths and some production non-null assumptions. |
| Maintainability | 13/15 | Pinned `lizard` reports `0` warnings, `AvgCCN=1.4`, and no function above the configured thresholds; jscpd duplication is `2.31%`; architecture boundaries pass with `40` exceptions, down from `43`. File-size warning debt is down to `4` files, all classified proof/generated/fixture artifacts with enforced owner/review metadata; mechanical god-file scoring remains constrained because the largest physical source file is the classified `2637`-line performance proof harness. |
| Security | 15/15 | High/critical audit debt is `0`, server audit debt is cleared, `gitleaks` is clean, trust boundaries use Zod validation, and inspected SQL/system-call patterns are parameterized or fixed-argument. |
| Performance | 9/10 | Request-facing paths use batching, React Query, AbortSignal timeouts, DB metrics, and async external I/O; remaining blocking/sync work is mostly startup, admin, support, maintenance, or proof-harness code. |
| Test Quality | 14/15 | Coverage is `100%` across `388` files and `5506` tests, with broad edge-case coverage. Direct test `setTimeout(` usage is now `0`; the remaining `10` `sleep(...)` references are isolated to the async utility test that verifies the sleep helper itself. Deductions remain for expected error-log/jsdom noise in coverage output. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability, structured logging/redaction, quality gates, and install/ops proof artifacts are present. |
| **TOTAL** | **93/100** | |

---

## Trend

- vs earlier 2026-04-15 (`a2109a72` full run): overall `+1` (`92 -> 93`), grade `A -> A`, confidence `High -> High`.
- Risk movement improved: architecture-boundary exceptions decreased from `43` to `40`; direct test `setTimeout(` matches decreased to `0`; the only remaining `sleep(...)` references are the `10` intentional async-helper tests; server advisories decreased from `3 moderate` to `0`; file-size warnings decreased from `46` to `4`, with `0` unclassified warning files remaining; the classified large-file list now has a real schema plus enforced owner/review metadata; the script-type descriptor handlers share path/key-expression helpers; the AI proxy rate limiter was split from the `908`-line entrypoint; the user-journey e2e API fixture, AI internal API test harness, vault policy service test harness, gateway backend events test harness, wallet repository tests, Payjoin/Coin Control integration suites, selected production animation/config modules, and multiple final low-800s tests were extracted; and the Vite node-polyfills deprecation warning was removed by an explicit wrapper plus browser-global shim.
- Hard-fail movement: unchanged clear baseline; tests, typecheck, lint, high/critical audit, and `gitleaks` all pass.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass | `npm run quality` coverage lane | Correctness 1.1 |
| test_count | `5506` | Vitest via `npm run quality` | Correctness 1.1 / Test Quality 6.2 |
| test_files | `388` | Vitest via `npm run quality` | Test Quality 6.2 |
| typecheck | pass | `npm run typecheck` inside `npm run quality` | Correctness 1.2 |
| lint | pass | `npm run lint` inside `npm run quality` | Correctness 1.3 |
| suppression_count | `22` | `grade.sh` heuristic evidence; inspected suppressions | Correctness 1.4 |
| browser_auth_contract | pass; `552` files | `npm run check:browser-auth-contract` inside `npm run quality` | Correctness 1.5 / Security 4.3 |
| architecture_boundaries | pass; `1298` files, `5421` imports, `9` rules, `40` exceptions | `npm run check:architecture-boundaries` inside `npm run quality` | Maintainability 3.4 |
| openapi_route_coverage | pass; `288` Express routes, `284` OpenAPI operations, `4` exceptions | `npm run check:openapi-route-coverage` inside `npm run quality` | Correctness 1.5 / Maintainability 3.4 |
| coverage | `100%` statements, branches, functions, lines | `npm run test:coverage` via `npm run quality`; `14184/14184` statements, `10581/10581` branches | Test Quality 6.1 |
| security_high | `0` | `npm run quality` audit lanes | Security 4.1 |
| dependency_advisories | root `16` low; server `0`; gateway `8` low | `npm run quality`; targeted `npm audit --json` runs | Top Risks |
| secrets | `0` | `gitleaks detect`, `gitleaks git`, and `scripts/gitleaks-tracked-tree.sh` via `npm run quality` | Security 4.2 |
| secrets_rg_fallback_hits | placeholder/test/doc hits only | `grade.sh` rg fallback plus direct inspection | Security 4.2 false-positive triage |
| lizard_warning_count | `0` | pinned `.tmp/quality-tools/lizard-1.21.2/bin/lizard` via `npm run quality` | Maintainability 3.1 |
| lizard_avg_ccn | `1.4` | lizard summary over quality-gate exclusions | Maintainability 3.1 |
| lizard_max_ccn | `15` | lizard inspection over quality-gate exclusions | Maintainability 3.1 |
| duplication_pct | `2.31%` | `jscpd@4`; `5380/232768` duplicated lines, `275` clones, `1516` files | Maintainability 3.2 |
| largest_file_lines | `2637` | file-size scan; `scripts/perf/phase3-compose-benchmark-smoke.mjs` | Maintainability 3.3 |
| large_file_classification | pass | `scripts/quality/check-large-files.mjs`; `4` files over `1000` lines, all classified; `4` files over warning limit `800`; `0` unclassified warning files remain; owner/review metadata is enforced | Maintainability 3.3 risk context |
| deploy_artifact_count | `2` | `grade.sh`; Docker/Compose plus GitHub Actions CI | Operational Readiness 7.1 |
| health_endpoint_count | `174` | `grade.sh` heuristic evidence | Operational Readiness 7.2 |
| observability_lib_present | `1` | `grade.sh` heuristic evidence | Operational Readiness 7.3 |
| validation_lib_present | `1` | `grade.sh`; Zod found in server/gateway/shared validation | Security 4.3 |
| timeout_retry_count | `1264` | `grade.sh` heuristic evidence | Reliability 2.2 |
| blocking_io_count | `36` | `grade.sh` heuristic evidence | Performance 5.1/5.3 |
| logging_call_count | `321` | `grade.sh` heuristic evidence | Operational Readiness 7.4 |
| test_file_count | `1094` | `grade.sh` heuristic evidence | Test Quality 6.2 |
| direct_test_set_timeout_count | `0` | `rg "setTimeout\\(" server/tests tests gateway/tests --glob '*.{ts,tsx}'` | Test Quality 6.4 |
| test_sleep_helper_refs | `10` | `rg "\\bsleep\\(" server/tests tests gateway/tests --glob '*.{ts,tsx}'`; all matches are in `server/tests/unit/utils/async.test.ts` | Test Quality 6.4 |
| ai_proxy_entrypoint_lines | `908` | `wc -l ai-proxy/src/index.ts` after `rateLimit` extraction | Maintainability 3.3 risk context |
| transaction_repository_lines | compatibility surface `2`; modules `396`, `290`, `50`, `15` | `wc -l server/src/repositories/transactionRepository.ts server/src/repositories/transactions/*.ts` | Maintainability 3.3 risk context |
| repository_setup_lines | public surface `6`; largest setup module `371` | `wc -l server/tests/integration/repositories/setup.ts server/tests/integration/repositories/setup/*.ts` | Maintainability 3.3 risk context |
| utxo_selection_test_lines | largest split test `623`; harness `29` | `wc -l server/tests/unit/services/utxoSelectionService*.ts` | Maintainability 3.3 risk context |
| user_journeys_e2e_lines | spec `394`; API fixture `569` | `wc -l e2e/user-journeys.spec.ts e2e/userJourneyApi.ts` | Maintainability 3.3 risk context |
| ai_internal_api_test_lines | registrar `19`; largest split module `476`; harness `110` | `wc -l server/tests/unit/api/ai-internal.test.ts server/tests/unit/api/aiInternal/*.ts` | Maintainability 3.3 risk context |
| vault_policy_service_test_lines | registrar `19`; largest split module `465`; harness `68` | `wc -l server/tests/unit/services/vaultPolicyService.test.ts server/tests/unit/services/vaultPolicyService/*.ts` | Maintainability 3.3 risk context |
| gateway_backend_events_test_lines | registrar `11`; largest split module `266`; harness `168` | `wc -l gateway/tests/unit/services/backendEvents.test.ts gateway/tests/unit/services/backendEvents/*.ts` | Maintainability 3.3 risk context |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=22` is low for this codebase size, and inspected suppressions are mostly generated Prisma, test overrides, metrics wrapper overloads, and Electrum interop paths rather than broad production masking.
- **[1.5] Functional completeness - High -> +3**: `npm run quality` passes browser auth, architecture, OpenAPI route, and coverage contracts; the only inspected TODO is a nonblocking PSBT vector-generation note in `scripts/verify-psbt/README.md`.
- **[2.1] Error handling quality - High -> +6**: `server/src/errors/errorHandler.ts`, `src/api/client.ts`, `src/api/refresh.ts`, `gateway/src/middleware/requestLogger.ts`, `server/src/services/bitcoin/feeService.ts`, and `server/src/services/bitcoin/networkStatusService.ts` preserve contextual failure information.
- **[2.2] Timeouts and retries - High -> +4**: `src/api/client.ts`, `src/api/refresh.ts`, `server/src/models/prisma.ts`, Electrum paths, and AI proxy calls use retries, locks, backoff, abort timeouts, or shutdown drains around external I/O.
- **[2.3] Crash-prone paths - Medium -> +2**: production startup/shutdown files such as `gateway/src/index.ts` and `ai-proxy/src/index.ts` still use controlled `process.exit` paths, and some production code has non-null assumptions.
- **[3.4] Architecture clarity - High -> +3**: boundaries are enforced by `scripts/check-browser-auth-contract.mjs`, `scripts/check-architecture-boundaries.mjs`, and `scripts/check-openapi-route-coverage.mjs`; fee estimation, network status, and device model listing now delegate from API routes to service modules, reducing documented API/repository exceptions to `40`.
- **[3.5] Readability/naming - High -> +2**: sampled modules `src/api/client.ts`, `src/api/refresh.ts`, `gateway/src/middleware/validateRequest.ts`, `server/src/middleware/validate.ts`, `server/src/services/bitcoin/networkStatusService.ts`, `ai-proxy/src/rateLimit.ts`, and `vite.nodePolyfills.ts` use direct names and targeted comments for policy-heavy behavior.
- **[4.3] Input validation quality - High -> +3**: trust boundaries use Zod and shared schemas in `server/src/middleware/validate.ts`, `gateway/src/middleware/validateRequest.ts`, `shared/schemas/mobileApiRequests.ts`, `server/src/config/schema.ts`, and Electrum response validators.
- **[4.4] Safe system/API usage - High -> +3**: inspected raw SQL uses Prisma tagged templates such as `server/src/repositories/addressRepository.ts`; Redis Lua calls use fixed scripts; no user-fed `eval`, `innerHTML`, or unsafe raw SQL pattern was found. AI proxy startup continues to avoid logging generated secrets.
- **[5.1] Hot-path efficiency - High -> +5**: API/client code uses retries and timeouts, repositories use aggregate/batched operations, and DB instrumentation in `server/src/models/prisma.ts` captures slow-query behavior.
- **[5.2] Data access patterns - High -> +3**: sampled repository and sync paths use scoped Prisma queries, aggregation, `createMany`, and batch Electrum fallbacks rather than obvious N+1 request paths.
- **[5.3] No blocking in hot paths - Medium -> +1**: blocking/synchronous patterns remain in startup, migrations, support package, admin/version, and proof scripts; request-facing paths are mostly async.
- **[6.2] Test structure - High -> +4**: tests are organized by API, component, hook, service, gateway, backend, e2e, install, and contract scopes with behavioral naming.
- **[6.3] Edge cases covered - High -> +3**: sampled tests cover invalid CSRF/cookie parsing, invalid BIP21 input, redaction recursion/circular values, gateway validation failures, vault policy rejection branches, unmounted async guards, and transaction-list timer rescheduling.
- **[6.4] No flaky patterns - High -> +2**: common React `act(...)` warnings were not observed in the current full quality output, direct test `setTimeout(` usage is `0`, and remaining `sleep(...)` references are limited to the async helper's own fake-timer tests. Expected error-log/jsdom noise keeps this just below full credit.
- **[7.4] Logging quality - High -> +3**: server and gateway loggers use module-scoped structured metadata and shared redaction via `shared/utils/redact.ts`; expected error-log paths in tests are now more often mocked locally.

### Missing

- None for current scoring. The bundled `grade.sh` did not supply all current post-cleanup values, so the report uses `npm run quality`, targeted audit runs, the current jscpd report, pinned lizard, and the targeted sleep-pattern scan as higher-freshness evidence.

---

## Top Risks

1. Architecture exceptions remain visible debt - boundary gate passes, but `40` documented exceptions still represent route/repository coupling to burn down over time.
2. Dependency advisory debt remains below the hard-fail threshold but not gone - root has `16` low and gateway has `8` low; server is now clean - evidence: `npm run quality` and targeted `npm audit --json` runs.
3. File-size scoring is now dominated by classified artifacts, not unclassified production/test debt - the largest physical source file is the `2637`-line performance proof harness, followed by generated/address-vector fixture files.
4. Test-suite output still contains expected error-log/jsdom noise even though direct sleep/timer debt was removed from tests.
5. Build-tool compatibility still needs watching - the Vite node-polyfills deprecation warning is fixed locally, but the wrapper/global shim should be revisited when upstream exposes an oxc-native path; the app build still reports an unrelated direct-`eval` warning from `@protobufjs/inquire`.

## Fastest Improvements

1. Burn down the next route-to-repository exceptions while keeping the boundary gate strict - expected point gain: maintainability risk reduction, keeps Architecture 3.4 strong - effort: medium.
2. Capture or mute expected error-log/jsdom noise locally in the tests that intentionally trigger it - expected point gain: Test Quality polish - effort: low/medium.
3. Keep low advisory triage current and remove root/gateway advisory chains when compatible upgrades exist - expected point gain: risk reduction before future high/critical drift - effort: medium.
4. Tackle the next measured duplication cluster, starting with notification channel registry or OpenAPI schema repetition if the shared shape remains stable - expected point gain: maintainability polish - effort: medium.
5. Retire the local node-polyfills wrapper once upstream supports the Vite/oxc path directly - expected point gain: future build compatibility - effort: low/medium.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 0 | Preserve current A | Keep `npm run quality`, targeted audits, and high audit green. | Tests, lint, typecheck, coverage, high audit, gitleaks, lizard, jscpd, and large-file classification pass. | Keeps `93/A` stable. |
| 1 | Pay down architecture exceptions | Move selected route persistence calls behind service facades. | Architecture-boundary exceptions decrease below `40` without new undocumented exceptions. | Maintainability risk reduction. |
| 2 | Polish test output | Make expected log-path tests assert or mute their own logs. | Full coverage output stays free of React `act(...)` warnings and expected stderr is locally intentional. | Test Quality polish. |
| 3 | Reduce dependency drift | Safely upgrade or replace vulnerable advisory chains when non-breaking paths exist. | Root/gateway low audit counts fall without `--force` downgrades or major regressions. | Security/operations risk reduction. |
| 4 | Improve file-size score deliberately | Keep unclassified warning files at `0`; evaluate classified proof/generated fixtures only when splitting improves reviewability. | Large-file classification stays green, unclassified warning files remain absent, and any fixture/proof split preserves provenance. | Maintainability `+1` to `+2` possible. |

## Strengths To Preserve

- `npm run quality` is a strong repo-owned gate covering lint, typecheck, auth contracts, architecture boundaries, OpenAPI route coverage, coverage, audit, gitleaks, lizard, jscpd, and file-size classification.
- Browser auth/CSRF behavior is centralized in `src/api/authPolicy.ts`, `src/api/client.ts`, and `src/api/refresh.ts`.
- Gateway/backend request validation shares Zod schemas through `shared/schemas/mobileApiRequests.ts`.
- Server/gateway logging and support-package metadata share redaction helpers through `shared/utils/redact.ts`.
- Docker/Compose, GitHub Actions, health endpoints, observability hooks, and prior install/operations proof artifacts support operational readiness.
- The architecture-boundary exception list is active debt tracking, not a passive allowlist; fee, network status, and device model route exceptions were removed after service extraction.

## Work To Defer Or Avoid

- Do not relax coverage or secret scanning to reduce noise; the current gates are valuable and passing.
- Do not split proof/generated files purely for a score unless it reduces real review or ownership cost.
- Do not start a framework rewrite while boundary checks and service-facade extraction are already improving maintainability.
- Do not treat low advisory debt as resolved; keep it triaged until upstream fixes or safe upgrades are available.
- Do not remove the node-polyfills wrapper without confirming the deprecation warning stays gone under the current Vite/oxc path.

## Verification Notes

- `npm run quality` passed. It covered lint, typecheck, browser-auth contract (`552` files), architecture boundaries (`1298` files / `5421` imports / `40` exceptions), OpenAPI route coverage, coverage (`388` files / `5506` tests / `100%`), high audit lanes, full/latest/tracked `gitleaks`, pinned `lizard`, `jscpd`, and large-file classification.
- `npm audit --omit=dev --json` at the repo root reports `14 low`, `0` moderate/high/critical; the full root audit lane in quality reports `16 low`.
- `npm audit --json` and `npm audit --omit=dev --json` in `server/` both report `0` vulnerabilities.
- `npm audit --json` in `gateway/` reports `8 low`; `npm audit --omit=dev --omit=optional --json` reports `0` vulnerabilities.
- Pinned lizard reports no threshold warnings and summary `AvgCCN=1.4`.
- `reports/jscpd/jscpd-report.md` reports `2.31%` duplication, `5380/232768` duplicated lines, `275` clones, and `1516` files.
- `rg "setTimeout\\(" server/tests tests gateway/tests --glob '*.{ts,tsx}'` reports `0` direct test matches.
- `rg "\\bsleep\\(" server/tests tests gateway/tests --glob '*.{ts,tsx}'` reports `10` matches, all in `server/tests/unit/utils/async.test.ts`, where the async helper itself is under fake-timer test.
- `npm run build` no longer emits the Vite node-polyfills `esbuild` deprecation warning; it still emits an unrelated direct-`eval` warning from `node_modules/@protobufjs/inquire/index.js`.
- `npx vitest run tests/unit/api/ai-internal.test.ts` in `server/` passed `77` AI internal API route tests after splitting the spec into contract modules.
- `npx vitest run tests/unit/services/vaultPolicyService.test.ts` in `server/` passed `56` vault policy service tests after splitting the spec into contract modules.
- `npx playwright test e2e/user-journeys.spec.ts --project=chromium` passed after extracting the shared user-journey API fixture.
- Focused large-file pass reduced `node scripts/quality/check-large-files.mjs` from `39` warning files to `4`; the remaining warning files are all classified proof/generated/fixture artifacts, with `0` unclassified warning files remaining.
- Classified large-file metadata now has `scripts/quality/large-file-classification.schema.json`, enforced owner/review fields, and `lastReviewed=2026-04-15` for the four remaining classified artifacts.
- Trend history appended to `docs/plans/grade-history/sanctuary_.jsonl`.
