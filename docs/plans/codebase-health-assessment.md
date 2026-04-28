# Software Quality Report

Date: 2026-04-28
Owner: TBD
Status: Current

**Overall Score**: 98/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: 6f6fadc9

Full repository grade against the current working tree, including the AI Console, LM Studio/OpenAI-compatible provider, Console results, clearing controls, timeout handling, and new regression coverage work. No hard-fail gates are active. The score remains limited only by the strict raw largest-file rubric.

---

## Hard-Fail Blockers

None.

Tests, lint, typecheck, explicit app/backend/gateway coverage, high-severity audits, gitleaks, lizard, and jscpd all pass the scoring gates.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Project tests, lint, and typecheck pass on the current working tree. |
| Reliability | 15/15 | Console/API paths use typed errors, bounded model requests, retry/timeout handling, clear diagnostics, and fallback synthesis for local model edge cases. |
| Maintainability | 13/15 | Full lizard scan has zero `CCN > 15` warnings and duplication is 2.2%; raw largest-file size is still over 1,000 lines. |
| Security | 15/15 | Explicit audits show 0 high/critical findings; gitleaks scans are clean; local provider credential handling avoids sending absent API keys. |
| Performance | 10/10 | Request-facing paths remain async and bounded; Console result queries are limited/deduped and existing DB/API access patterns stay scoped. |
| Test Quality | 15/15 | App, backend, and gateway coverage all report 100%, including new Console result, clear-history, timeout, and defensive API parsing cases. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability hooks, request IDs, and redacted contextual logging remain present. |
| **TOTAL** | **98/100** | No hard-fail cap applies. |

---

## Trend

- vs 2026-04-27 (`600cd6fe` report baseline): overall `+/-0` (`98 -> 98`), grade `A -> A`, confidence `High -> High`.
- Coverage remains 100% across app, backend, and gateway. App test volume moved from 5,712 to 5,827 tests; backend moved from 9,414 to 9,458 passed tests.
- Duplication improved slightly (`2.25% -> 2.2%`), and lizard remains at zero threshold warnings.
- The largest raw file is now `tests/components/ConsoleDrawer.test.tsx` at 1,181 lines, so Maintainability 3.3 still scores 0 under the strict rubric.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; app 430 files / 5,827 tests | `CI=true GRADE_TIMEOUT=300 bash /home/nekoguntai/.codex/skills/grade/grade.sh` | Correctness 1.1 -> +6 |
| lint | pass | `npm run lint` and grade collector | Correctness 1.3 -> +3 |
| typecheck | pass | `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, grade collector | Correctness 1.2 -> +4 |
| coverage | 100%; app 430 / 5,827, backend 419 passed files / 9,458 passed tests with 22 skipped files / 505 skipped tests, gateway 21 / 528 | `npm run test:coverage`, `npm run test:backend:coverage`, `npm --prefix gateway run test:coverage` | Test Quality 6.1 -> +5 |
| security_high | 0 | `npm audit --audit-level=high`; package audits for server/gateway/ai-proxy | Security 4.1 -> +5 |
| root_audit_low | 16 | `npm audit --audit-level=high` | Context only; low severity does not affect 4.1 |
| server_audit_total | 0 | `npm audit --audit-level=high` from `server/` | Security context |
| gateway_audit_total | 0 | `npm audit --audit-level=high` from `gateway/` | Security context |
| ai_proxy_audit_total | 0 | `npm audit --audit-level=high` from `ai-proxy/` | Security context |
| secrets | 0 | `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect`, `gitleaks git`, and tracked-tree scan | Security 4.2 -> +4 |
| lizard_warning_count | 0 | pinned lizard full scan with `-C 15 -T nloc=200` | Maintainability 3.1 -> +5 |
| lizard_avg_ccn | 1.4 | pinned lizard summary: 444,923 NLOC / 33,558 functions | Maintainability context |
| duplication_pct | 2.2% | `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade .` | Maintainability 3.2 -> +3 |
| duplication_clones | 290 exact clones / 6,463 duplicated lines | jscpd JSON report | Maintainability context |
| largest_file_lines | 1,181 | grade collector file-size scan | Maintainability 3.3 -> +0 |
| largest_file_path | `tests/components/ConsoleDrawer.test.tsx` | grade collector file-size scan | Maintainability context |
| suppression_count | 24 | grade heuristic | Correctness 1.4 judged |
| timeout_retry_count | 1,281 | grade heuristic | Reliability/performance context |
| blocking_io_count | 48 | grade heuristic | Reliability/performance context |
| validation_lib_present | 1 | grade heuristic plus route/middleware inspection | Security 4.3 judged |
| observability_lib_present | 1 | grade heuristic plus logger/tracing inspection | Operational 7.3 -> +2 |
| logging_call_count | 330 | grade heuristic | Operational 7.4 judged |
| health_endpoint_count | 181 | grade heuristic | Operational 7.2 -> +2 |
| deploy_artifact_count | 2 | Docker/Compose plus GitHub CI | Operational 7.1 -> +3 |
| test_file_count | 1,269 | grade heuristic | Test Quality context |
| test_sleep_count | 10 | grade heuristic | Test Quality 6.4 judged |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=24` remains low for the repository size and is concentrated in tests, compatibility checks, or documented guardrails.
- **[1.5] Functional completeness - High -> +3**: Console provider setup, route guards, prompt lifecycle, all-wallet transaction navigation, API parsing, backend Console service behavior, and gateway timeout behavior now have executable regressions.
- **[2.1] Error handling quality - High -> +6**: `src/api/client.ts`, `server/src/api/console.ts`, and `server/src/assistant/console/service.ts` preserve structured errors, response previews, timeout diagnostics, and fallback summaries.
- **[2.2] Timeouts and retries - High -> +4**: Console/model requests and frontend proxy timeouts are bounded; client retry/timeout handling remains centralized.
- **[2.3] Crash-prone paths - High -> +5**: production failures are surfaced through typed/domain errors and route boundaries; direct process exits remain concentrated in scripts and utility wrappers.
- **[3.4] Architecture clarity - High -> +3**: the Console result surface, transaction route filters, and provider/proxy behavior reuse existing route/API/test harness boundaries rather than creating isolated parallel paths.
- **[3.5] Readability/naming - High -> +2**: new helpers use explicit names for transaction query normalization, Console result summaries, and provider failure details.
- **[4.3] Input validation quality - High -> +3**: Zod/request schemas and route-level guards validate Console prompt/session/history payloads and reject unknown local-model tool calls.
- **[4.4] Safe system/API usage - High -> +3**: local OpenAI-compatible profiles can operate without credentials, and absent API keys are not serialized as provider secrets or authorization headers.
- **[5.1] Hot-path efficiency - High -> +5**: Console result loading caps per-wallet transaction result size and dedupes repeated rows before rendering.
- **[5.2] Data access patterns - High -> +3**: sampled wallet transaction and Console paths use bounded queries, filters, and scoped wallet access.
- **[5.3] No blocking in hot paths - High -> +2**: `blocking_io_count=48` remains concentrated in scripts, setup, maintenance, support-package, and test paths.
- **[6.2] Test structure - High -> +4**: tests remain organized by UI behavior, API client contracts, server route/service contracts, AI proxy protocol, gateway config, and e2e smoke coverage.
- **[6.3] Edge cases covered - High -> +3**: new tests cover empty prompts, duplicate retries/history, missing credentials, invalid JSON/HTML proxy bodies, blank nested errors, inaccessible wallets, partial result failures, and repeated query params.
- **[6.4] No flaky patterns - High -> +3**: direct sleep evidence remains low and timer-sensitive tests predominantly use fake timers or explicit timer spies.
- **[7.4] Logging quality - High -> +3**: structured, contextual, redacted logging remains present across backend, gateway, AI proxy, and support tooling.

### Missing

None for scored signals. The grade collector did not auto-detect coverage, lizard, jscpd, or gitleaks from PATH and its fallback secret scan produced false positives; explicit pinned tool runs above supersede those collector gaps.

---

## Top Risks

1. **Strict raw file-size score is still not perfect.** `tests/components/ConsoleDrawer.test.tsx` is 1,181 lines, `scripts/perf/phase3-benchmark.mjs` is 1,150 lines, and `server/tests/unit/assistant/consoleService.test.ts` is 1,012 lines.
2. **Root audit still has 16 low-severity transitive advisories.** They are in hardware-wallet/polyfill dependency paths around `elliptic`, Trezor/Ledger packages, and browser crypto polyfills; no high/critical findings are present.
3. **Duplication remains below the gate but worth watching.** jscpd reports 2.2%, mostly test/e2e fixtures, OpenAPI patterns, config boilerplate, and script helpers.

## Fastest Improvements

1. Split the largest Console/UI test files by behavior area if a strict 100/100 score is required.
2. Continue tracking hardware-wallet dependency updates and apply them only with Ledger/Trezor regression proof.
3. Keep pinned lizard and jscpd in release checks so Console growth does not reintroduce complexity or duplication drift.

## Strengths To Preserve

- 100% app/backend/gateway coverage gates with broad edge-case coverage.
- Full pinned lizard at `CCN <= 15` with zero warnings.
- Provider-agnostic local AI support with LM Studio/OpenAI-compatible behavior tested without requiring API keys.
- Shared Console transaction routing/result handling instead of separate ad hoc AI search paths.
- Redacted structured logging, request IDs, health endpoints, Docker/Compose, and CI workflows.

## Work To Defer Or Avoid

- Do not weaken coverage thresholds to accommodate local-model variability; keep deterministic fallbacks covered.
- Do not force-upgrade hardware-wallet crypto dependencies just to silence low-severity advisories without device-flow regression evidence.
- Do not add broad lizard suppressions; keep splitting complex UI/service behavior into focused helpers and tests.

## Verification Notes

- `CI=true GRADE_TIMEOUT=300 bash /home/nekoguntai/.codex/skills/grade/grade.sh` - tests, lint, and typecheck passed; explicit coverage/audit/gitleaks/lizard/jscpd commands supply final scoring signals.
- `npm run test:coverage` - 430 files, 5,827 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` - 419 passed files, 9,458 passed tests, 22 skipped files, 505 skipped tests, 100% statements/branches/functions/lines.
- `npm --prefix gateway run test:coverage` - 21 files, 528 tests, 100% statements/branches/functions/lines.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run typecheck:server:tests`, and `npm run lint` - passed.
- Focused regressions passed for API client, Console results, Console controller, backend Console service/tool execution, and wallet transaction routes.
- `npx prettier --check ...` and `git diff --check` - passed after formatting.
- `npm audit --audit-level=high` - 0 high/critical and 16 low advisories in the root package.
- `npm audit --audit-level=high` from `server/`, `gateway/`, and `ai-proxy/` - 0 vulnerabilities.
- Gitleaks detect, latest-commit, and tracked-tree scans - no leaks found.
- Pinned lizard full scan - no thresholds exceeded; 444,923 NLOC, average CCN 1.4, 33,558 functions, warning count 0.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade .` - 2.2% duplicated lines, 290 exact clones.
