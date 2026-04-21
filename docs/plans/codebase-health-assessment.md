# Software Quality Report

Date: 2026-04-20 19:17 HST
Owner: TBD
Status: Current

**Overall Score**: 97/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: 24e4cff2

---

## Hard-Fail Blockers

None.

- `tests=pass`: app, backend, and gateway suites pass.
- `typecheck=pass`: TypeScript checks pass.
- `lint=pass`: lint passes.
- `security_high=0`: root, server, gateway, and AI proxy audits report no high or critical advisories.
- `secrets=0`: pinned gitleaks direct, latest-commit, and tracked-tree scans found no leaks.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Tests, lint, typecheck, browser auth contract, OpenAPI route coverage, and architecture checks are green. |
| Reliability | 15/15 | Error handling, request timeouts, retry/backoff, typed validation, and shutdown paths remain consistent by inspection. |
| Maintainability | 12/15 | Lizard reports 0 warnings and duplication is low; score loss is from classified proof/generated files above 1,000 lines. |
| Security | 15/15 | No high/critical advisories, no detected secrets, trust-boundary validation is present, and sampled unsafe API patterns are controlled. |
| Performance | 10/10 | Request-facing I/O is async/bounded; sampled data-access paths use grouped/windowed queries rather than per-row fan-out. |
| Test Quality | 15/15 | App, backend, and gateway coverage gates are green at 100% statements/branches/functions/lines. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability libraries, and contextual logging are present. |
| **TOTAL** | **97/100** | Grade A; no hard-fail cap applied. |

---

## Trend

- vs 2026-04-20 (`working-tree-after-8993389b`): overall `+0` (`97 -> 97`), grade `A -> A`, confidence `High -> High`.
- vs 2026-04-18 (`219e2d98`): overall `+5` (`92 -> 97`), grade `A -> A`, confidence `High -> High`.
- The lizard cleanup loop remains complete: broad lizard reports 0 warnings.
- The large-file cleanup loop remains complete for unclassified files: only four pre-classified proof/generated/vector-fixture files exceed the warning limit.
- The prior Vitest future-compatibility warning remains resolved.
- No new P0/P1 remediation candidate was found in this audit.

---

## Evidence

### Mechanical Signals

| Signal | Value | Tool | Scoring Criterion |
| --- | --- | --- | --- |
| tests | pass; app 401 files/5,593 tests; backend 391 passed/22 skipped files with 9,156 passed/503 skipped tests; gateway 20 files/513 tests | `grade.sh`; coverage commands | Correctness 1.1 |
| typecheck | pass | `grade.sh`; TypeScript project checks | Correctness 1.2 |
| lint | pass | `grade.sh`; npm lint scripts | Correctness 1.3 |
| browser_auth_contract | pass; 1,047 browser files scanned | `npm run check:browser-auth-contract` | Correctness 1.5 |
| openapi_route_coverage | pass; 315 Express routes, 311 OpenAPI operations, 4 documented exceptions | `npm run check:openapi-route-coverage` | Correctness 1.5 |
| architecture_boundaries | pass; 1,852 files, 7,159 imports, 9 rules, 40 exceptions | `npm run check:architecture-boundaries` | Maintainability 3.4 |
| coverage | app 100%, backend 100%, gateway 100% statements/branches/functions/lines | V8/Vitest coverage summaries | Test Quality 6.1 |
| security_high | 0 high/critical | `npm audit --json` in root, `server`, `gateway`, and `ai-proxy` | Security 4.1 |
| root_audit | 16 low, 0 moderate, 0 high, 0 critical | `npm audit --json` | Security 4.1 context |
| server_audit | 0 vulnerabilities | `npm audit --json` in `server` | Security 4.1 context |
| gateway_audit | 8 low, 0 moderate, 0 high, 0 critical | `npm audit --json` in `gateway` | Security 4.1 context |
| ai_proxy_audit | 0 vulnerabilities | `npm audit --json` in `ai-proxy` | Security 4.1 context |
| secrets | 0 | pinned gitleaks direct, latest-commit, and tracked-tree scans | Security 4.2 |
| rg_secret_fallback | 8 raw PEM/API-shaped hits; treated as weak fallback evidence only | `grade.sh` regex fallback | Security 4.2 context |
| lizard_warning_count | 0 functions with CCN > 15 | `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w .` | Maintainability 3.1 |
| lizard_avg_ccn | 1.3 | `.tmp/quality-tools/lizard-1.21.2/bin/lizard .` | Maintainability 3.1 context |
| duplication_pct | 1.97%; 274 clones, 5,261 duplicated lines | `npx --yes jscpd@4 .` | Maintainability 3.2 |
| largest_file_lines | 2,637 | `scripts/perf/phase3-compose-benchmark-smoke.mjs` | Maintainability 3.3 |
| large_file_classification | pass; 4 files over warning limit, all classified | `node scripts/quality/check-large-files.mjs` | Maintainability 3.3 context |
| deploy_artifact_count | 2 | `grade.sh` | Operational Readiness 7.1 |
| health_endpoint_count | 180 | `grade.sh` heuristic | Operational Readiness 7.2 |
| observability_lib_present | 1 | `grade.sh` heuristic | Operational Readiness 7.3 |
| validation_lib_present | 1 | `grade.sh` heuristic | Security 4.3 |
| suppression_count | 22 | `grade.sh` heuristic | Correctness 1.4 |
| timeout_retry_count | 1,216 | `grade.sh` heuristic | Reliability 2.2 |
| blocking_io_count | 36 | `grade.sh` heuristic | Performance 5.1/5.3 |
| logging_call_count | 319 | `grade.sh` heuristic | Operational Readiness 7.4 |
| test_file_count | 1,205 | `grade.sh` heuristic | Test Quality 6.2 |
| test_sleep_count | 10 | `grade.sh` heuristic | Test Quality 6.4 |

### Judged Findings

- **[1.4] Suppression density - High -> +4**: suppressions are low relative to repository size and are mostly targeted dynamic Prisma, overloaded response, or test-override cases.
- **[1.5] Functional completeness - High -> +3**: native tests and contract checks cover the primary app/server/gateway behavior surfaces.
- **[2.1] Error handling quality - High -> +6**: `src/api/client.ts`, `server/src/middleware/validate.ts`, `server/src/errors/errorHandler.ts`, and gateway validation paths use typed errors and contextual logging.
- **[2.2] Timeouts and retries - High -> +4**: request timeout middleware, API clients, Prisma setup, Electrum paths, gateway middleware, and monitoring calls have bounded timeout/retry behavior.
- **[2.3] Crash-prone paths - High -> +5**: process-exit behavior is centralized and sampled production code avoids broad panic/assert-style paths.
- **[3.4] Architecture clarity - High -> +3**: architecture boundary checks pass across root/server/gateway/shared imports.
- **[3.5] Readability/naming - Medium -> +1**: complexity is clean, but the score intentionally keeps pressure on classified proof-harness size and repeated schema/UI patterns.
- **[4.3] Input validation quality - High -> +3**: Zod schemas validate request bodies, params, query data, and runtime config at trust boundaries.
- **[4.4] Safe system/API usage - High -> +3**: inspected `eval` hits are fixed Redis Lua scripts, Prisma raw SQL uses tagged templates, child-process usage is bounded to scripts/admin checks, and browser `innerHTML` hits are test-only.
- **[5.1] Hot-path efficiency - High -> +5**: request-facing HTTP, DB, Redis, Electrum, and AI paths use async calls, timeouts, and bounded retry/backoff patterns.
- **[5.2] Data access patterns - High -> +3**: dashboard/support repositories use grouped/windowed queries and `Promise.all` rather than obvious per-row fan-out.
- **[5.3] No blocking in hot paths - High -> +2**: blocking I/O hits are concentrated in scripts, startup, shutdown, support, tests, or maintenance paths.
- **[6.2] Test structure - High -> +4**: tests are organized by behavior, API/service/repository layer, contracts, and branch coverage.
- **[6.3] Edge cases covered - High -> +3**: sampled tests cover invalid payloads, auth refresh failures, rate-limit boundaries, coverage policy, null/default schemas, wallet access, and async timeout utilities.
- **[6.4] No flaky patterns - High -> +3**: timer-heavy tests use fake timers; direct sleeps are isolated to async helper tests.
- **[7.4] Logging quality - High -> +3**: app/server/gateway logging includes request context and redaction utilities.

---

## Worthwhile Findings

No code remediation is recommended from this audit.

- The only score loss is `largest_file_lines`, but every file above the warning limit is already classified as proof harness, generated output, or vector fixture. Splitting these now would mainly create churn and review overhead.
- Root and gateway low-severity audit advisories remain, but current npm fix paths involve behavior-risky major downgrades or no safe non-downgrade fix. They should stay tracked, not forced.
- Duplication is below the configured threshold at 1.97%.
- Complexity is below threshold with 0 lizard warnings.
- Contract checks, coverage, lint, typecheck, gitleaks, and large-file classification are all green.

## Top Risks To Track

1. Classified proof/generated files can still be hard to review if they change often, especially `scripts/perf/phase3-compose-benchmark-smoke.mjs`.
2. Low-severity dependency advisories in root and gateway should be revisited when upstream packages publish safe upgrade paths.
3. The 100% coverage gates are valuable but expensive; keep the fast PR/full post-merge split under observation.

## Work To Defer Or Avoid

- Do not split generated/vector/proof artifacts purely to recover the remaining 3 maintainability points.
- Do not accept npm audit suggestions that downgrade hardware-wallet or Firebase packages without behavior proof.
- Do not relax coverage, lizard, architecture, lint, route coverage, validation, or gitleaks gates.

## Next Review Triggers

- A classified large file starts receiving frequent hand-edits.
- npm audit reports a moderate/high/critical advisory, or a safe minor/patch upgrade clears the current low advisory chains.
- PR checks become materially slower or begin missing failures that appear only after merge.

---

## Verification Notes

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed: tests pass, lint pass, typecheck pass, and heuristic signals collected.
- `npm run test:coverage` passed: 401 app test files, 5,593 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` passed: 391 backend test files passed, 22 skipped; 9,156 tests passed, 503 skipped; 100% statements/branches/functions/lines.
- `npm run test:coverage` in `gateway` passed: 20 files, 513 tests, 100% statements/branches/functions/lines.
- `npm audit --json` completed in root, `server`, `gateway`, and `ai-proxy`; high/critical count is 0.
- Pinned gitleaks direct working-tree, latest-commit, and tracked-tree scans completed clean.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w .` completed with 0 warnings.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard .` completed with average CCN 1.3 and no thresholds exceeded.
- `npx --yes jscpd@4 .` completed at 1.97% duplication.
- `node scripts/quality/check-large-files.mjs` passed with 4 classified files over the warning limit.
- `npm run check:architecture-boundaries` passed.
- `npm run check:browser-auth-contract` passed.
- `npm run check:openapi-route-coverage` passed.
