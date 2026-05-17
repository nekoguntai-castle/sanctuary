# Software Quality Report

Date: 2026-05-17
Owner: Codex
Status: Draft

**Overall Score**: 95/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: `92b014c9` (working tree included)

---

## Hard-Fail Blockers

None.

Tests, typecheck, lint, high/critical dependency audit, and gitleaks all passed. The initial sandboxed collector produced subprocess `EPERM` failures in script tests; that signal was discarded and the full collector was rerun outside the sandbox, where the same subprocess tests passed.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 18/20 | Tests, typecheck, and lint pass; functional completeness is still limited by missing physical hardware signing evidence. |
| Reliability | 15/15 | Central error handling, request aborts/timeouts, retry/backoff, startup/shutdown handling, and support-package collector isolation are present. |
| Maintainability | 12/15 | Lizard has 3 warnings, repo-owned jscpd duplication is 1.65%, and the largest file is 949 lines; architecture is mostly converged with policy/draft schemas on watch. |
| Security | 15/15 | High/critical audit count is 0, secrets are 0, and inspected trust boundaries use schema validation and safe API patterns. |
| Performance | 10/10 | Sampled hot paths use bounded I/O, timeouts, pagination, scoped queries, and no obvious synchronous request-path blocking. |
| Test Quality | 15/15 | Coverage is 100.00% for frontend, server, and gateway; inspected tests cover malformed, empty, timeout, auth, and boundary paths. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, metrics, tracing/logging hooks, and structured request context are present. |
| **TOTAL** | **95/100** | |

---

## Trend

- vs 2026-05-16 (`2cd1c143+phase6-working-tree`): overall +/-0, grade A -> A, confidence High -> High.
- Current run records the same 95/100 A posture at stable release commit `92b014c9`.

## Quality Delta

| Area | Signal | Previous | Current | Interpretation |
| --- | --- | ---: | ---: | --- |
| signal | `lizard_max_ccn` | `unknown` | `18` | newly measured |

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| `tests` | pass; 497 files / 6,197 tests | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` -> `npm test` | Correctness 1.1: pass = +6 |
| `typecheck` | pass | `grade.sh` -> native TypeScript typecheck | Correctness 1.2: pass = +4 |
| `lint` | pass | `grade.sh` -> `npm run lint` plus API/body, network-boundary, safety-catch, blocking-I/O guards | Correctness 1.3: pass = +3 |
| `coverage` | 100.00% lines/statements/functions/branches for frontend, server, gateway | `grade.sh` -> `npm run coverage` | Test Quality 6.1: >=80 = +5 |
| `security_high` | 0 | `grade.sh` -> `npm audit --audit-level=high` | Security 4.1: 0 = +5 |
| dependency advisories | 23 total: 20 low, 3 moderate, 0 high, 0 critical | `npm audit` output from `grade.sh` | No hard fail; accepted risk |
| `secrets` | 0 | `gitleaks detect --no-git --redact` via `grade.sh` | Security 4.2: 0 = +4 |
| `lizard_warning_count` | 3 | `lizard` via `grade.sh` | Maintainability 3.1: 1-5 = +3 |
| `lizard_max_ccn` | 18 | `lizard` via `grade.sh` | Newly measured quality signal |
| `duplication_pct` | 1.65%; 5,223 duplicated lines; 259 clones; 2,607 files | `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-2026-05-17 scripts/quality/jscpd-only.sh` | Maintainability 3.2: <3% = +3 |
| `largest_file_lines` | 949 | `grade.sh` file-size scan | Maintainability 3.3: 500-1000 = +1 |
| `deploy_artifact_count` | 2 | `grade.sh` filesystem check | Operational 7.1: >=2 = +3 |
| `health_endpoint_count` | 199 | `grade.sh` heuristic | Operational 7.2: >=1 = +2 |
| `observability_lib_present` | 1 | `grade.sh` heuristic | Operational 7.3: present = +2 |
| `validation_lib_present` | 1 | `grade.sh` heuristic | Security inspection hint |
| `suppression_count` | 29 | `grade.sh` heuristic plus inspection | Correctness 1.4 judged high = +4 |
| `timeout_retry_count` | 1309 | `grade.sh` heuristic plus inspection | Reliability/performance inspection hint |
| `blocking_io_count` | 105; blocking-I/O guard passed with 6 allow-listed production files | `grade.sh` | Performance/reliability inspection hint |
| `logging_call_count` | 350 | `grade.sh` heuristic plus inspection | Operational 7.4 judged high = +3 |
| `test_file_count` | 1391 | `grade.sh` heuristic | Test Quality inspection hint |
| `test_sleep_count` | 10 | `grade.sh` heuristic plus inspection | Test Quality 6.4 judged high = +3 |

### Judged Findings

- **[Correctness 1.4] Suppression density - High -> +4**: `suppression_count=29` is low for this codebase size and inspected suppressions are concentrated in defensive test/coverage or typed-boundary cases, supporting ISO Functional Appropriateness.
- **[Correctness 1.5] Functional completeness - Medium -> +1**: The app has broad route/client coverage, but `docs/plans/hardware-wallet-validation-2026-05-16.md` still records 11 missing required physical Ledger/Trezor/BitBox signing rows.
- **[Reliability 2.1] Error handling quality - High -> +6**: `server/src/errors/errorHandler.ts`, `server/src/middleware/validate.ts`, and `src/api/client.ts` provide contextual error mapping, Zod validation errors, request IDs, retry-aware client errors, and bounded response parsing.
- **[Reliability 2.2] Timeouts and retries - High -> +4**: `server/src/middleware/requestTimeout.ts`, `src/api/client.ts`, gateway rate-limit backoff, Electrum pool code, and support-package collectors use explicit timeout, abort, retry, or backoff controls.
- **[Reliability 2.3] Crash-prone paths - High -> +5**: Fatal/shutdown handling is tested, production panic-style patterns were not found, and subprocess use is bounded to scripts, diagnostics, or fixed commands with timeouts.
- **[Maintainability 3.4] Architecture clarity and path convergence - High -> +3**: Prior Payjoin, admin monitoring, API base URL, duplication-tooling, `UserContext`, and currency-bootstrap divergence claims remain converged; current policy/draft schema differences are watch-level rather than active drift.
- **[Maintainability 3.5] Readability/naming - High -> +2**: Spot checks in API client, validation middleware, admin monitoring, Payjoin, preference mutation, and support-package code show explicit naming and small helper boundaries despite residual hotspots.
- **[Security 4.3] Input validation quality - High -> +3**: Sensitive routes use Zod schemas and middleware validation, including `server/src/api/payjoin.ts`, `server/src/api/admin/monitoring.ts`, and LLM proxy request schemas.
- **[Security 4.4] Safe system/API usage - High -> +3**: Unsafe API scans found no production user-controlled JavaScript `eval`, `dangerouslySetInnerHTML`, or string-built raw SQL; Redis `eval` uses committed Lua scripts and Prisma raw calls are tagged templates.
- **[Performance 5.1] Hot-path efficiency - High -> +5**: Sampled request/client paths use bounded fetches, aborts, retry controls, and scoped service calls without obvious repeated synchronous work.
- **[Performance 5.2] Data access patterns - High -> +3**: Sampled repositories and route tests show scoped queries, pagination caps, selected fields, transaction boundaries, and batching-oriented paths.
- **[Performance 5.3] No blocking in hot paths - High -> +2**: `check-blocking-io` passed; remaining sync/subprocess sites are scripts, diagnostics, startup maintenance, or explicitly allow-listed operational paths.
- **[Test Quality 6.2] Test structure - High -> +4**: Inspected frontend/server/gateway tests are behavior-oriented and cover route contracts, auth, validation, support package failure isolation, API clients, and hardware adapters.
- **[Test Quality 6.3] Edge cases covered - High -> +3**: Tests include malformed input, extra fields, null/empty cases, 401/400/500 responses, timeout/abort behavior, provider fallback, and bootstrap preference timing.
- **[Test Quality 6.4] No flaky patterns - High -> +3**: The successful unsandboxed full run and coverage run passed subprocess-heavy guards; timer/sleep usage is limited and mostly test infrastructure.
- **[Operational 7.4] Logging quality - High -> +3**: `utils/logger.ts`, server/gateway request loggers, metrics middleware, and audit/event paths include request IDs, route context, status, duration, and redacted structured metadata.

### Missing

- Global `jscpd` is not installed for `grade.sh`; repo-owned `scripts/quality/jscpd-only.sh` measured duplication successfully through `npx`.
- Static grading cannot measure live SLOs, p95/p99 latency, MTTR, deployment frequency, or real change-failure rate.
- Physical hardware-in-loop signing evidence remains missing for 11 required rows and product-blocked for 4 multisig rows.

---

## Top Risks

1. Physical hardware signing proof remains blocked - strict hardware fixture gate still needs 11 sanitized Ledger, Trezor, and BitBox physical signing artifacts.
2. Accepted dependency advisories remain - root audit reports 3 moderate and 20 low advisories, including Prisma dev-tool Hono and transitive frontend/hardware chains, with 0 high/critical.
3. Policy and draft route schemas can drift - wallet policy and draft APIs still accept looser `unknown`/string fields than the stricter admin/mobile contracts.
4. `RecipientsSection` remains the primary production complexity warning - `components/send/steps/OutputsStep/sections/RecipientsSection.tsx` has CCN 17.
5. Largest file risk remains moderate - `scripts/perf/phase3-benchmark.mjs` is 949 lines, with production-adjacent files near 800 lines.

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
2. Tighten wallet policy and draft route schemas - reduces divergence and future contract drift; medium effort if paired with route tests.
3. Simplify `RecipientsSection` - removes the only production lizard warning; low/medium effort during send-flow work.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 | Preserve A and improve completeness | Capture required physical hardware fixture rows. | Strict hardware fixture gate passes. | +1 to +2 |
| 2 | Reduce drift risk | Rationalize policy/draft route schemas against service/mobile/admin contracts. | Route tests prove strict null/empty/error semantics. | Confidence improvement, possible +0 to +1 |
| 3 | Lower residual maintainability debt | Split `RecipientsSection` and opportunistically simplify two test helper warnings. | Lizard warning count reaches 0. | +2 maintainability if bucket crosses to 0 warnings |

## Strengths To Preserve

- Broad automated test suite with 100% reported coverage across frontend, server, and gateway.
- Strong trust-boundary scaffolding: Zod validation, CSRF, HttpOnly cookie auth, rate limits, proxy isolation, and typed API error responses.
- Operational hooks are mature: Docker/Compose, CI, health endpoints, metrics, request IDs, and structured contextual logging.
- Convergence discipline is visible: historical divergent paths are documented, tested, and either converged or intentionally separated.

## Work To Defer Or Avoid

- Do not rewrite frameworks or introduce generated clients just to chase the grade; current risks are narrower and already named.
- Do not collapse LLM proxy utilities into shared code without an explicit security-boundary decision.
- Do not mechanically remove test fixture duplication without first separating intentional contract matrices from production duplication.
- Do not treat moderate/low dependency advisories as a breaking-upgrade mandate while high/critical count remains 0.

## Verification Notes

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` was first run in the sandbox and produced invalid `spawnSync ... EPERM` test failures; that run was terminated and not used for scoring.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` rerun outside the sandbox passed: tests, lint, typecheck, coverage, audit high gate, gitleaks, lizard, file-size scan, and operational heuristics.
- `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-2026-05-17 scripts/quality/jscpd-only.sh` passed outside the sandbox after sandbox DNS failure, measuring 1.65% duplication.
- `bash /home/nekoguntai/.codex/skills/grade/trend.sh compare ...` reported `lizard_max_ccn` as newly measured.
- `bash /home/nekoguntai/.codex/skills/grade/trend.sh append sanctuary_ <json> full` appended the history row to `docs/plans/grade-history/sanctuary_.jsonl`.
