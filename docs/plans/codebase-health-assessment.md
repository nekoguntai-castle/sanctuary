# Software Quality Report

Date: 2026-04-22 21:22 HST
Owner: TBD
Status: Draft

**Overall Score**: 97/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: working-tree-after-936cbd94-lizard-cleanup

---

## Hard-Fail Blockers

None.

- `tests=pass`: app tests pass; backend and gateway coverage suites pass.
- `typecheck=pass`: TypeScript app, scripts, and gateway checks pass.
- `lint=pass`: app, server, and gateway lint passes.
- `security_high=0`: root, server, gateway, and AI proxy audits report 0 high/critical advisories.
- `secrets=0`: pinned gitleaks direct, latest-commit, and tracked-tree scans found no leaks.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Tests, lint, typecheck, browser-auth contract, OpenAPI route coverage, and architecture checks are green. |
| Reliability | 15/15 | Request timeouts, retry/backoff, typed error handling, and rate-limit failure behavior are present by inspection. |
| Maintainability | 12/15 | Lizard is back to 0 warnings and duplication stays below threshold; the largest classified proof harness remains 2,686 lines. |
| Security | 15/15 | No high/critical dependency advisories, no gitleaks findings, 0 open CodeQL alerts, 0 open Dependabot alerts, and validation remains strong at trust boundaries. |
| Performance | 10/10 | Sampled request and repository hot paths use async bounded I/O, bulk/grouped queries, and windowed recent-record access. |
| Test Quality | 15/15 | App, backend, and gateway coverage summaries are all 100% statements/branches/functions/lines. |
| Operational Readiness | 10/10 | Docker/Compose, GitHub CI, health endpoints, observability metrics, and contextual logging are present. |
| **TOTAL** | **97/100** | Grade A; no hard-fail cap applied. |

---

## Trend

- vs 2026-04-22 (`936cbd94`): overall `+2` (`95 -> 97`), grade `A -> A`, confidence `High -> High`.
- Primary movement: maintainability returned to the prior baseline because lizard now reports 0 warnings after refactoring `gateway/src/middleware/auth.ts` and `scripts/perf/phase3-benchmark.mjs`.
- Security inventory remains clean: GitHub reports 0 open code-scanning alerts and 0 open Dependabot alerts after the recent CodeQL and elliptic triage work.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; app 401 files / 5,593 tests | `env GRADE_TIMEOUT=600 bash /home/nekoguntai/.codex/skills/grade/grade.sh` | Correctness 1.1 -> +6 |
| typecheck | pass | `npm run typecheck`, `npm run typecheck:scripts`, `npm --prefix gateway run build`; grade collector typecheck | Correctness 1.2 -> +4 |
| lint | pass | `npm run lint` via grade collector | Correctness 1.3 -> +3 |
| suppression_count | 24 | grade heuristic; inspected suppressions are documented/test/coverage artifacts | Correctness 1.4 -> +4 judged |
| functional completeness | high | test/contract surface plus route coverage checks | Correctness 1.5 -> +3 judged |
| coverage | app 100%, backend 100%, gateway 100% statements/branches/functions/lines | V8/Vitest coverage summaries | Test Quality 6.1 -> +5 |
| backend coverage | 392 passed files, 22 skipped; 9,191 passed tests, 503 skipped | `npm run test:backend:coverage` outside sandbox | Test Quality context |
| gateway coverage | 21 files, 527 tests | `npm --prefix gateway run test:coverage` | Test Quality context |
| security_high | 0 | `npm audit --json`; `npm --prefix server/gateway/ai-proxy audit --json` | Security 4.1 -> +5 |
| root_audit | 16 low, 0 moderate/high/critical | `npm audit --json` | Security 4.1 context |
| server_audit | 0 vulnerabilities | `npm --prefix server audit --json` | Security 4.1 context |
| gateway_audit | 0 vulnerabilities | `npm --prefix gateway audit --json` | Security 4.1 context |
| ai_proxy_audit | 0 vulnerabilities | `npm --prefix ai-proxy audit --json` | Security 4.1 context |
| secrets | 0 | `.tmp/quality-tools/gitleaks-8.30.1/gitleaks` direct, latest-commit, tracked-tree scans | Security 4.2 -> +4 |
| rg_secret_fallback | 8 raw PEM/API-shaped hits; all are allowlisted fixtures/prose | `rg` fallback plus `.gitleaks.toml` inspection | Security 4.2 context |
| open_code_scanning_alerts | 0 | `gh api .../code-scanning/alerts -f state=open` | Security context |
| open_dependabot_alerts | 0 | `gh api .../dependabot/alerts -f state=open` | Security context |
| validation_lib_present | 1 | grade heuristic; Zod validation inspected | Security 4.3 -> +3 judged |
| lizard_warning_count | 0 | pinned lizard 1.21.2, `-C 15 -T nloc=200` | Maintainability 3.1 -> +5 |
| lizard_avg_ccn | 1.4 | pinned lizard 1.21.2 | Maintainability 3.1 context |
| lizard_warning_details | none | pinned lizard 1.21.2 | Maintainability context |
| duplication_pct | 2.29%; 281 clones, 6,171 duplicated lines | `npx --yes jscpd@4` | Maintainability 3.2 -> +3 |
| largest_file_lines | 2,686 | `scripts/perf/phase3-compose-benchmark-smoke.mjs` | Maintainability 3.3 -> +0 |
| large_file_classification | pass; 4 files over 1,000 lines, 5 over warning limit | `node scripts/quality/check-large-files.mjs` | Maintainability context |
| architecture_boundaries | pass; 1,856 files, 7,169 imports, 9 rules, 40 exceptions | `npm run check:architecture-boundaries` | Maintainability 3.4 -> +3 judged |
| browser_auth_contract | pass; 1,047 browser files scanned | `npm run check:browser-auth-contract` | Correctness context |
| openapi_route_coverage | pass; 315 Express routes, 311 OpenAPI operations, 4 documented exceptions | `npm run check:openapi-route-coverage` | Correctness context |
| deploy_artifact_count | 2 | grade collector | Operational Readiness 7.1 -> +3 |
| health_endpoint_count | 180 | grade heuristic | Operational Readiness 7.2 -> +2 |
| observability_lib_present | 1 | grade heuristic plus `server/src/observability` inspection | Operational Readiness 7.3 -> +2 |
| logging_call_count | 319 | grade heuristic plus logger inspection | Operational Readiness 7.4 -> +3 judged |
| timeout_retry_count | 1,218 | grade heuristic | Reliability 2.2 context |
| blocking_io_count | 37 | grade heuristic; sampled hits are scripts/startup/support/maintenance paths | Performance 5.1/5.3 context |
| test_file_count | 1,207 | grade heuristic | Test Quality 6.2 context |
| test_sleep_count | 10 | grade heuristic; direct sleeps isolated to async helper tests | Test Quality 6.4 context |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: suppressions are low relative to repository size and inspected hits are documented defensive branches, coverage artifacts, dynamic Prisma access, or test-only overrides.
- **[1.5] Functional completeness - High -> +3**: app/server/gateway tests plus browser auth, OpenAPI route coverage, and architecture checks cover the stated product surfaces.
- **[2.1] Error handling quality - High -> +6**: `src/api/client.ts`, `server/src/middleware/validate.ts`, and `server/src/errors/errorHandler.ts` use typed errors, structured failure responses, and request correlation.
- **[2.2] Timeouts and retries - High -> +4**: `src/api/client.ts`, `server/src/middleware/requestTimeout.ts`, `server/src/middleware/rateLimit.ts`, and gateway rate limiters provide bounded retries, route timeouts, and explicit retry-after behavior.
- **[2.3] Crash-prone paths - High -> +5**: sampled production paths avoid broad crash-only behavior; process exits and child-process usage are concentrated in scripts/startup/maintenance utilities.
- **[3.4] Architecture clarity - High -> +3**: architecture-boundary checks pass with explicit rules and documented exceptions.
- **[3.5] Readability/naming - Medium -> +1**: naming is generally clear, but the classified proof-harness size justifies keeping maintainability pressure on this area.
- **[4.3] Input validation quality - High -> +3**: Zod middleware validates body, params, and query at HTTP trust boundaries, and gateway request validation is covered by tests.
- **[4.4] Safe system/API usage - High -> +3**: inspected `eval` usage is Redis Lua, raw SQL uses Prisma/tagged patterns, `innerHTML` hits are test-only, and child-process usage is bounded to scripts/admin support paths.
- **[5.1] Hot-path efficiency - High -> +5**: sampled request-facing paths use async fetch/DB/Redis/Electrum calls with limits, timeouts, and retry/backoff.
- **[5.2] Data access patterns - High -> +3**: `server/src/repositories/agentDashboardRepository.ts` and support stats repositories use grouped/windowed queries and `Promise.all` rather than per-row fan-out.
- **[5.3] No blocking in hot paths - High -> +2**: blocking I/O evidence is concentrated in scripts, startup, support-package, and maintenance code rather than request hot paths.
- **[6.2] Test structure - High -> +4**: tests are organized by API, service, repository, integration, contract, branch, and UI behavior surfaces.
- **[6.3] Edge cases covered - High -> +3**: sampled tests cover invalid schemas, auth expiry, rate-limit boundaries, timeout behavior, null/default branches, and wallet/device access checks.
- **[6.4] No flaky patterns - High -> +3**: timer-heavy tests use fake timers; direct sleeps are isolated to async utility tests.
- **[7.4] Logging quality - High -> +3**: `server/src/utils/logger.ts` sanitizes control characters, redacts sensitive fields, and includes request/trace context.

### Missing

- None after supplemental runs. The bundled collector did not detect the repo's nonstandard coverage script name and initially hit sandbox DNS/listen limits, so explicit coverage and audit commands were run as verification evidence.

---

## Top Risks

1. Classified proof/generated files remain very large - expensive review if they change frequently - `scripts/perf/phase3-compose-benchmark-smoke.mjs` at 2,686 lines.
2. Root dependency audit still has 16 low advisories - currently no high/critical score impact, but revisit when safe upstream wallet/polyfill fixes exist.
3. Future complexity regressions can still erode maintainability if the lizard gate is not kept in the local-first workflow.

## Fastest Improvements

1. Keep watching root low advisories for safe patch releases - expected security risk reduction, no immediate score gain - small recurring.
2. Consider a generated/proof-harness review checklist for large classified files - expected review-risk reduction, no direct score gain - small.
3. Keep the lizard gate in the local pre-push path so complexity regressions are fixed before PR checks run.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| A1 | Restore prior 97 baseline | Refactor `assertJwtPayload` and `provisionBenchmarkFixture` below lizard thresholds. | Done: `lizard_warning_count=0`; focused gateway auth test and benchmark syntax check pass. | `+2` achieved |
| A2 | Preserve security posture | Re-check low root advisories when parent packages publish real patches. | `npm audit --json` has no risky forced downgrades and no high/critical findings. | `0` to `+0` |
| A3 | Reduce review risk | Keep classified proof/generated files stable or add focused owners/review notes when they change. | Large-file classification stays passing and high-churn large files have owner context. | `0` |

## Strengths To Preserve

- 100% coverage gates across app, backend, and gateway.
- Blocking GitHub quality checks for lint, gitleaks, lizard, jscpd, CodeQL, and required test summaries.
- Zod request validation and route-coverage checks at HTTP boundaries.
- Exposure-aware rate limiting with private-network-friendly defaults and stricter controls on sensitive routes.

## Work To Defer Or Avoid

- Do not split generated/vector/proof artifacts just to recover file-size points unless they become frequently hand-edited.
- Do not accept npm audit suggestions that downgrade wallet/polyfill packages without behavior proof.
- Do not relax coverage, lizard, architecture, lint, route coverage, validation, or gitleaks gates.

## Verification Notes

- `git status --short --branch` - expected lizard cleanup worktree on `main...origin/main` before PR branch creation.
- `env GRADE_TIMEOUT=600 bash /home/nekoguntai/.codex/skills/grade/grade.sh` - tests/lint/typecheck passed; heuristics collected; npm audit DNS failed inside sandbox and was rerun directly.
- `npm audit --json` - root audit completed with 16 low and 0 high/critical vulnerabilities.
- `npm --prefix server audit --json`, `npm --prefix gateway audit --json`, `npm --prefix ai-proxy audit --json` - all completed with 0 vulnerabilities.
- `npm run test:coverage:full` - app coverage completed, then backend failed in sandbox with `listen EPERM`; not treated as a code failure.
- `npm run test:backend:coverage` outside sandbox - passed with 100% coverage.
- `npm --prefix gateway run test:coverage` - passed with 100% coverage.
- `node -e ... coverage-summary.json ...` - app, backend, and gateway summaries all report 100%.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner` - no leaks found.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1` - no leaks found.
- `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh` - no leaks found.
- `npm --prefix gateway run test:run -- tests/unit/middleware/auth.test.ts` - 20 focused gateway auth tests passed after the payload-validation refactor.
- `node --check scripts/perf/phase3-benchmark.mjs` - benchmark script syntax check passed after the fixture-provisioning refactor.
- `npm run lint` - app, server, gateway lint, and API body validation passed after the cleanup.
- `npm run typecheck`, `npm run typecheck:scripts`, `npm --prefix gateway run build` - app, script, and gateway TypeScript checks passed after the cleanup.
- `git diff --check` - no whitespace errors.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w -i 9 -l javascript -l typescript -C 15 -T nloc=200 ... .` - no warnings found.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -l javascript -l typescript -C 15 -T nloc=200 ... .` - average CCN 1.4, warning count 0.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade .` - 2.29% duplication.
- `node scripts/quality/check-large-files.mjs` - classification passed.
- `npm run check:architecture-boundaries` - passed.
- `npm run check:browser-auth-contract` - passed.
- `npm run check:openapi-route-coverage` - passed.
- `gh api .../code-scanning/alerts -f state=open` - 0 open alerts.
- `gh api .../dependabot/alerts -f state=open` - 0 open alerts.
