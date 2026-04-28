# Software Quality Report

Date: 2026-04-28
Owner: TBD
Status: Current

**Overall Score**: 96/100
**Grade**: A
**Confidence**: High
**Mode**: maintainability-remediation-pass-2
**Commit**: working-tree-after-b492ef11

Focused maintainability follow-up after PR #215 merged. Direct grade-style lizard findings dropped from 15 to 5 functions over the rubric's CCN > 15 threshold. No hard-fail gates are active.

---

## Hard-Fail Blockers

None.

Tests, typecheck, high/critical dependency audits, and current-tree gitleaks are clean. Gitleaks git-history scanning reports one redacted false positive in `docs/plans/grade-history/sanctuary_.jsonl` on the metadata key `secrets_tool`, not a credential; the current directory scan reports no leaks.

---

## Domain Scores

| Domain                |      Score | Notes                                                                                                                     |
| --------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------- |
| Correctness           |      20/20 | Native tests, lint, and typecheck pass; suppressions are sparse and mostly justified.                                     |
| Reliability           |      15/15 | Request/model paths use typed errors, bounded timeouts, retries, audit logging, fallback handling, and health checks.     |
| Maintainability       |      11/15 | Duplication is low at 2.19%, and lizard is down to 5 CCN > 15 functions; the largest source file remains 1,150 lines.     |
| Security              |      15/15 | High/critical audits are 0, current-tree gitleaks is clean, and Zod/schema validation is present at key trust boundaries. |
| Performance           |      10/10 | Sampled hot paths use bounded queries, batching, request limits, and async external I/O with timeouts.                    |
| Test Quality          |      15/15 | App, backend, and gateway coverage all report 100% with broad behavioral and edge-case tests.                             |
| Operational Readiness |      10/10 | Docker/Compose, CI workflows, health/readiness endpoints, tracing/metrics hooks, and structured logging are present.      |
| **TOTAL**             | **96/100** | No hard-fail cap applies.                                                                                                 |

---

## Trend

- vs 2026-04-28 (`85f0f7dd` initial direct-lizard run): overall `+3` (`93 -> 96`), grade `A -> A`, confidence `High -> High`.
- vs maintainability pass 1: overall `+2` (`94 -> 96`) as direct lizard warnings dropped from 15 to 5 after targeted AI proxy, UI/controller, backend service, worker queue, and e2e mock-handler refactors.

---

## Evidence

### Mechanical

| Signal                          | Value                                                                          | Tool                                                                                               | Scoring criterion                              |
| ------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| tests                           | pass; app 432 files / 5,829 tests                                              | `bash /home/nekoguntai/.codex/skills/grade/grade.sh`; `npm run test:coverage`                      | Correctness 1.1 -> +6                          |
| lint                            | pass                                                                           | `npm run lint` via grade collector                                                                 | Correctness 1.3 -> +3                          |
| typecheck                       | pass                                                                           | grade collector native typecheck chain                                                             | Correctness 1.2 -> +4                          |
| coverage                        | 100%; app 18,380 statements, backend 23,732 statements, gateway 564 statements | `npm run test:coverage`; `npm run test:backend:coverage`; `npm --prefix gateway run test:coverage` | Test Quality 6.1 -> +5                         |
| security_high                   | 0                                                                              | `npm audit --audit-level=high --json` in root, `server/`, `gateway/`, and `ai-proxy/`              | Security 4.1 -> +5                             |
| root_audit_low                  | 16                                                                             | root `npm audit --audit-level=high --json`                                                         | Context only; low severity does not affect 4.1 |
| secrets                         | 0 current-tree leaks                                                           | `.tmp/quality-tools/gitleaks-8.30.1/gitleaks dir . --redact`                                       | Security 4.2 -> +4                             |
| gitleaks_history_false_positive | 1                                                                              | `gitleaks detect --source . --redact`; match is `secrets_tool` metadata in grade history           | Not a concrete hardcoded secret                |
| lizard_warning_count            | 5                                                                              | `PYTHONPATH=/tmp/sanctuary-lizard-grade python3 -m lizard -w ... .`                                | Maintainability 3.1 -> +3                      |
| lizard_avg_ccn                  | 1.4                                                                            | lizard full summary; 563,273 NLOC / 48,141 functions                                               | Maintainability context                        |
| duplication_pct                 | 2.19%                                                                          | `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade .`                | Maintainability 3.2 -> +3                      |
| duplication_clones              | 290 exact clones / 6,463 duplicated lines                                      | jscpd JSON report                                                                                  | Maintainability context                        |
| largest_file_lines              | 1,150                                                                          | grade collector file-size scan                                                                     | Maintainability 3.3 -> +0                      |
| largest_file_path               | `scripts/perf/phase3-benchmark.mjs`                                            | grade collector file-size scan                                                                     | Maintainability context                        |
| suppression_count               | 24                                                                             | grade heuristic plus `rg` inspection                                                               | Correctness 1.4 judged                         |
| timeout_retry_count             | 1,281                                                                          | grade heuristic                                                                                    | Reliability/performance context                |
| blocking_io_count               | 48                                                                             | grade heuristic                                                                                    | Reliability/performance context                |
| validation_lib_present          | 1                                                                              | grade heuristic plus Zod/schema inspection                                                         | Security 4.3 judged                            |
| observability_lib_present       | 1                                                                              | grade heuristic plus tracing/metrics/logging inspection                                            | Operational 7.3 -> +2                          |
| logging_call_count              | 330                                                                            | grade heuristic                                                                                    | Operational 7.4 judged                         |
| health_endpoint_count           | 181                                                                            | grade heuristic plus health route inspection                                                       | Operational 7.2 -> +2                          |
| deploy_artifact_count           | 2                                                                              | Docker/Compose plus GitHub Actions workflows                                                       | Operational 7.1 -> +3                          |
| test_file_count                 | 1,272                                                                          | grade heuristic                                                                                    | Test Quality context                           |
| test_sleep_count                | 10                                                                             | grade heuristic; inspected tests mainly use fake timers                                            | Test Quality 6.4 judged                        |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=24` is low for the repository size, and sampled suppressions in `server/src/repositories/maintenanceRepository.ts`, `server/src/middleware/metrics.ts`, and tests are localized with explanations.
- **[1.5] Functional completeness - High -> +3**: README scope is broad but the current product surfaces have extensive route, service, UI, e2e, and coverage tests; remaining experimental disclaimers are risk disclosure rather than an obvious unfinished core workflow.
- **[2.1] Error handling quality - High -> +6**: `src/api/client.ts`, `server/src/api/console.ts`, `server/src/assistant/console/service.ts`, and `ai-proxy/src/aiClient.ts` preserve typed errors, response previews, audit failure records, and provider failure reasons.
- **[2.2] Timeouts and retries - High -> +4**: `src/api/client.ts`, `ai-proxy/src/aiClient.ts`, `gateway/src/middleware/requestLogger.ts`, and provider/model paths use `AbortSignal.timeout`, retry/backoff, or explicit timeout handling for external I/O.
- **[2.3] Crash-prone paths - High -> +5**: production routes use async handlers and typed/domain errors; direct process-exit and spawn patterns are concentrated in scripts, worker startup, or tested infrastructure utilities.
- **[3.4] Architecture clarity - High -> +3**: top-level boundaries across frontend, `server/`, `gateway/`, `ai-proxy/`, shared schemas, and tests remain clear despite local complexity hot spots.
- **[3.5] Readability/naming - High -> +2**: the remediation passes split AI/API/Console helpers, admin update handling, sync reconciliation, intelligence settings, health responses, OpenAPI route parsing, UI/controller helpers, backend worker/service flows, and e2e mock handlers; 5 known functions still exceed the mechanical gate.
- **[4.3] Input validation quality - High -> +3**: `ai-proxy/src/requestSchemas.ts`, `gateway/src/middleware/validateRequest.ts`, and `server/src/api/console.ts` apply Zod/schema validation at AI, gateway, and server request boundaries.
- **[4.4] Safe system/API usage - High -> +3**: sampled `$queryRaw` calls use Prisma tagged templates, Redis `eval` scripts are static, and child-process usage is in scripts/support checks rather than user-string shell construction.
- **[5.1] Hot-path efficiency - High -> +5**: `components/ConsoleResults/transactionResults.ts`, `server/src/repositories/agentDashboardRepository.ts`, and Console result loading use limits, dedupe, sorted aggregation, and batched database access.
- **[5.2] Data access patterns - High -> +3**: sampled repository paths group counts/balances in the database and avoid per-row query fan-out in dashboard and transaction-result flows.
- **[5.3] No blocking in hot paths - High -> +2**: `blocking_io_count=48` is mostly scripts, maintenance, health/support collectors, or startup utilities; request-facing external calls use async APIs and timeouts.
- **[6.2] Test structure - High -> +4**: tests are organized by UI behavior, API contracts, backend services/routes, gateway middleware, AI proxy protocols, and e2e smoke/render flows.
- **[6.3] Edge cases covered - High -> +3**: coverage includes empty/invalid request bodies, auth and feature gates, local-provider failures, non-JSON API errors, date parsing, wallet access filters, and persistence edge cases.
- **[6.4] No flaky patterns - High -> +3**: direct wait evidence is low and most time-sensitive tests use `vi.useFakeTimers`; one `page.waitForTimeout(200)` in `e2e/wallet-sharing-privacy.spec.ts` is isolated.
- **[7.4] Logging quality - High -> +3**: `gateway/src/middleware/requestLogger.ts`, backend health/audit paths, and AI proxy logging include request IDs, context objects, status/duration, and redacted credential handling.

### Missing

- None for final scored signals.
- Note: the bundled grade collector could not see lizard, jscpd, gitleaks, or coverage from PATH and initially emitted weaker fallback signals; explicit runs above supersede those gaps.

---

## Top Risks

1. **Remaining complexity threshold warnings** - 5 functions still exceed CCN > 15: four large animation scenes and `server/tests/mocks/aiContainer.ts`.
2. **Raw file-size gate remains failed** - `scripts/perf/phase3-benchmark.mjs` is 1,150 lines and the next largest files are still near or above the 800-line warning range.
3. **Root audit has 16 low-severity advisories** - no high/critical issues, but hardware-wallet/polyfill transitive dependency risk should remain tracked.

## Fastest Improvements

1. Split `server/tests/mocks/aiContainer.ts` into smaller mock response builders - expected +1 maintainability point - low to medium effort.
2. Split the four animation scene initializers into setup/update/draw helpers - expected +1 to +2 maintainability points - medium effort.
3. Keep `scripts/perf/phase3-benchmark.mjs` classified if it remains a proof harness, but split report-writing/runtime orchestration if touched - expected +2 maintainability points - medium effort.

## Roadmap To A Grade

| Phase | Target                         | Work                                                                                                      | Exit Criteria                                             | Expected Score Movement |
| ----- | ------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------- |
| 1     | Preserve A while reducing risk | Add a pinned lizard workflow/script and baseline the warning budget at 15.                                | `npm run quality:lizard` passes and fails on regressions. | Complete                |
| 2     | Recover more maintainability   | Refactor 10 remaining high-impact CCN functions into helpers/controllers.                                 | `lizard_warning_count` drops to 1-5.                      | Complete                |
| 3     | Reach near-perfect score       | Clear all CCN > 15 warnings and address the >1,000-line file gate when the proof harness is next touched. | `lizard_warning_count=0` and `largest_file_lines<1000`.   | +5 to +7                |

## Strengths To Preserve

- 100% app/backend/gateway coverage gates with extensive behavioral edge-case coverage.
- Low duplication at 2.19% despite a large test and e2e surface.
- Typed schema validation at browser API, gateway, server, and AI proxy boundaries.
- Structured contextual logging, request IDs, health endpoints, Docker/Compose, and GitHub Actions workflows.
- Provider endpoint policy and credential omission behavior for local OpenAI-compatible/LM Studio flows.

## Work To Defer Or Avoid

- Do not downgrade lizard or file-size gates to preserve the previous score; the current mechanical evidence is actionable.
- Do not force-upgrade Ledger/Trezor transitive crypto dependencies solely for low-severity audit noise without device-flow regression proof.
- Do not split cohesive proof harnesses unless the file is being actively changed or blocks review.

## Verification Notes

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - tests, lint, typecheck, file-size, operational, and heuristic signals collected; npm audit failed inside sandbox DNS and was rerun directly.
- `npm audit --audit-level=high --json` in root, `server/`, `gateway/`, and `ai-proxy/` - 0 high/critical findings; root has 16 low findings.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks dir . --redact --no-banner --no-color --report-format json --report-path /tmp/sanctuary-gitleaks-dir.json` - no current-tree leaks.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --redact --no-banner --no-color --report-format json --report-path /tmp/sanctuary-gitleaks.json` - one git-history false positive on `secrets_tool` metadata.
- `PYTHONPATH=/tmp/sanctuary-lizard-grade python3 -m lizard -w -C 15 -x ... .` - 5 warnings: four animations plus `server/tests/mocks/aiContainer.ts`.
- `npm run quality:lizard` - passed with current budget 5.
- `npm run check:openapi-route-coverage` - passed after documenting Console prompt clearing and session deletion DELETE routes.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade .` - 2.19% duplicated lines, 290 exact clones.
- `npm run test:coverage` - 432 files, 5,829 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` - 419 passed files, 9,458 passed tests, 22 skipped files, 505 skipped tests, 100% statements/branches/functions/lines.
- `npm --prefix gateway run test:coverage` - 21 files, 528 tests, 100% statements/branches/functions/lines.
