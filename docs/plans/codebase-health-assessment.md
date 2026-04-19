# Software Quality Report

Date: 2026-04-18 (Pacific/Honolulu)
Owner: TBD
Status: Draft

**Overall Score**: 92/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: 219e2d98

---

## Remediation Update

The 2026-04-17 hard cap is cleared.

- High/critical dependency advisories are now `0` across root, server, gateway, and AI proxy audits. Root and gateway still report low-severity residual advisories.
- Lint, typecheck, architecture boundaries, browser auth contract, OpenAPI route coverage, API body validation, and large-file classification are green.
- Secret scanning is clean with gitleaks 8.30.1. The bundled regex fallback still reports PEM-shaped test fixtures and one planning note, but gitleaks classifies the repository as leak-free.
- Complexity is improved but still the dominant maintainability debt: lizard warnings dropped from `122` to `110`, with max CCN now `67`.
- Coverage remains very high, but the repo's stricter 100% coverage gate currently fails for app and backend coverage runs.

---

## Hard-Fail Blockers

None.

- `tests=pass`: native test suites pass.
- `typecheck=pass`: TypeScript checks pass.
- `security_high=0`: no high or critical npm advisories across audited packages.
- `secrets=0`: gitleaks found no leaks in workspace, latest commit, or tracked-tree scans.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Tests, lint, typecheck, browser auth contract, OpenAPI route coverage, and API body validation pass. |
| Reliability | 15/15 | Error handling, request timeouts, retry/backoff, typed validation, and shutdown paths are consistent by inspection. |
| Maintainability | 7/15 | Architecture boundaries and duplication are good, but lizard reports 110 CCN warnings and the largest physical file is 2,637 lines. |
| Security | 15/15 | No high/critical advisories, gitleaks clean, trust-boundary validation present, and no unsafe user-fed system/API patterns found. |
| Performance | 10/10 | Request-facing I/O is async/bounded; sampled data-access paths use grouped/batched queries instead of per-row fan-out. |
| Test Quality | 15/15 | Coverage is above 99% across app/server/gateway and tests are broad; note that app/server 100% coverage gates are currently red. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability libraries, and contextual logging are present. |
| **TOTAL** | **92/100** | Grade A; no hard-fail cap applied. |

---

## Trend

- vs 2026-04-17 (`1cbcef8a`): overall `+23` (`69 -> 92`), grade `D -> A`, confidence `High -> High`.
- vs last healthy baseline 2026-04-15 (`d8d884d8`): overall `-2` (`94 -> 92`), grade `A -> A`. The remaining delta is mainly lizard complexity debt and app/backend coverage falling below the repo's 100% gate.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; app 395 files/5,541 tests; backend 379 passed/22 skipped files with 9,087 passed/503 skipped tests; gateway 20 files/513 tests | `grade.sh`; `npm run test:coverage`; `npm run test:backend:coverage`; `npm run test:coverage` in `gateway` | Correctness 1.1 |
| typecheck | pass | `grade.sh`; native TypeScript checks | Correctness 1.2 |
| lint | pass | `grade.sh`; `npm run lint` | Correctness 1.3 |
| browser_auth_contract | pass; 663 browser files scanned | `npm run check:browser-auth-contract` | Correctness 1.5 |
| openapi_route_coverage | pass; 315 Express routes, 311 OpenAPI operations, 4 documented exceptions | `npm run check:openapi-route-coverage` | Correctness 1.5 |
| api_body_validation | pass | `npm run check:api-body-validation` | Security 4.3 |
| coverage | app lines 99.89%, backend lines 99.91%, gateway lines 100% | coverage summaries from V8/Vitest | Test Quality 6.1 |
| coverage_gate | fail for app/backend due global 100% thresholds; gateway passes | `npm run test:coverage` and `npm run test:backend:coverage` exit 1 after test pass | Risk context |
| security_high | 0 high/critical | `npm audit --json`; `npm --prefix server audit --json`; `npm --prefix gateway audit --json`; `npm --prefix ai-proxy audit --json` | Security 4.1 |
| root_audit | 16 low, 0 moderate, 0 high, 0 critical | `npm audit --json`; exit 1 due low advisories | Security 4.1 context |
| server_audit | 0 vulnerabilities | `npm --prefix server audit --json`; exit 0 | Security 4.1 |
| gateway_audit | 8 low, 0 moderate, 0 high, 0 critical | `npm --prefix gateway audit --json`; exit 1 due low advisories | Security 4.1 context |
| ai_proxy_audit | 0 vulnerabilities | `npm --prefix ai-proxy audit --json`; exit 0 | Security 4.1 |
| secrets | 0 | gitleaks 8.30.1 workspace, latest-commit, and tracked-tree scans | Security 4.2 |
| rg_secret_fallback | 8 raw PEM-shaped hits, all inspected as test fixtures or planning text | `grade.sh` regex fallback plus targeted `rg`; superseded by gitleaks | Security 4.2 context |
| lizard_warning_count | 110 functions with CCN > 15 | `.tmp/quality-tools/lizard-1.21.2/bin/lizard .` | Maintainability 3.1 |
| lizard_avg_ccn | 1.4 | lizard summary | Maintainability 3.1 |
| lizard_max_ccn | 67; `components/WalletStats.tsx` `WalletStats` | lizard CSV sort | Maintainability 3.1 context |
| duplication_pct | 2.13%; 279 clones, 5,346 duplicated lines | `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade .` | Maintainability 3.2 |
| largest_file_lines | 2,637 | `grade.sh`; `scripts/perf/phase3-compose-benchmark-smoke.mjs` | Maintainability 3.3 |
| large_file_classification | pass; 4 files over 1,000 lines, all classified | `node scripts/quality/check-large-files.mjs` | Maintainability 3.3 context |
| architecture_boundaries | pass; 1,456 files, 6,050 imports, 9 rules, 40 exceptions | `npm run check:architecture-boundaries` | Maintainability 3.4 |
| deploy_artifact_count | 2 | `grade.sh`; Docker/Compose and GitHub Actions present | Operational Readiness 7.1 |
| health_endpoint_count | 180 | `grade.sh` heuristic | Operational Readiness 7.2 |
| observability_lib_present | 1 | `grade.sh` heuristic | Operational Readiness 7.3 |
| validation_lib_present | 1 | `grade.sh` heuristic | Security 4.3 |
| suppression_count | 22 | `grade.sh` heuristic | Correctness 1.4 |
| timeout_retry_count | 1,206 | `grade.sh` heuristic | Reliability 2.2 |
| blocking_io_count | 36 | `grade.sh` heuristic | Performance 5.1/5.3 |
| logging_call_count | 319 | `grade.sh` heuristic | Operational Readiness 7.4 |
| test_file_count | 1,185 | `grade.sh` heuristic | Test Quality 6.2 |
| test_sleep_count | 10 | `rg "sleep\\(|setTimeout\\(" tests server/tests gateway/tests --glob '*.{ts,tsx}'`; direct sleeps isolated to async helper tests | Test Quality 6.4 |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: ISO Functional Appropriateness is strong because `suppression_count=22` is low for this repository size and no critical-path suppression cluster was found.
- **[1.5] Functional completeness - High -> +3**: ISO Functional Completeness is strong because native tests pass and the browser-auth, OpenAPI-route, architecture, and request-body validation contracts are green.
- **[2.1] Error handling quality - High -> +6**: ISO Fault Tolerance is strong in `src/api/client.ts`, `server/src/middleware/validate.ts`, `server/src/utils/logger.ts`, and gateway validation paths, with lint now clean of the prior silent-catch blockers.
- **[2.2] Timeouts and retries - High -> +4**: ISO Availability/Fault Tolerance is strong across `src/api/client.ts`, `src/api/refresh.ts`, `server/src/middleware/requestTimeout.ts`, `server/src/models/prisma.ts`, Electrum clients, and AI proxy timeouts.
- **[2.3] Crash-prone paths - High -> +5**: ISO Fault Tolerance is strong because process exits are centralized in small process-exit helpers and production access patterns avoid broad panic/assert-style handling.
- **[3.4] Architecture clarity - High -> +3**: ISO Modularity is strong because `check:architecture-boundaries` passes and repository/service/API boundaries are now enforced again.
- **[3.5] Readability/naming - Medium -> +1**: ISO Analyzability is mixed because naming and module layout are clear, but 110 lizard warnings in JSX-heavy components make review and change analysis harder.
- **[4.3] Input validation quality - High -> +3**: ISO Integrity is strong because Zod/request validation is present at server and gateway trust boundaries and `check:api-body-validation` passes.
- **[4.4] Safe system/API usage - High -> +3**: ISO Integrity is strong because searches found no user-fed `eval`, `innerHTML`, or unsafe raw SQL; inspected Redis Lua usage in `server/src/infrastructure/distributedLock.ts` and `server/src/services/rateLimiting/redisRateLimiter.ts` uses fixed scripts.
- **[5.1] Hot-path efficiency - High -> +5**: ISO Time Behaviour is strong because request-facing HTTP, DB, Redis, Electrum, and AI paths use async calls, timeouts, and bounded retry/backoff patterns.
- **[5.2] Data access patterns - High -> +3**: ISO Resource Utilization is strong in sampled dashboard and monitoring paths: `server/src/repositories/agentRepository.ts` uses grouped/windowed queries and `Promise.all` instead of per-agent query fan-out.
- **[5.3] No blocking in hot paths - High -> +2**: ISO Capacity is strong because blocking-I/O heuristic hits are concentrated in scripts, startup, shutdown, or maintenance/support paths rather than primary request hot paths.
- **[6.2] Test structure - High -> +4**: ISO Testability is strong because app, server, and gateway tests are organized by behavior, API/service/repository layer, contracts, and focused branch suites.
- **[6.3] Edge cases covered - High -> +3**: Functional Completeness is strong because sampled tests cover invalid payloads, auth refresh failure modes, PSBT/agent policy boundaries, null/default schemas, wallet access, and async timeout utilities.
- **[6.4] No flaky patterns - High -> +3**: ISO Testability is strong because direct sleep references are isolated to `server/tests/unit/utils/async.test.ts` and one test helper, not broad workflow tests.
- **[7.4] Logging quality - High -> +3**: Availability support is strong because `server/src/utils/logger.ts`, app/gateway loggers, request context, and redaction utilities provide contextual, redacted logging.

### Missing

- No scoring signal remains unknown.
- Reproducibility note: `gitleaks` was not installed on PATH, so this run downloaded gitleaks 8.30.1 to `/tmp/gitleaks-grade/gitleaks` and used that binary for the secret scans.
- Bundled `grade.sh` did not auto-detect the repo's `test:coverage` script name; coverage was measured directly with app, backend, and gateway coverage commands.

---

## Top Risks

1. App/backend coverage gates are red - test execution passes, but `npm run test:coverage` and `npm run test:backend:coverage` fail the repo's 100% global threshold; uncovered areas include recent app/admin-agent and agent-monitoring changes.
2. Complexity remains the largest score drag - lizard reports 110 functions above CCN 15, led by `components/WalletStats.tsx`, `components/send/SendTransactionPage.tsx`, `components/TransactionList/TransactionRow.tsx`, `components/LabelSelector.tsx`, and `components/LabelManager.tsx`.
3. God-file scoring remains poor - the largest physical file is a 2,637-line performance proof harness, and several warning-band production/test files remain between 801 and 962 lines.
4. Low-severity dependency advisories remain - root has 16 low advisories, gateway has 8 low advisories, and several npm suggested fixes are major-version downgrades or no-fix paths.
5. Secret-scan reproducibility depends on a temporary binary - gitleaks is clean, but it is not installed on PATH; the weaker fallback will keep reporting fixture/doc hits.

## Fastest Improvements

1. Restore the app/backend 100% coverage gate - expected score gain: 0 by rubric but removes a red project quality gate; effort: small to medium if recent uncovered branches are straightforward.
2. Reduce top lizard warnings - expected gain: up to +5 Maintainability if warnings reach 0; effort: high because 110 warnings remain.
3. Split or retire warning-band large files where reviewability improves - expected gain: governance and reviewability now, direct score gain only if largest physical files also drop below rubric thresholds; effort: medium to high.
4. Install or vendor a pinned gitleaks binary in CI/dev tooling - expected gain: confidence/reproducibility, avoids regex fixture noise; effort: small.
5. Continue low-advisory triage without unsafe major downgrades - expected gain: security posture stability, no current rubric points unless severity changes; effort: medium.

## Roadmap To Stable A

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 0 | Restore green quality gates | Cover or deliberately annotate the app/backend branches below 100%. | `npm run test:coverage` and `npm run test:backend:coverage` exit 0. | Score stays about `92/A`, but gates are green. |
| 1 | Reduce complexity concentration | Extract top JSX decision/render helpers from the highest CCN components. | lizard warnings trend below 15. | `+1` to `+3`. |
| 2 | Clear complexity threshold | Continue focused extractions until no function exceeds CCN 15. | `lizard_warning_count=0`. | Up to `+5`, about `97/A`. |
| 3 | Improve file-size signal only where useful | Split large production/test files for ownership and reviewability; avoid churn on proof/generated artifacts unless policy changes. | Large-file classification remains green and warning-band production files shrink. | Up to `+2` only if largest-file signal falls below thresholds. |
| 4 | Keep security and ops green | Pin gitleaks availability, rerun audits, and preserve validation/auth/architecture checks. | `security_high=0`, `secrets=0`, and contract checks pass repeatedly. | Preserves A-grade stability. |

## Strengths To Preserve

- Root, backend, and gateway native test suites are broad and fast enough to run during audits.
- High/critical dependency risk, lint, architecture-boundary drift, and secret scanning are all currently green.
- Request validation, OpenAPI coverage, browser-auth contracts, CSRF/cookie auth design, and gateway validation are explicitly checked.
- Agent dashboard data access now uses bulk grouped/windowed queries, which protects the new operational-spend features from obvious fan-out regressions.
- Operational readiness is mature: Docker/Compose, GitHub Actions, health endpoints, observability packages, request context, and redacted logging are present.

## Work To Defer Or Avoid

- Do not lower coverage thresholds just to turn the gate green; either cover the branches or document a narrow, justified exclusion.
- Do not accept npm audit suggestions that downgrade hardware-wallet or Firebase packages without behavior proof.
- Do not split generated/proof artifacts purely for score if ownership and reviewability do not improve.
- Do not relax lizard, architecture, lint, or validation gates to preserve the A grade.

## Verification Notes

- `git rev-parse --show-toplevel`, `git status --short --branch`, `git rev-parse --short HEAD`, `date '+%Y-%m-%d %Z'`, and `trend.sh prev sanctuary_ full` completed.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed: root tests pass, lint pass, typecheck pass, coverage unknown in the bundled script, audit initially hit sandbox DNS, regex fallback found 8 PEM-shaped fixture/doc hits, and heuristic signals were collected.
- `npm audit --json`, `npm --prefix server audit --json`, `npm --prefix gateway audit --json`, and `npm --prefix ai-proxy audit --json` completed: high/critical count is `0`; root/gateway still have low advisories.
- gitleaks 8.30.1 was downloaded with `gh release download`, extracted to `/tmp/gitleaks-grade`, and run in workspace, latest-commit, and tracked-tree modes; all scans found no leaks.
- `npm run test:coverage` ran 395 app test files and 5,541 tests successfully, then failed the 100% coverage gate with 99.89% line coverage.
- `npm run test:backend:coverage` ran 379 backend test files plus 22 skipped files, 9,087 passed tests plus 503 skipped tests, then failed the 100% coverage gate with 99.91% line coverage.
- `npm run test:coverage` in `gateway` passed: 20 files, 513 tests, and 100% line coverage.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard .` reported 110 warnings, average CCN 1.4, and max CCN 67.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade .` reported 2.13% duplication.
- `node scripts/quality/check-large-files.mjs` passed classification with 4 files over 1,000 lines.
- `npm run check:architecture-boundaries`, `npm run check:browser-auth-contract`, `npm run check:api-body-validation`, and `npm run check:openapi-route-coverage` passed.
