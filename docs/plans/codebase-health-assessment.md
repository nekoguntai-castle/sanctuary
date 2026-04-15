# Software Quality Report

Date: 2026-04-15 (Pacific/Honolulu)
Owner: TBD
Status: Draft

**Overall Score**: 94/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: d8d884d8

---

## Hard-Fail Blockers

None.

- `tests=pass`, `typecheck=pass`, and `lint=pass`; no ISO 25010 Functional Correctness hard-fail gate fired.
- `security_high=0`; root has 16 low advisories, server has 0 advisories, and gateway has 8 low advisories, but no high or critical audit finding.
- `secrets=0` from `gitleaks` full-tree, latest-commit, and tracked-tree scans. The bundled `grade.sh` rg fallback reported 8 PEM-shaped hits, but direct inspection and `.gitleaks.toml` show they are dummy test fixtures or planning notes, not production credentials.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Vitest, lint, typecheck, browser-auth contract, API body validation, architecture-boundary, and OpenAPI route-coverage checks pass. |
| Reliability | 12/15 | Error handling, retry, timeout, refresh-lock, DB retry, and shutdown-drain patterns are strong; controlled `process.exit` paths and authenticated-route non-null assertions keep crash-prone-path scoring at Medium. |
| Maintainability | 13/15 | `lizard` reports 0 functions with CCN > 15 and `AvgCCN=1.35`; `jscpd` duplication is 2.31%; architecture checks pass. The mechanical file-size score remains 0 because four classified proof/generated/fixture files exceed 1,000 lines. |
| Security | 15/15 | High/critical dependency debt is 0, `gitleaks` is clean, Zod validation exists at server/gateway trust boundaries, and inspected SQL/system-call patterns are parameterized or fixed-argument. |
| Performance | 9/10 | Hot request paths use timeouts, batching, aggregate queries, and async I/O; remaining sync/blocking work is mostly startup, admin, maintenance, support-package, or proof-harness code. |
| Test Quality | 15/15 | 5,506 Vitest tests pass with 100% statement/branch/function/line coverage; direct test `setTimeout(` usage is 0 and remaining `sleep(...)` references are isolated to the async helper's own tests. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, Prometheus metrics, observability libraries, structured logging/redaction, and operational proof scripts are present. |
| **TOTAL** | **94/100** | |

---

## Trend

- vs 2026-04-15 (`a2109a72`): overall `+1` (`93 -> 94`), grade `A -> A`, confidence `High -> High`.
- Main score movement: Test Quality now follows the rubric exactly for flaky-pattern scoring (`High -> +3`) because direct timer sleeps are absent outside the async helper tests. Mechanical maintainability remains capped by the largest physical source files.

## Post-Audit Cleanup

Completed after the scored snapshot; the `94/A` score above has not been recalculated by a new full grade run in this cleanup pass.

- Replaced authenticated-route `req.user!` non-null assertions with `requireAuthenticatedUser(req)` from `server/src/middleware/auth.ts`.
- Centralized direct process exits behind small helpers in `server/`, `gateway/`, and `ai-proxy/`; `process.exit` now appears only in those helpers.
- Added Zod request schemas for AI proxy mutable endpoints in `ai-proxy/src/requestSchemas.ts` and added direct `zod@^4.3.4` dependency coverage for the package.
- Refreshed dependency triage in `docs/DEPENDENCY_AUDIT_TRIAGE.md`, including AI proxy audit state.
- Muted/asserted expected frontend failure-path output in targeted tests by mocking app reload navigation and asserting intentional error logs.

Focused verification after this cleanup:
- `npm run build` in `ai-proxy/`, `gateway/`, and `server/` passed.
- `npm run lint` passed, including `check:api-body-validation`.
- `npm run typecheck:app` passed.
- `npm run typecheck:tests` passed.
- `npx vitest run tests/App.branches.test.tsx tests/components/AuditLogs.branches.test.tsx tests/contexts/AppNotificationContext.test.tsx --reporter=dot` passed with 58 tests and no expected jsdom/error-log noise.
- New helper/schema coverage passed: root AI-proxy/browser wrapper tests (9 tests), server auth/process-exit tests (55 tests), and gateway process-exit tests (3 tests).
- `npm run test:run -- --reporter=dot` in `server/` passed with 8,834 tests and 503 skipped.
- Audit refresh: root high gate passed with 16 low advisories; `server/` and `ai-proxy/` report 0 vulnerabilities; `gateway/` remains 8 low in full install and 0 with `--omit=dev --omit=optional`.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; 388 files, 5,506 tests | `bash /home/nekoguntai/.codex/skills/grade/grade.sh`; `npm run test:coverage` | Correctness 1.1 |
| typecheck | pass | `grade.sh` native TypeScript check | Correctness 1.2 |
| lint | pass | `grade.sh` native lint; `npm run check:api-body-validation` passed | Correctness 1.3 |
| suppression_count | 22 | `grade.sh` heuristic plus direct inspection | Correctness 1.4 |
| browser_auth_contract | pass; 552 browser files scanned | `npm run check:browser-auth-contract` | Correctness 1.5 |
| architecture_boundaries | pass; 1,298 files, 5,421 imports, 9 rules, 40 exceptions | `npm run check:architecture-boundaries` | Maintainability 3.4 |
| openapi_route_coverage | pass; 288 Express routes, 284 OpenAPI operations, 4 documented exceptions | `npm run check:openapi-route-coverage` | Correctness 1.5 / Maintainability 3.4 |
| coverage | 100% statements, branches, functions, lines | `npm run test:coverage`; 14,184/14,184 statements, 10,581/10,581 branches, 3,594/3,594 functions, 13,231/13,231 lines | Test Quality 6.1 |
| security_high | 0 | `npm audit --audit-level=high --json`, `npm --prefix server audit --audit-level=high --json`, `npm --prefix gateway audit --audit-level=high --json` | Security 4.1 |
| dependency_advisories | root 16 low; server 0; gateway 8 low | npm audit metadata | Top Risks |
| secrets | 0 | `/tmp/gitleaks detect`, `/tmp/gitleaks git`, `scripts/gitleaks-tracked-tree.sh` | Security 4.2 |
| secrets_rg_fallback_hits | 8 dummy/test/doc hits | `grade.sh` rg fallback plus direct inspection | Security 4.2 false-positive context |
| lizard_warning_count | 0 | `.tmp/quality-tools/lizard-1.21.2/bin/lizard`; 28,977 functions | Maintainability 3.1 |
| lizard_avg_ccn | 1.35 | pinned `lizard` CSV output | Maintainability 3.1 |
| lizard_max_ccn | 15 | pinned `lizard` CSV output | Maintainability 3.1 |
| duplication_pct | 2.31% | `npx --yes jscpd@4`; 5,380/232,768 duplicated lines, 275 clones, 1,516 files | Maintainability 3.2 |
| largest_file_lines | 2,637 | `grade.sh`; `scripts/perf/phase3-compose-benchmark-smoke.mjs` | Maintainability 3.3 |
| large_file_classification | pass; 4 files >1,000 lines and all classified | `node scripts/quality/check-large-files.mjs` | Maintainability 3.3 context |
| deploy_artifact_count | 2 | `grade.sh`; Dockerfile/Compose plus GitHub Actions CI | Operational Readiness 7.1 |
| health_endpoint_count | 174 | `grade.sh` heuristic evidence | Operational Readiness 7.2 |
| observability_lib_present | 1 | `grade.sh` heuristic evidence; Prometheus metrics imports inspected | Operational Readiness 7.3 |
| validation_lib_present | 1 | `grade.sh`; Zod found in server/gateway/shared validation | Security 4.3 |
| timeout_retry_count | 1,178 | `grade.sh` heuristic evidence | Reliability 2.2 |
| blocking_io_count | 36 | `grade.sh` heuristic evidence | Performance 5.1/5.3 |
| logging_call_count | 318 | `grade.sh` heuristic evidence | Operational Readiness 7.4 |
| test_file_count | 1,152 | `grade.sh` heuristic evidence; Vitest executed 388 test files | Test Quality 6.2 |
| direct_test_set_timeout_count | 0 | `rg "setTimeout\\(" server/tests tests gateway/tests --glob '*.{ts,tsx}'` | Test Quality 6.4 |
| test_sleep_count | 10 | `rg "\\bsleep\\(" server/tests tests gateway/tests --glob '*.{ts,tsx}'`; all matches are in `server/tests/unit/utils/async.test.ts` | Test Quality 6.4 |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=22` is low for the repository size, and inspected suppressions are concentrated in interop/testability or validated dynamic-access paths such as `server/src/repositories/maintenanceRepository.ts`, `server/src/errors/errorHandler.ts`, and hardware-wallet adapters.
- **[1.5] Functional completeness - High -> +3**: Browser-auth, API body validation, architecture-boundary, and OpenAPI route-coverage contracts pass, and the test suite covers app, server-adjacent shared code, gateway, hooks, services, components, and documentation links.
- **[2.1] Error handling quality - High -> +6**: `server/src/errors/errorHandler.ts`, `src/api/client.ts`, `src/api/refresh.ts`, `gateway/src/middleware/validateRequest.ts`, and `server/src/models/prisma.ts` preserve contextual errors and map expected failure modes to typed responses or operational logs.
- **[2.2] Timeouts and retries - High -> +4**: `src/api/client.ts`, `src/api/refresh.ts`, `server/src/models/prisma.ts`, `server/src/services/sync/walletSync.ts`, Electrum pool/client modules, and AI service calls use retry, backoff, lock, abort-timeout, or drain patterns around external I/O.
- **[2.3] Crash-prone paths - Medium -> +2**: `server/src/index.ts`, `server/src/worker.ts`, `gateway/src/index.ts`, and `ai-proxy/src/index.ts` use controlled process exits, and many authenticated handlers rely on `req.user!` after auth middleware.
- **[3.4] Architecture clarity - High -> +3**: Top-level boundaries are explicit across app, server, gateway, shared schemas, scripts, and tests, with enforcement by `scripts/check-browser-auth-contract.mjs`, `scripts/check-architecture-boundaries.mjs`, and `scripts/check-openapi-route-coverage.mjs`.
- **[3.5] Readability/naming - High -> +2**: Sampled modules `src/api/client.ts`, `src/api/refresh.ts`, `server/src/middleware/validate.ts`, `gateway/src/middleware/validateRequest.ts`, `server/src/models/prisma.ts`, `server/src/services/wallet/walletQueries.ts`, and `ai-proxy/src/index.ts` use direct names and targeted comments where policy is non-obvious.
- **[4.3] Input validation quality - High -> +3**: Server and gateway trust boundaries use Zod via `server/src/middleware/validate.ts`, `gateway/src/middleware/validateRequest.ts`, `shared/schemas/mobileApiRequests.ts`, and `server/src/config/schema.ts`; `ai-proxy/src/index.ts` adds manual guards and delegates sensitive data access back through backend validation.
- **[4.4] Safe system/API usage - High -> +3**: Inspected raw SQL uses Prisma tagged templates such as `server/src/repositories/addressRepository.ts`, Redis Lua calls are fixed scripts in `server/src/infrastructure/distributedLock.ts` and rate limiting, and searches found no user-fed `eval`, `innerHTML`, or unsafe raw SQL pattern.
- **[5.1] Hot-path efficiency - High -> +5**: Request-facing API clients and services use timeouts, retry controls, async fetches, DB query metrics, and scoped repository calls rather than blocking network work.
- **[5.2] Data access patterns - High -> +3**: `server/src/services/wallet/walletQueries.ts`, transaction repositories, UTXO repositories, and sync paths use aggregate queries, `createMany`, selective projections, and batch Electrum fallbacks instead of obvious request-path N+1 loops.
- **[5.3] No blocking in hot paths - Medium -> +1**: `blocking_io_count=36` is mostly in startup, migration, maintenance, support-package, ops, or proof scripts, but the static signal is nonzero and some admin paths still run process/file operations.
- **[6.2] Test structure - High -> +4**: Tests are organized by component, hook, API, service, shared utility, gateway, backend, install, e2e, and contract scopes, with clear behavioral naming.
- **[6.3] Edge cases covered - High -> +3**: Sampled tests cover invalid input, null/undefined fallbacks, error branches, auth cleanup, parse failures, dust/change boundaries, privacy warnings, websocket events, and RBF/replacement cases.
- **[6.4] No flaky patterns - High -> +3**: Direct `setTimeout(` usage in tests is 0, and all 10 `sleep(...)` references are in the async helper's own test file; expected stderr/jsdom navigation output is noisy but not evidence of timing flake.
- **[7.4] Logging quality - High -> +3**: `server/src/utils/logger.ts`, `utils/logger.ts`, and `shared/utils/redact.ts` provide module-scoped structured context, request/trace enrichment, and sensitive-field redaction.

### Missing

- No scoring signal remains unknown. The bundled `grade.sh` did not detect the existing coverage script and used the weaker rg secret fallback because `gitleaks` is not on PATH, so this report uses targeted `npm run test:coverage`, pinned `lizard`, `jscpd`, and `/tmp/gitleaks` runs as higher-confidence evidence.

---

## Top Risks

1. Mechanical file-size debt remains - largest file is `scripts/perf/phase3-compose-benchmark-smoke.mjs` at 2,637 lines, and four classified proof/generated/fixture files exceed 1,000 lines.
2. Low dependency advisory debt persists - root has 16 low advisories and gateway has 8 low advisories; no high/critical gate fires today, but this should stay triaged.
3. Crash-prone production assumptions were reduced after the scored snapshot by centralizing exits and removing authenticated-route `req.user!` assertions; a full grade rerun should re-score Reliability 2.3.
4. AI proxy request bodies are now schema-validated after the scored snapshot; keep schema drift covered as new AI routes are added.
5. Targeted expected stderr/jsdom navigation noise was muted or asserted after the scored snapshot; full coverage should remain monitored for new warning output.

## Fastest Improvements

1. Split or further constrain the classified proof/generated large files only where it improves reviewability - expected point gain: Maintainability +2 if `largest_file_lines <500`; effort: medium/high.
2. Completed after scored snapshot: AI proxy request-body checks now use Zod schemas.
3. Completed after scored snapshot: hard process-exit handling is centralized behind shutdown helpers.
4. Refreshed after scored snapshot: low advisory triage now includes AI proxy audit state.
5. Completed after scored snapshot: targeted tests now assert or mute expected error logs and jsdom navigation behavior.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 0 | Preserve current A | Keep tests, lint, typecheck, coverage, audits, gitleaks, lizard, jscpd, and contract checks green. | All hard-fail gates remain clear. | Keeps `94/A` stable. |
| 1 | Reduce crash-prone assumptions | Completed after scored snapshot: shutdown exits are centralized and `req.user!` reliance was replaced with typed helper access. | Reliability 2.3 can be rescored from inspected production paths on the next full grade run. | +3 possible. |
| 2 | Improve trust-boundary consistency | Completed after scored snapshot: AI proxy mutable request bodies use Zod schemas. | AI proxy routes reject malformed bodies consistently before business logic. | Risk reduction. |
| 3 | Address file-size score | Split only proof/generated/fixture files where ownership or review friction is real. | Largest scored source file drops below 1,000 lines, ideally below 500. | +1 to +2 possible. |
| 4 | Lower advisory drift | Refreshed after scored snapshot; continue upgrading or replacing low-advisory chains when safe non-forced paths exist. | Root/gateway low advisories decrease without major-version regression. | Security resilience. |

## Strengths To Preserve

- Repo-owned quality gates cover lint, typecheck, browser auth, architecture boundaries, OpenAPI route coverage, API body validation, coverage, audits, secret scanning, complexity, duplication, and large-file classification.
- Browser auth/CSRF and refresh behavior is centralized in `src/api/authPolicy.ts`, `src/api/client.ts`, and `src/api/refresh.ts`.
- Gateway and backend validation share Zod request schemas through `shared/schemas/mobileApiRequests.ts`.
- Logging and support metadata use shared redaction helpers through `shared/utils/redact.ts`.
- Docker/Compose, GitHub Actions, health endpoints, metrics, worker health, and ops proof scripts support deployment readiness.

## Work To Defer Or Avoid

- Do not relax coverage, secret scanning, or architecture checks to reduce noise; the current gates are valuable and passing.
- Do not split large generated/proof files purely for a score unless it reduces real review or ownership cost.
- Do not start a framework or service rewrite while targeted boundary checks and service extraction are already working.
- Do not treat low advisory debt as resolved; keep it triaged until safe upstream fixes exist.

## Verification Notes

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed: tests, lint, typecheck, file-size, operational, and heuristic signals collected. Its sandboxed npm audit hit a registry DNS failure, so audit was rerun directly.
- `npm audit --audit-level=high --json` completed with 16 low, 0 moderate/high/critical advisories.
- `npm --prefix server audit --audit-level=high --json` completed with 0 advisories.
- `npm --prefix gateway audit --audit-level=high --json` completed with 8 low, 0 moderate/high/critical advisories.
- `npm run test:coverage` passed: 388 files, 5,506 tests, 100% statements/branches/functions/lines.
- `npm run check:browser-auth-contract`, `npm run check:architecture-boundaries`, `npm run check:openapi-route-coverage`, and `npm run check:api-body-validation` passed.
- `/tmp/gitleaks detect --source . --no-git --redact --config .gitleaks.toml`, `/tmp/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1`, and `GITLEAKS_BIN=/tmp/gitleaks bash scripts/gitleaks-tracked-tree.sh` found no leaks.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard` produced `0` functions with CCN > 15, `AvgCCN=1.35`, and max CCN 15 across 28,977 functions.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-grade-jscpd .` reported 2.31% duplication, 5,380 duplicated lines, 275 clones, and 1,516 files.
- `node scripts/quality/check-large-files.mjs` passed with four classified files over 1,000 lines.
- Trend history appended to `docs/plans/grade-history/sanctuary_.jsonl`.
