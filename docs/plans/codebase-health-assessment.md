# Software Quality Report

Date: 2026-04-25
Owner: TBD
Status: Remediated

**Overall Score**: 97/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: 1af2fe0d

Post-remediation score after removing the generated-output secret-scan hard-fail, clearing the architecture-boundary lizard warning, and splitting the Phase 3 Compose benchmark smoke entrypoint: 97/100.

---

## Hard-Fail Blockers

None. The previous `secrets=1` finding in ignored generated Docusaurus output is now suppressed by an exact `.gitleaksignore` fingerprint for `website/build/docs/reference/hardware-wallet-integration.html:generic-api-key:248`. The canonical source markdown, Docusaurus intermediate JSON, full working tree, tracked tree, and latest commit all scan clean.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Tests, lint, typecheck, API body validation, browser-auth contract, architecture boundaries, and OpenAPI route coverage passed. |
| Reliability | 15/15 | Inspected validation, error handling, timeout, retry, and rate-limit paths use contextual failures and bounded external I/O. |
| Maintainability | 12/15 | Lizard reports 0 threshold warnings, duplication is below 3%, architecture checks pass, and the Phase 3 Compose benchmark entrypoint is down to 370 lines; points are still lost because the largest scanned source is a 2,118-line vector/fixture file. |
| Security | 15/15 | Dependency audits have 0 high/critical findings, validation/API usage are strong, and full working-tree/latest-commit/tracked-tree gitleaks scans report 0 findings. |
| Performance | 10/10 | Sampled request-facing code uses async I/O, batched/windowed data access, and route-specific throttling. |
| Test Quality | 15/15 | App, backend, and gateway coverage all report 100%, with broad edge/error/boundary test coverage and mostly deterministic timer control. |
| Operational Readiness | 10/10 | Docker/Compose, GitHub CI, health endpoints, observability support, and contextual logging are present. |
| **TOTAL** | **97/100** | No hard-fail cap applies after remediation. |

---

## Trend

- vs post-secret-remediation 2026-04-25 entry (`1af2fe0d`): overall `+2` (`95 -> 97`), grade `A -> A`, confidence `High -> High`.
- vs pre-remediation 2026-04-25 full entry (`1af2fe0d`): overall `+28` (`69 -> 97`), grade `D -> A`, confidence `High -> High`.
- The recovery comes from changing `secrets` from `1` to `0` and `lizard_warning_count` from `1` to `0`; Security moves from `11/15` to `15/15`, Maintainability moves from `10/15` to `12/15`, and the hard-fail cap no longer applies.
- Phase 3 Compose benchmark modularization after the 97/100 recovery has no score movement, but reduces `scripts/perf/phase3-compose-benchmark-smoke.mjs` from 2,686 to 370 lines and moves proof/config/report/runtime code into focused modules under `scripts/perf/phase3-compose/`.
- vs prior commit full run on 2026-04-25 (`5590f7fe`): app coverage grew from 404 files / 5,620 tests to 407 files / 5,630 tests, and total detected test files grew from 1,220 to 1,223.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; app 407 files / 5,630 tests | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` via `npm test` | Correctness 1.1 -> +6 |
| lint | pass | `npm run lint` plus `check:api-body-validation` via grade collector | Correctness 1.3 -> +3 |
| typecheck | pass | native TypeScript typecheck via grade collector | Correctness 1.2 -> +4 |
| coverage | 100%; app 407 files / 5,630 tests, backend 398 passed files / 9,253 passed tests with 22 skipped files / 505 skipped tests, gateway 21 files / 528 tests | `npm run test:coverage`, `npm run test:backend:coverage`, `npm --prefix gateway run test:coverage` | Test Quality 6.1 -> +5 |
| security_high | 0 | `npm audit --audit-level=high`; server/gateway/ai-proxy audits also 0 vulnerabilities | Security 4.1 -> +5 |
| root_audit_low | 16 | `npm audit --audit-level=high` | Context only; low severity does not affect 4.1 |
| secrets | 0 | `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml` | Security 4.2 -> +4 |
| latest_commit_secrets | 0 | `gitleaks git . --log-opts -1` | Context: committed HEAD clean |
| tracked_tree_secrets | 0 | `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh` | Context: tracked tree clean |
| source_doc_secrets | 0 | `gitleaks detect --source docs/reference/hardware-wallet-integration.md --no-git` | Context: source doc behind generated false positive is clean |
| docusaurus_intermediate_secrets | 0 | `gitleaks detect --source website/.docusaurus/...hardware-wallet-integration...json --no-git` | Context: generated intermediate data is clean |
| lizard_warning_count | 0 | pinned lizard 1.21.2 with `-w -C 15` | Maintainability 3.1 -> +5 |
| lizard_avg_ccn | 1.3 | pinned lizard summary | Maintainability context |
| lizard_threshold_status | no thresholds exceeded | pinned lizard 1.21.2 full scan | Maintainability context |
| duplication_pct | 2.26% | `npx --yes jscpd@4` | Maintainability 3.2 -> +3 |
| largest_file_lines | 2,118 | grade collector-style file-size scan after Phase 3 Compose split; largest scanned sources are `server/tests/fixtures/verified-address-vectors.ts` and `scripts/verify-addresses/output/verified-vectors.ts` | Maintainability 3.3 -> +0 |
| large_file_classification | pass | `node scripts/quality/check-large-files.mjs` | Context: oversized files are classified |
| suppression_count | 24 | grade heuristic | Correctness 1.4 judged |
| validation_lib_present | 1 | grade heuristic plus Zod middleware inspection | Security 4.3 judged |
| timeout_retry_count | 1,244 | grade heuristic | Reliability/performance context |
| blocking_io_count | 45 | grade heuristic | Reliability/performance context |
| observability_lib_present | 1 | grade heuristic and tracing/logging inspection | Operational 7.3 -> +2 |
| logging_call_count | 328 | grade heuristic and logger inspection | Operational 7.4 judged |
| health_endpoint_count | 180 | grade heuristic | Operational 7.2 -> +2 |
| deploy_artifact_count | 2 | Docker/Compose plus GitHub CI | Operational 7.1 -> +3 |
| test_file_count | 1,223 | grade heuristic | Test Quality context |
| test_sleep_count | 10 | grade heuristic | Test Quality 6.4 judged |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: `suppression_count=24` is low relative to 3,185 scanned files, and inspected suppressions remain concentrated in tests, compatibility branches, or documented guardrails.
- **[1.5] Functional completeness - High -> +3**: `tests/`, `server/tests/`, `gateway/tests/`, `npm run check:browser-auth-contract`, `npm run check:architecture-boundaries`, and `npm run check:openapi-route-coverage` cover the stated app, backend, gateway, and API contract surfaces.
- **[2.1] Error handling quality - High -> +6**: `server/src/middleware/validate.ts`, `server/src/errors/errorHandler.ts`, and `src/api/client.ts` use Zod validation errors, Prisma/API error mapping, request IDs, and typed client errors.
- **[2.2] Timeouts and retries - High -> +4**: `src/api/client.ts`, `server/src/middleware/requestTimeout.ts`, `server/src/middleware/rateLimit.ts`, and `gateway/src/middleware/rateLimit/limiters.ts` provide request timeouts, retry/backoff, retry-after headers, and fail-closed rate-limit errors.
- **[2.3] Crash-prone paths - High -> +5**: production `throw new Error` sites are mostly typed/domain failures surfaced through route/service boundaries, while direct `process.exit` usage is limited to utility wrappers and scripts.
- **[3.4] Architecture clarity - High -> +3**: `npm run check:architecture-boundaries` passed with 1,860 files, 7,186 imports, 10 rules, and 40 exceptions.
- **[3.5] Readability/naming - Medium -> +1**: naming and boundaries are generally clear, and the boundary-checker predicates are now named helpers; several classified proof/vector files remain expensive review surfaces.
- **[4.3] Input validation quality - High -> +3**: `server/src/middleware/validate.ts` validates body, params, and query with Zod, and `server/tests/unit/middleware/validate.test.ts` covers parsed body/params/query, getter-backed query, multiple issues, custom messages, and non-Zod failures.
- **[4.4] Safe system/API usage - High -> +3**: inspected raw SQL in `server/src/repositories/agentDashboardRepository.ts` and maintenance repositories uses Prisma tagged templates, and risky patterns such as token-bearing docs are covered by browser-auth and gitleaks checks.
- **[5.1] Hot-path efficiency - High -> +5**: sampled request-facing paths use asynchronous fetch/DB/Redis/Electrum calls with bounded timeout and rate-limit behavior rather than synchronous hot-path work.
- **[5.2] Data access patterns - High -> +3**: `server/src/repositories/agentDashboardRepository.ts` groups counts/balances in the database and uses windowed queries plus `Promise.all` to avoid per-agent fan-out.
- **[5.3] No blocking in hot paths - High -> +2**: `blocking_io_count=45` is concentrated in scripts, startup, maintenance, tests, and support paths rather than request handlers.
- **[6.2] Test structure - High -> +4**: test suites are organized by API, service, repository, integration flow, gateway middleware, UI behavior, contracts, and branch coverage surfaces.
- **[6.3] Edge cases covered - High -> +3**: sampled tests cover empty/default branches, invalid schemas, auth expiry, rate-limit boundaries, timeout behavior, malformed operational balances, wallet/device access, and backup/restore error paths.
- **[6.4] No flaky patterns - High -> +3**: direct sleep evidence is limited, and timer-sensitive tests predominantly use `vi.useFakeTimers()` or explicit timer spies.
- **[7.4] Logging quality - High -> +3**: `server/src/utils/logger.ts` enriches logs with request/trace context, sanitizes control characters, and redacts sensitive fields through `server/src/utils/redact.ts`.

### Missing

- None. The bundled collector did not auto-detect the repo's coverage scripts and initially hit sandbox DNS for `npm audit`; both were resolved with explicit coverage and approved audit commands.

---

## Top Risks

1. Large generated/vector fixtures continue to suppress file-size score - largest scanned files are `server/tests/fixtures/verified-address-vectors.ts` and `scripts/verify-addresses/output/verified-vectors.ts` at 2,118 lines.
2. The generated-output gitleaks remediation is intentionally narrow; if Docusaurus output line numbers shift, the exact fingerprint may need to be refreshed rather than broadening the allowlist.
3. Root dependency audit still has 16 low-severity advisories in upstream wallet/polyfill dependency paths; no current score impact, but they should stay on the dependency triage radar.

## Fastest Improvements

1. Keep generated/vector files classified, and only split or generate them differently when they become regular hand-edited surfaces - up to `+2` maintainability if the largest scanned file drops below 1,000/500 lines - medium/high.
2. Keep the generated-output gitleaks ignore exact; if it drifts, refresh the fingerprint only after source markdown and tracked-tree scans still report 0 findings - recurring small.
3. Keep watching the 16 low root advisories for safe upstream fixes without forced downgrades - no immediate rubric point gain - recurring small.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| A1 | Remove hard-fail cap | Add an exact `.gitleaksignore` fingerprint for the ignored generated Docusaurus HTML false positive while keeping source-doc and tracked-tree gitleaks coverage. | Full working-tree, latest-commit, tracked-tree, source markdown, and Docusaurus intermediate scans all report 0 findings. | complete: `69 -> 95`, `D -> A` |
| A2 | Restore complexity margin | Split architecture import parsing into `scripts/quality/import-parser.mjs` and replace inline rule predicates with named helpers. | `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w -C 15 .` reports 0 warnings. | complete: `95 -> 97` |
| A3 | Reduce review drag selectively | Split the Phase 3 Compose benchmark smoke script into config, runtime, report, proof-runner, and child proof-script modules. | Default `npm run perf:phase3:compose-smoke` passes end to end; entrypoint is 370 lines and touched files have 0 lizard warnings. | complete for the Phase 3 proof surface; no score movement because vector/fixture files remain >1,000 lines |
| A4 | Revisit generated/vector file size only if needed | Keep verified address vectors as fixtures/generated output unless review cost justifies generation-on-demand or fixture sharding. | Largest scanned source drops below rubric threshold without weakening vector coverage. | up to `+2` maintainability |

## Strengths To Preserve

- 100% app/backend/gateway coverage gates with broad edge-case tests.
- Zod validation, browser-auth contract checks, and OpenAPI route coverage at HTTP trust boundaries.
- Architecture-boundary rules with documented exceptions.
- Exposure-aware rate limiting plus health endpoints, tracing/observability support, and contextual redacted logging.

## Work To Defer Or Avoid

- Do not downgrade wallet, Ledger, Trezor, or polyfill packages just to silence low-severity audit output without hardware-flow regression proof.
- Do not broadly allowlist all generated or ignored paths for gitleaks; keep the exact fingerprint approach and keep source docs and tracked files covered.
- Do not split generated/vector/proof artifacts solely for the file-size rubric unless they are actively creating review or maintenance cost.

## Verification Notes

- `date +%F` - `2026-04-25` in the repo timezone.
- `git rev-parse --show-toplevel` - `/home/nekoguntai/sanctuary`.
- `git status --short --branch` before editing - `main...origin/main` with existing grade-tracking changes in `docs/plans/codebase-health-assessment.md`, `docs/plans/grade-history/sanctuary_.jsonl`, and `tasks/todo.md`.
- `git rev-parse --short HEAD` - `1af2fe0d`.
- `bash /home/nekoguntai/.codex/skills/grade/trend.sh prev sanctuary_ full` - previous full entry loaded: `5590f7fe`, 69/100, D.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - tests/lint/typecheck passed; coverage not auto-detected; sandbox DNS blocked native audit; fallback secret scan reported weak hits and was superseded by pinned gitleaks.
- `npm audit --audit-level=high` - 0 high/critical, 16 low root advisories.
- `npm --prefix server audit --audit-level=high`, `npm --prefix gateway audit --audit-level=high`, `npm --prefix ai-proxy audit --audit-level=high` - all found 0 vulnerabilities.
- `npm run test:coverage` - 407 files, 5,630 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` - 398 passed files, 9,253 passed tests, 22 skipped integration files, 100% statements/branches/functions/lines.
- `npm --prefix gateway run test:coverage` - 21 files, 528 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source docs/reference/hardware-wallet-integration.md --no-git --redact --config .gitleaks.toml --no-banner` - no leaks found.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source website/.docusaurus/docusaurus-plugin-content-docs/default/site-docs-reference-hardware-wallet-integration-md-32e.json --no-git --redact --config .gitleaks.toml --no-banner` - no leaks found.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner` before remediation - 1 redacted finding in `website/build/docs/reference/hardware-wallet-integration.html`.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner --report-format json --report-path /tmp/sanctuary-gitleaks-grade-remediation-full-20260425.json` after exact `.gitleaksignore` remediation - no leaks found.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks detect --source . --no-git --redact --config .gitleaks.toml --no-banner --report-format json --report-path /tmp/sanctuary-gitleaks-grade-lizard-fix-20260425.json` after the architecture-boundary helper split - no leaks found.
- `.tmp/quality-tools/gitleaks-8.30.1/gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts -1` - no leaks found.
- `GITLEAKS_BIN=.tmp/quality-tools/gitleaks-8.30.1/gitleaks bash scripts/gitleaks-tracked-tree.sh` - no leaks found.
- `node --check scripts/check-architecture-boundaries.mjs` and `node --check scripts/quality/import-parser.mjs` - passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w -C 15 scripts/check-architecture-boundaries.mjs scripts/quality/import-parser.mjs` - passed with no warnings.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w -C 15 .` - passed with no warnings.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 . > /tmp/sanctuary-lizard-grade-remediation-20260425.txt` - average CCN 1.3; warning count 0; no thresholds exceeded.
- `node --check` on all Phase 3 Compose benchmark split modules - passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -w -C 15 scripts/perf/phase3-compose-benchmark-smoke.mjs scripts/perf/phase3-compose/*.mjs scripts/perf/phase3-compose/proof-scripts/*.mjs` - passed with no warnings.
- `npm run perf:phase3:compose-smoke` with no shell-prefix env overrides - passed end to end under Docker: benchmark harness passed, 1,000 synthetic transaction-history proof passed at p95 23.2 ms, sized backup restore passed, worker queue and worker scale-out proofs passed, backend Redis WebSocket fanout reached 8/8 clients, and the disposable Compose project was removed.
- Phase 3 Compose benchmark smoke file-size check - entrypoint reduced from 2,686 to 370 lines; largest split module is `scripts/perf/phase3-compose/proof-scripts/backend-scale-out.mjs` at 384 lines.
- `npx --yes jscpd@4 --silent --reporters json --output /tmp/sanctuary-jscpd-grade-rerun-20260425 .` - 2.26% duplicated lines.
- `node scripts/quality/check-large-files.mjs` - passed classification check.
- `npm run check:architecture-boundaries` - passed.
- `npm run check:browser-auth-contract` - passed.
- `npm run check:openapi-route-coverage` - passed.
- `bash /home/nekoguntai/.codex/skills/grade/trend.sh append sanctuary_ ... full` - appended pre-remediation, post-secret-remediation, and post-lizard-remediation history entries.
- `git diff --check` - passed.
