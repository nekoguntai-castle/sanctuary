# Software Quality Report

Date: 2026-04-24
Owner: TBD
Status: Remediated

**Overall Score**: 97/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: 9f8247aa

Post-remediation score after fixing the working-tree secret findings and large-file gate regression: 97/100.

---

## Hard-Fail Blockers

None. The previous full working-tree gitleaks findings in ignored upgrade artifacts were remediated by broadening upgrade-log redaction and redacting the existing `.tmp/upgrade-artifacts/test-20260424-084047-2958226/logs/worker.log` artifact in place. Full working-tree, latest-commit, and tracked-tree gitleaks scans now report 0 findings.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Native tests, lint, typecheck, browser-auth contract, architecture boundaries, and OpenAPI route coverage passed. |
| Reliability | 15/15 | Inspected request/error paths use typed errors, contextual logging, request timeouts, rate-limit fallback behavior, and retry/backoff. |
| Maintainability | 12/15 | Lizard found 0 threshold warnings, jscpd duplication is below 3%, and the large-file classification gate passes after splitting the notification worker tests; file-size scoring still loses points because the largest scanned file is 2,686 lines. |
| Security | 15/15 | High/critical dependency advisories are 0, validation/safe API usage are strong, and full working-tree/latest-commit/tracked-tree gitleaks scans report 0 findings. |
| Performance | 10/10 | Sampled hot paths use async bounded I/O, grouped/windowed DB reads, and route-specific throttling. |
| Test Quality | 15/15 | App, backend, and gateway coverage are all 100% statements/branches/functions/lines with broad edge-case tests. |
| Operational Readiness | 10/10 | Docker/Compose, GitHub CI, health endpoints, observability support, and contextual logging are present. |
| **TOTAL** | **97/100** | No hard-fail cap applies after remediation. |

---

## Trend

- vs pre-remediation 2026-04-24 full entry (`9f8247aa`): overall `+28` (`69 -> 97`), grade `D -> A`, confidence `High -> High`.
- vs previous history entry 2026-04-22 (`096d7f23`, mode `grade-followup-lizard-cleanup`): overall unchanged at `97`, grade unchanged at `A`.
- The recovery comes from removing the hard-fail cap: full working-tree gitleaks now reports `secrets=0` instead of `8`. Splitting `server/tests/unit/worker/jobs/notificationJobs.test.ts` also restores the large-file classification gate.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; app 404 files / 5,620 tests | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` via `npm test` | Correctness 1.1 -> +6 |
| lint | pass | `npm run lint` via grade collector | Correctness 1.3 -> +3 |
| typecheck | pass | `npx --no-install tsc --noEmit` via grade collector | Correctness 1.2 -> +4 |
| coverage | 100% | `npm run test:coverage`, `npm run test:backend:coverage`, `npm --prefix gateway run test:coverage` | Test Quality 6.1 -> +5 |
| security_high | 0 | `npm audit --audit-level=high`; server/gateway/ai-proxy audits also 0 high/critical | Security 4.1 -> +5 |
| root_audit_low | 16 | `npm audit --json` | Security context only; low severity does not affect 4.1 |
| secrets | 0 | `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml` | Security 4.2 -> +4 |
| latest_commit_secrets | 0 | `gitleaks git . --log-opts -1` | Security context |
| tracked_tree_secrets | 0 | `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh` | Security context |
| lizard_warning_count | 0 | pinned lizard 1.21.2 with `-C 15 -T nloc=200` | Maintainability 3.1 -> +5 |
| lizard_avg_ccn | 1.4 | pinned lizard summary | Maintainability context |
| duplication_pct | 2.27% | `npx --yes jscpd@4` | Maintainability 3.2 -> +3 |
| largest_file_lines | 2,686 | grade collector file-size scan | Maintainability 3.3 -> +0 |
| large_file_classification | pass | `node scripts/quality/check-large-files.mjs` | Maintainability context: no unclassified files over the hard limit after splitting notification worker tests |
| suppression_count | 24 | grade heuristic | Correctness 1.4 judged |
| validation_lib_present | 1 | grade heuristic plus Zod middleware inspection | Security 4.3 judged |
| timeout_retry_count | 1,225 | grade heuristic | Reliability and performance context |
| blocking_io_count | 38 | grade heuristic | Reliability and performance context |
| observability_lib_present | 1 | grade heuristic and observability/logging inspection | Operational 7.3 -> +2 |
| logging_call_count | 319 | grade heuristic and logger inspection | Operational 7.4 judged |
| health_endpoint_count | 180 | grade heuristic | Operational 7.2 -> +2 |
| deploy_artifact_count | 2 | grade collector; Docker/Compose plus GitHub CI | Operational 7.1 -> +3 |
| test_file_count | 1,215 | grade heuristic plus notification worker test split | Test Quality context |
| focused_notification_tests | 51 passed / 5 files | `npm --prefix server run test:run -- tests/unit/worker/jobs/notificationJobs.*.test.ts` | Remediation verification |
| server_test_typecheck | pass | `npm --prefix server run typecheck:tests` | Remediation verification |
| test_sleep_count | 10 | grade heuristic | Test Quality 6.4 judged |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=24` is low for the repository size, and inspected suppressions are concentrated in tests, generated/coverage artifacts, or documented defensive branches.
- **[1.5] Functional completeness - High -> +3**: `tests/`, `server/tests/`, `gateway/tests/`, `npm run check:browser-auth-contract`, and `npm run check:openapi-route-coverage` cover the stated app, backend, gateway, and API contract surfaces.
- **[2.1] Error handling quality - High -> +6**: `src/api/client.ts`, `server/src/middleware/validate.ts`, and `server/src/errors/errorHandler.ts` use typed API/validation errors, Prisma error mapping, request correlation, and structured failure responses.
- **[2.2] Timeouts and retries - High -> +4**: `src/api/client.ts`, `server/src/middleware/requestTimeout.ts`, `server/src/middleware/rateLimit.ts`, and `gateway/src/middleware/rateLimit/limiters.ts` provide bounded client timeouts, route-specific server timeouts, retry/backoff, and retry-after behavior.
- **[2.3] Crash-prone paths - High -> +5**: sampled production paths avoid broad crash-only behavior; process exits and direct filesystem operations are concentrated in scripts, startup, support, and test utilities.
- **[3.4] Architecture clarity - High -> +3**: `npm run check:architecture-boundaries` passed with 1,859 files, 7,183 imports, 9 rules, and 40 documented exceptions.
- **[3.5] Readability/naming - Medium -> +1**: naming and module boundaries are generally clear, and the notification worker tests are now split by behavior; oversized proof-harness files such as `scripts/perf/phase3-compose-benchmark-smoke.mjs` still keep some review complexity visible.
- **[4.3] Input validation quality - High -> +3**: `server/src/middleware/validate.ts` validates body, params, and query with Zod, and `server/tests/unit/middleware/validate.test.ts` covers parsed body/params/query, getter-backed query, multiple issues, and non-Zod failures.
- **[4.4] Safe system/API usage - High -> +3**: inspected raw SQL in `server/src/repositories/agentDashboardRepository.ts` uses Prisma tagged templates with parameter interpolation; `innerHTML` and PEM fixture hits are test-only/allowlisted.
- **[5.1] Hot-path efficiency - High -> +5**: request-facing code uses async fetch/DB/Redis/Electrum patterns, bounded timeouts, and route-specific rate limits rather than synchronous hot-path work.
- **[5.2] Data access patterns - High -> +3**: `server/src/repositories/agentDashboardRepository.ts` groups counts/balances in the database and uses windowed queries plus `Promise.all` to avoid per-agent fan-out.
- **[5.3] No blocking in hot paths - High -> +2**: `blocking_io_count=38` is concentrated in scripts, startup, support-package, and maintenance code rather than request handlers.
- **[6.2] Test structure - High -> +4**: test suites are organized by API, service, repository, integration flow, gateway middleware, UI behavior, contract, and branch coverage surfaces.
- **[6.3] Edge cases covered - High -> +3**: sampled tests cover null/empty/default branches, invalid schemas, auth expiry, rate-limit boundaries, timeout behavior, malformed operational balances, and wallet/device access checks.
- **[6.4] No flaky patterns - High -> +3**: timer-sensitive tests use fake timers, and direct sleep evidence is limited relative to 1,215 test files.
- **[7.4] Logging quality - High -> +3**: `server/src/utils/logger.ts` adds request/trace context, sanitizes control characters, and redacts sensitive fields through `server/src/utils/redact.ts`.

### Missing

- None after supplemental runs. The bundled collector did not detect the repo's `test:coverage` script name and initially hit sandbox DNS for `npm audit`; both were resolved with explicit coverage and network-approved audit commands.

---

## Top Risks

1. Upgrade/support artifact hygiene remains a regression-sensitive boundary - redaction now covers secret-like assignment keys and JSON keys, but future artifact collectors should keep using the shared redaction path.
2. Root dependency audit still has 16 low-severity advisories - no current score impact, but wallet/polyfill dependency paths should keep being monitored.
3. Large proof-harness/generated files remain intentionally classified - no current gate failure, but they should not become regular hand-edited review surfaces.

## Fastest Improvements

1. Keep the new upgrade-log redaction regression test in the install-helper suite so future artifact fields such as queue keys, job IDs, API keys, tokens, and cookies stay redacted - recurring small.
2. Keep watching the 16 low root advisories for safe upstream fixes without forced downgrades - reduces dependency risk, no immediate rubric point gain - recurring small.
3. Revisit classified proof-harness files only if they become frequently hand-edited or begin generating review churn - no immediate rubric point gain - medium.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| A1 | Remove hard-fail cap | Broaden upgrade artifact redaction and redact the existing ignored worker log artifact. | `gitleaks detect --no-git`, latest-commit scan, and tracked-tree scan all report 0 findings. | complete: `69 -> 97` |
| A2 | Restore local quality gate | Split the oversized notification worker test file into focused modules with shared setup. | `node scripts/quality/check-large-files.mjs` passes. | complete |
| A3 | Sustain security posture | Revisit low root advisories when Ledger/Trezor/polyfill dependencies publish safe fixes. | `npm audit --audit-level=high` remains green without behavior regressions. | no direct rubric gain unless severity changes |

## Strengths To Preserve

- 100% app/backend/gateway coverage gates and broad behavioral edge-case tests.
- Zod validation and route-coverage checks at HTTP trust boundaries.
- Architecture-boundary checks with explicit rules and documented exceptions.
- Exposure-aware rate limiting plus health endpoints, observability, and contextual logging.

## Work To Defer Or Avoid

- Do not downgrade wallet, Ledger, Trezor, or polyfill packages just to silence low advisories without hardware-flow regression proof.
- Do not split generated/vector/proof artifacts solely for file-size scoring unless they become frequently hand-edited.
- Do not add `.tmp` to gitleaks allowlists while it contains raw operational logs; fix artifact handling instead.

## Verification Notes

- `git rev-parse --show-toplevel` - `/home/nekoguntai/sanctuary`.
- `git status --short` before editing - clean.
- `sed -n ... /home/nekoguntai/.codex/skills/grade/standards.md` - rubric source read.
- `bash /home/nekoguntai/.codex/skills/grade/trend.sh prev sanctuary_ full` - previous entry loaded.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - tests/lint/typecheck passed; coverage was not detected by script name; `npm audit` initially hit sandbox DNS and was rerun with approval; fallback signals collected.
- `npm audit --audit-level=high` and `npm audit --json` - 0 high/critical, 16 low root advisories.
- `npm --prefix server audit --audit-level=high`, `npm --prefix gateway audit --audit-level=high`, `npm --prefix ai-proxy audit --audit-level=high` - all found 0 vulnerabilities.
- `npm run test:coverage` - 404 files, 5,620 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` - 393 passed files, 9,239 passed tests, 100% statements/branches/functions/lines.
- `npm --prefix gateway run test:coverage` - 21 files, 528 tests, 100% statements/branches/functions/lines.
- `npm --prefix server run test:run -- tests/unit/worker/jobs/notificationJobs.transaction.test.ts tests/unit/worker/jobs/notificationJobs.draft.test.ts tests/unit/worker/jobs/notificationJobs.confirmation.test.ts tests/unit/worker/jobs/notificationJobs.consolidation.test.ts tests/unit/worker/jobs/notificationJobs.exports.test.ts` - 5 files, 51 tests passed after splitting notification worker tests.
- `npm --prefix server run typecheck:tests` - passed.
- `bash tests/install/unit/upgrade-helpers.test.sh` - 7 tests passed, including upgrade log redaction coverage for assignment-like queue keys and JSON API keys.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner` - no leaks found after remediation.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1` - no leaks found.
- `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh` - no leaks found.
- `QUALITY_SKIP_... bash scripts/quality.sh` with only lizard enabled - bootstrapped/ran pinned lizard 1.21.2 and passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w ... .` - no warnings.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard ... .` - average CCN 1.4, warning count 0.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade-20260424 .` - 2.27% duplication.
- `npm run check:architecture-boundaries` - passed.
- `npm run check:browser-auth-contract` - passed.
- `npm run check:openapi-route-coverage` - passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w -i 9 -C 15 tests/install/utils/collect-upgrade-artifacts.sh tests/install/unit/upgrade-helpers.test.sh server/tests/unit/worker/jobs/notificationJobs.testUtils.ts server/tests/unit/worker/jobs/notificationJobs.transaction.test.ts server/tests/unit/worker/jobs/notificationJobs.draft.test.ts server/tests/unit/worker/jobs/notificationJobs.confirmation.test.ts server/tests/unit/worker/jobs/notificationJobs.consolidation.test.ts server/tests/unit/worker/jobs/notificationJobs.exports.test.ts` - passed.
- `node scripts/quality/check-large-files.mjs` - passed; the largest split notification worker test file is 336 lines.
- `git diff --check` - passed.
- `bash /home/nekoguntai/.codex/skills/grade/trend.sh append sanctuary_ ... full` - appended the pre-remediation full history entry; post-remediation entry appended after the fixes.
