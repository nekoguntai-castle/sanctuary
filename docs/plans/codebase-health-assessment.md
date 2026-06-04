# Software Quality Report

Date: 2026-06-04
Owner: Codex
Status: Complete

**Overall Score**: 97/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: `5a74710b+grade-loop-working-tree`

---

## Hard-Fail Blockers

None.

Tests, typecheck, lint, high/critical dependency audit, gitleaks, coverage, lizard, and the repo-owned duplication scan all passed. The grade collector still cannot see a global `jscpd` binary, so duplication was measured with the repository script.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 18/20 | Tests, typecheck, and lint pass; functional completeness is still limited by missing physical hardware signing evidence. |
| Reliability | 15/15 | Central error handling, request timeouts, retry/backoff, startup/shutdown handling, and support-package collector isolation remain present. |
| Maintainability | 14/15 | Lizard warnings were reduced from 6 to 0, max CCN is now 15, repo-owned jscpd duplication is 1.64%, and the largest file remains 966 lines. |
| Security | 15/15 | High/critical audit count is 0, secrets are 0, and inspected trust boundaries use schema validation and safe API patterns. |
| Performance | 10/10 | Sampled hot paths use bounded I/O, timeouts, pagination, scoped queries, and no obvious synchronous request-path blocking. |
| Test Quality | 15/15 | Coverage is 100.00% for frontend, server, and gateway; inspected tests cover malformed, empty, timeout, auth, and boundary paths. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, metrics, tracing/logging hooks, and structured request context are present. |
| **TOTAL** | **97/100** | |

---

## Trend

- vs initial 2026-06-04 grade-loop baseline (`5a74710b`): overall +4, Maintainability 10/15 -> 14/15.
- vs 2026-05-17 (`92b014c9`): overall +2, Maintainability 12/15 -> 14/15, grade A -> A, confidence High -> High.
- The material improvement is the lizard threshold crossing: `lizard_warning_count` 6 -> 0 and `lizard_max_ccn` 25 -> 15.

## Quality Delta

| Area | Signal | Previous | Current | Interpretation |
| --- | --- | ---: | ---: | --- |
| score | `overall` | `93` | `97` | improved |
| domain | `maintainability` | `10` | `14` | improved |
| signal | `lizard_warning_count` | `6` | `0` | improved - threshold crossing |
| signal | `lizard_max_ccn` | `25` | `15` | improved |
| signal | `duplication_pct` | `1.64` | `1.64` | unchanged |
| signal | `largest_file_lines` | `966` | `966` | unchanged - moderate bucket |
| signal | `health_endpoint_count` | `199` | `201` | changed - inspect |

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| `tests` | pass; 506 files / 6,254 tests | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` -> `npm test` | Correctness 1.1: pass = +6 |
| `typecheck` | pass | `grade.sh` -> native TypeScript typecheck | Correctness 1.2: pass = +4 |
| `lint` | pass | `grade.sh` -> `npm run lint` plus API/body, network-boundary, safety-catch, blocking-I/O guards | Correctness 1.3: pass = +3 |
| `coverage` | 100.00% lines/statements/functions/branches for frontend, server, gateway | `grade.sh` -> `npm run coverage` | Test Quality 6.1: >=80 = +5 |
| `security_high` | 0 | `grade.sh` -> `npm audit --audit-level=high` | Security 4.1: 0 = +5 |
| dependency advisories | 26 total: 12 low, 14 moderate, 0 high, 0 critical | `npm audit` output from `grade.sh` | No hard fail; accepted risk |
| `secrets` | 0 | `gitleaks detect --no-git --redact` via `grade.sh` | Security 4.2: 0 = +4 |
| `lizard_warning_count` | 0 | `lizard` via `grade.sh` | Maintainability 3.1: 0 = +5 |
| `lizard_max_ccn` | 15 | `lizard` via `grade.sh` | Directional maintainability signal |
| `duplication_pct` | 1.64%; 5,311 duplicated lines; 264 clones; 2,640 files | `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-2026-06-04 scripts/quality/jscpd-only.sh` | Maintainability 3.2: <3% = +3 |
| `largest_file_lines` | 966 | `grade.sh` file-size scan | Maintainability 3.3: 500-1000 = +1 |
| `deploy_artifact_count` | 2 | `grade.sh` filesystem check | Operational 7.1: >=2 = +3 |
| `health_endpoint_count` | 201 | `grade.sh` heuristic | Operational 7.2: >=1 = +2 |
| `observability_lib_present` | 1 | `grade.sh` heuristic | Operational 7.3: present = +2 |
| `validation_lib_present` | 1 | `grade.sh` heuristic | Security inspection hint |
| `suppression_count` | 29 | `grade.sh` heuristic plus inspection | Correctness 1.4 judged high = +4 |
| `timeout_retry_count` | 1,335 | `grade.sh` heuristic plus inspection | Reliability/performance inspection hint |
| `blocking_io_count` | 105; blocking-I/O guard passed with 6 allow-listed production files | `grade.sh` | Performance/reliability inspection hint |
| `logging_call_count` | 350 | `grade.sh` heuristic plus inspection | Operational 7.4 judged high = +3 |
| `test_file_count` | 1,412 | `grade.sh` heuristic | Test Quality inspection hint |
| `test_sleep_count` | 10 | `grade.sh` heuristic plus inspection | Test Quality 6.4 judged high = +3 |

### Judged Findings

- **[Correctness 1.4] Suppression density - High -> +4**: `suppression_count=29` remains low for the codebase size and inspected suppressions are concentrated in defensive test/coverage or typed-boundary cases.
- **[Correctness 1.5] Functional completeness - Medium -> +1**: The app has broad route/client coverage, but `docs/plans/hardware-wallet-validation-2026-05-16.md` still records missing physical Ledger/Trezor/BitBox signing evidence.
- **[Reliability 2.1] Error handling quality - High -> +6**: `server/src/errors/errorHandler.ts`, `server/src/middleware/validate.ts`, and `src/api/client.ts` provide contextual error mapping, Zod validation errors, request IDs, retry-aware client errors, and bounded response parsing.
- **[Reliability 2.2] Timeouts and retries - High -> +4**: Request timeout middleware, API clients, gateway rate-limit backoff, Electrum pool code, and support-package collectors use explicit timeout, abort, retry, or backoff controls.
- **[Maintainability 3.4] Architecture clarity and path convergence - High -> +3**: Historical divergent paths are documented, tested, and either converged or intentionally separated; policy/draft schema differences remain watch-level.
- **[Maintainability 3.5] Readability/naming - High -> +2**: The grade-loop refactor split branch-heavy rendering, metric assembly, network status assembly, and repository update-data construction into named helpers with preserved contracts.
- **[Security 4.3] Input validation quality - High -> +3**: Sensitive routes use Zod schemas and middleware validation, including Payjoin, admin monitoring, and LLM proxy request schemas.
- **[Security 4.4] Safe system/API usage - High -> +3**: Unsafe API scans found no production user-controlled JavaScript `eval`, `dangerouslySetInnerHTML`, or string-built raw SQL; Redis `eval` uses committed Lua scripts and Prisma raw calls are tagged templates.
- **[Performance 5.3] No blocking in hot paths - High -> +2**: `check-blocking-io` passed; remaining sync/subprocess sites are scripts, diagnostics, startup maintenance, or explicitly allow-listed operational paths.
- **[Test Quality 6.2-6.4] Test structure, edge cases, and flake risk - High -> +10**: Tests cover route contracts, auth, validation, empty/malformed inputs, timeout/abort behavior, provider fallback, and bootstrap preference timing.
- **[Operational 7.4] Logging quality - High -> +3**: Request IDs, route context, status, duration, and redacted structured metadata are present across app/server/gateway paths.

### Missing

- Global `jscpd` is not installed for `grade.sh`; repo-owned `scripts/quality/jscpd-only.sh` measured duplication successfully.
- Static grading cannot measure live SLOs, p95/p99 latency, MTTR, deployment frequency, or real change-failure rate.
- Physical hardware-in-loop signing evidence remains incomplete and cannot be produced without the required devices.

---

## Top Risks

1. Physical hardware signing proof remains blocked - strict hardware fixture gate still needs sanitized Ledger, Trezor, and BitBox physical signing artifacts.
2. Accepted dependency advisories remain - root audit reports 14 moderate and 12 low advisories, with 0 high/critical.
3. Policy and draft route schemas can drift - wallet policy and draft APIs still accept looser `unknown`/string fields than stricter admin/mobile contracts.
4. Largest file risk remains moderate - the largest file is `server/tests/unit/services/bitcoin/electrumPoolConnections/module-level-pool-helpers.contracts.ts` at 966 lines.

## Divergent Paths

| Candidate | Evidence | Disposition | Risk / Next Step |
| --- | --- | --- | --- |
| Payjoin attempt route contract | `server/src/api/payjoin.ts` uses strict `AttemptPayjoinBodySchema`; old unknown body fields are absent. | justified/converged | Keep route tests as contract owner. |
| Admin monitoring update contract | `server/src/api/admin/monitoring.ts` uses strict nullable/optional `customUrl` and service ID validation. | justified/converged | Preserve malformed-payload tests around null/blank/omitted semantics. |
| API base URL ownership | `src/api/client.ts` imports `getApiBaseUrl` and `joinApiBaseUrl`. | justified/converged | Keep direct URL construction behind shared helpers. |
| User context and currency bootstrap | `contexts/UserContext.tsx` delegates lifecycle/actions/preferences/theme; `contexts/CurrencyContext.tsx` queues bootstrap preference writes. | justified/converged | Keep bootstrap preference tests in place. |
| Wallet policy schemas | `server/src/api/wallets/policies.ts` uses loose `unknown`/passthrough mutation schema while `server/src/api/admin/policies.ts` is stricter. | watch | Service validation reduces current risk; rationalize if policy API work resumes. |
| Draft transaction schemas | `server/src/api/drafts.ts` accepts loose output/input/status shapes while mobile draft contracts are narrower. | watch | Tighten route schema when touching draft APIs. |
| Electrum pool access paths | `server/src/services/bitcoin/electrumPool/poolRegistry.ts` keeps legacy singleton plus per-network pool registry with comments. | watch | Compatibility is documented; avoid new singleton call sites. |
| LLM egress proxy shared utilities | `shared/utils/README.md` documents intentionally separate proxy utilities. | justified | Keep separate because proxy isolation is a security boundary. |

## Fastest Improvements

1. Capture hardware-in-loop signing artifacts - expected +1 to +2 correctness/completeness confidence; high effort because it needs physical devices.
2. Triage moderate dependency advisories - low score impact while high/critical count is 0, but useful to reduce accepted risk.
3. Tighten wallet policy and draft route schemas - reduces divergence and future contract drift; medium effort if paired with route tests.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 | Improve completeness | Capture required physical hardware fixture rows. | Strict hardware fixture gate passes. | +1 to +2 |
| 2 | Reduce accepted advisory risk | Review Hono/Prisma, Trezor crypto chain, qs, and firebase-admin transitive advisories. | No high/critical advisories and documented/updated moderate chains. | Confidence improvement |
| 3 | Reduce drift risk | Rationalize policy/draft route schemas against service/mobile/admin contracts. | Route tests prove strict null/empty/error semantics. | Confidence improvement, possible +0 to +1 |

## Strengths To Preserve

- Broad automated test suite with 100% reported coverage across frontend, server, and gateway.
- Strong trust-boundary scaffolding: Zod validation, CSRF, HttpOnly cookie auth, rate limits, proxy isolation, and typed API error responses.
- Operational hooks are mature: Docker/Compose, CI, health endpoints, metrics, request IDs, and structured contextual logging.
- Complexity baseline is now clean at the grade threshold: 0 lizard warnings, max CCN 15.

## Work To Defer Or Avoid

- Do not rewrite frameworks or introduce generated clients just to chase the grade; current risks are narrower and already named.
- Do not collapse LLM proxy utilities into shared code without an explicit security-boundary decision.
- Do not mechanically split every large test file while the file-size signal remains within the moderate bucket.
- Do not treat moderate/low dependency advisories as a breaking-upgrade mandate while high/critical count remains 0.

## Verification Notes

- `cd server && npm run test:run -- tests/unit/services/bitcoin/electrumPool.backoff.test.ts` passed after adding expired-cooldown coverage.
- `cd server && npm run test:coverage` passed with escalated localhost binding: 100% statements, branches, functions, and lines.
- `npm run quality:lizard` passed with zero warnings.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` passed with escalated localhost binding: tests, lint, typecheck, coverage, audit high gate, gitleaks, lizard, file-size scan, and operational heuristics.
- `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-2026-06-04 scripts/quality/jscpd-only.sh` passed and measured 1.64% duplication.
- First post-change full grade attempt exposed one missing backend branch in `metricsExporter.ts`; the expired-cooldown `getPoolStats()` behavior is now covered by `server/tests/unit/services/bitcoin/electrumPool.backoff.test.ts`.
