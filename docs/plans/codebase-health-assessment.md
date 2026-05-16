# Software Quality Report

Date: 2026-05-16
Owner: Codex
Status: Current post-reconciliation full grade of the checked-out source aligned with `origin/main`

**Overall Score**: 93/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: `222d7ab8`

---

## Hard-Fail Blockers

None.

The hard-fail gates are clear: tests pass, typecheck passes, high/critical dependency vulnerabilities are 0, and gitleaks found 0 tracked-tree secrets.

Scope note: this run grades source at `222d7ab8`, where the Q4/R/S/T convergence fixes are present. The earlier 87/100 report graded stale local source at `4baa75e6`.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 18/20 | Native tests, typecheck, and lint pass; physical hardware-in-loop proof is still outside this software-only run. |
| Reliability | 15/15 | Central error handling, request timeouts, abort signaling, retry/backoff, fatal process handlers, and structured operational logging remain present. |
| Maintainability | 10/15 | Q4/R/S/T path drift is reconciled, but lizard still reports 4 warnings, source-wide duplication is 4.99%, and the largest file is 949 lines. |
| Security | 15/15 | High/critical vulnerabilities and secrets are clean; Payjoin/admin monitoring route inputs now use stricter schemas at the trust boundary. |
| Performance | 10/10 | Blocking-I/O guard passes, request paths use timeouts/retries, and sampled hot paths did not show obvious N+1 or synchronous hot-path work. |
| Test Quality | 15/15 | Coverage reports 100% for frontend, server, and gateway; inspected tests cover success, validation, empty, error, and timeout paths with mostly deterministic timers. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability, structured logging, rate limits, and request tracing hooks are present. |
| **TOTAL** | **93/100** | |

---

## Trend

- Previous full run: 87/100, B, commit `4baa75e6`, confidence High, dated 2026-05-16.
- Current full run: 93/100, A, commit `222d7ab8`, confidence High, dated 2026-05-16.
- Delta: +6 points, B -> A.

The score recovered because the checked-out source is now aligned with the merged Q4/R/S/T fixes for API base URL ownership, Payjoin validation, admin monitoring validation, and Sparrow hardware export mapping. Remaining point loss is concentrated in maintainability: duplication sits just under the 5% threshold, `UserContext` is still a CCN hotspot, and the repo-owned `jscpd` command path needs hardening.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| source commit | `222d7ab8e7671e9a222720ad42fb8631dc299792`; matches `origin/main` when checked | `git rev-parse HEAD origin/main` | Scope evidence |
| stale divergence scan | no old Q4/R/S/T signatures found | targeted `rg` no-match scan | Maintainability 3.4/Security 4.3 judged evidence |
| tests | pass; 497 files / 6196 tests in root `npm test` | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` | Correctness 1.1: pass = +6 |
| focused route/client tests | pass; API client 94 tests, server focused suite 124 tests | `npx vitest run tests/api/client.test.ts`; `npm --prefix server run test:run ...` | Phase 1 exit evidence |
| typecheck | pass | `npm run typecheck` and `grade.sh` | Correctness 1.2: pass = +4 |
| lint | pass; includes API-body, Bitcoin-boundary, safety-catch, and blocking-I/O guards | `npm run lint` and `grade.sh` | Correctness 1.3: pass = +3 |
| suppression_count | 29 | `grade.sh` heuristic count plus inspection | Correctness 1.4: high, low density and mostly documented defensive guards = +4 |
| coverage | 100.00% lines/statements/functions/branches across frontend, server, gateway | `npm run coverage` via `grade.sh` | Test Quality 6.1: >=80 = +5 |
| security_high | 0 | `npm audit --audit-level=high` / `npm audit --json` | Security 4.1: 0 = +5 |
| dependency advisories | 23 total: 20 low, 3 moderate, 0 high, 0 critical | `npm audit --json` | Non-blocking risk; no hard-fail |
| secrets | 0 | `gitleaks detect --no-git --redact` via `grade.sh` | Security 4.2: 0 = +4 |
| lizard_warning_count | 4 | `lizard` via `grade.sh` | Maintainability 3.1: 1-5 = +3 |
| lizard_avg_ccn | 1.4 | `lizard` via `grade.sh` | Informational |
| lizard_max_ccn | 71 | `lizard`; `contexts/UserContext.tsx` | Finding evidence |
| duplication_pct | 4.99% source-wide; 36,059 duplicated lines; 1,890 exact clones | `npx --yes jscpd@4` with generated/nested worktree/report dirs excluded | Maintainability 3.2: 3-5% = +1 |
| repo-owned duplication command | fails/polluted; 49.74% duplicated lines, includes `.claude/worktrees` paths | `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-phase1 scripts/quality/jscpd-only.sh` | Phase 2 risk evidence |
| largest_file_lines | 949 | `grade.sh` file-size scan | Maintainability 3.3: 500-1000 = +1 |
| deploy_artifact_count | 2 | `grade.sh` filesystem check | Operational 7.1: >=2 = +3 |
| health_endpoint_count | 199 | `grade.sh` heuristic | Operational 7.2: >=1 = +2 |
| observability_lib_present | 1 | `grade.sh` heuristic | Operational 7.3: present = +2 |
| validation_lib_present | 1 | `grade.sh` heuristic | Security inspection hint |
| timeout_retry_count | 1309 | `grade.sh` heuristic | Reliability/performance inspection hint |
| blocking_io_count | 105; blocking-I/O guard passed with 6 allow-listed production files | `grade.sh` and `npm run check:blocking-io` | Performance/reliability inspection hint |
| logging_call_count | 350 | `grade.sh` heuristic | Operational 7.4 judged high = +3 |
| test_file_count | 1391 | `grade.sh` heuristic | Test Quality inspection hint |
| test_sleep_count | 10 | `grade.sh` heuristic plus timer inspection | Test Quality 6.4 judged high = +3 |

### Judged Findings

- **[Correctness 1.5] Functional completeness - Medium -> +1**: The native suite is broad and the reconciled route/export fixes are present, but live hardware-in-loop signing proof remains outside this static/software run.
- **[Reliability 2.1] Error handling quality - High -> +6**: `server/src/errors/errorHandler.ts`, `server/src/middleware/validate.ts`, and `src/api/client.ts` show contextual error mapping, validation errors, request IDs, and retry-aware client failures.
- **[Reliability 2.2] Timeouts and retries - High -> +4**: `server/src/middleware/requestTimeout.ts`, `src/api/client.ts`, gateway rate-limit/backoff middleware, and support-package child-process calls use explicit timeouts or retry controls.
- **[Reliability 2.3] Crash-prone paths - High -> +5**: Fatal process-handler tests are present, production panic-style patterns were not found, and risky process work is bounded to scripts or fixed commands.
- **[Maintainability 3.4] Architecture clarity and path convergence - High -> +3**: The old Payjoin, admin monitoring, hardware export, and API base URL drift signatures are gone from production source; remaining documented splits are watch/justified boundaries.
- **[Maintainability 3.5] Readability/naming - High -> +2**: Spot checks in `src/api/client.ts`, server middleware, route tests, and export mapping code are explicit and mostly self-documenting despite complexity hotspots.
- **[Security 4.3] Input validation quality - High -> +3**: Payjoin and admin monitoring route inputs now use strict typed schemas at the boundary, and the broader app continues to use Zod, auth, CSRF, and rate-limit middleware.
- **[Security 4.4] Safe system/API usage - High -> +3**: Inspected shell/process sites use fixed commands or argument arrays; Redis `eval` uses committed Lua scripts; no production user-controlled `dangerouslySetInnerHTML` or JavaScript `eval` surfaced.
- **[Performance 5.1] Hot-path efficiency - High -> +5**: Sampled request/client code uses retry/timeout controls and does not show obvious repeated synchronous work on request hot paths.
- **[Performance 5.2] Data access patterns - High -> +3**: Sampled repository/service tests and route code exercise batching, pagination, scoped queries, and transaction boundaries.
- **[Performance 5.3] No blocking in hot paths - High -> +2**: `check-blocking-io` passed; remaining child-process/sync sites are scripts, startup migrations, support collectors, or allow-listed cold/ops paths.
- **[Test Quality 6.2] Test structure - High -> +4**: Inspected Payjoin, admin monitoring, wallet export, API-client, websocket, and route tests are behavior-oriented rather than snapshot-only.
- **[Test Quality 6.3] Edge cases covered - High -> +3**: Tests cover malformed input, extras, 401/400/500 paths, timeout/abort behavior, empty results, and service failures.
- **[Test Quality 6.4] No flaky patterns - High -> +3**: The suite still has a small number of sleep/time markers, but the inspected critical tests use deterministic timers and explicit async boundaries.
- **[Operational 7.4] Logging quality - High -> +3**: Server/gateway code uses structured contextual loggers with request IDs, route context, status, timeout, and error metadata.

### Missing Or Limited

- Global `jscpd` was not installed, so the cleaned source-wide duplication measurement used `npx --yes jscpd@4`.
- The repo-owned `scripts/quality/jscpd-only.sh` path currently measures polluted paths and fails the threshold; Phase 2 should make this command the durable source of truth.
- Static grading cannot measure live SLOs, production latency, MTTR, or real change-failure rate.
- Physical Ledger/Trezor/BitBox hardware-in-loop signing remains outside this software-only run.

---

## Top Risks

1. **Repo-owned duplication measurement is not reliable yet** - the cleaned one-off `jscpd` run reports 4.99%, but `scripts/quality/jscpd-only.sh` still includes `.claude/worktrees` and reports 49.74%.
2. **`UserContext` is a maintainability hotspot** - lizard reports CCN 71 for `UserProvider` in `contexts/UserContext.tsx`, where auth bootstrap, logout subscription, theme application, login/2FA/register/logout, preference mutation, and context assembly are coupled.
3. **Moderate dependency advisories remain** - `npm audit` reports 3 moderate advisories and 20 low advisories, with no high or critical advisories.
4. **Hardware proof remains static-only** - software vectors and adapter tests are strong, but they do not prove live hardware behavior on real devices.
5. **A smaller send-flow render hotspot remains** - `components/send/steps/OutputsStep/sections/RecipientsSection.tsx` still reaches CCN 17 and should be simplified when touching the send UI.

---

## Divergent Paths

| Candidate | Evidence | Disposition | Risk / Next Step |
| --- | --- | --- | --- |
| Payjoin attempt route contract | `server/src/api/payjoin.ts` now uses `AttemptPayjoinBodySchema`; old `psbt: z.unknown()` / `payjoinUrl: z.unknown()` signatures are absent. | converged | Keep route tests as the contract owner; no new cleanup needed. |
| Admin monitoring update contract | `server/src/api/admin/monitoring.ts` now uses typed nullable/optional `customUrl`; old passthrough/catch signatures are absent. | converged | Keep malformed-payload tests around null/blank/omitted semantics. |
| Hardware/export device model mapping | Sparrow export mapping now uses the shared `LEDGER_NANO_GEN5` target value while preserving Sanctuary's local `ledger_gen_5` alias. | converged | Keep target-format translation owned by export adapters. |
| API base URL ownership | `src/api/client.ts` consumes `getApiBaseUrl` / `joinApiBaseUrl`; the broad `API_BASE_URL` export is absent. | converged | Keep direct URL construction behind shared helpers. |
| Policy/draft route schemas | Rationalization plan records wallet/admin policy schemas and draft status route schema as looser than service/OpenAPI contracts. | watch | Handle when touching policy/draft APIs; service validation currently reduces blast radius. |
| Root health/raw refresh paths | Raw health and refresh fetches intentionally sit outside authenticated client interceptor recursion. | justified | Keep separate; this is a runtime/auth boundary. |
| LLM egress proxy/backend validation | Proxy-local validation and backend validation both exist. | justified | Keep separate; proxy isolation is the security boundary. |

---

## Fastest Improvements

1. **Harden the repo-owned `jscpd` path** - expected +0 to +2 direct points, plus durable grade evidence - small/medium effort.
2. **Extract `UserContext` session/theme/preference concerns into focused hooks/helpers** - expected +2 maintainability points if lizard warnings drop below current level - medium effort.
3. **Triage the 3 moderate npm advisories** - risk reduction, with no direct hard-gate point gain while high/critical remains 0 - small/medium effort.
4. **Capture hardware-in-loop signing evidence** - expected +1 to +2 correctness confidence/completeness points - requires physical devices.

---

## Roadmap To Hold Or Improve A

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 | Restore current-code convergence | Bring local checkout onto the `origin/main` fixes for Q4/R/S/T while preserving dirty docs. | Local stale-signature scan is clean; focused tests/lint/typecheck/full grade are green. | complete; +6 |
| 2 | Stabilize duplication measurement | Fix `.jscpd.json` / `scripts/quality/jscpd-only.sh` so the repo command excludes generated, report, and nested-worktree paths. | Repo-owned command reproduces the intended source duplication signal. | +0 to +2 |
| 3 | Reduce complexity hotspots | Split `UserProvider`; simplify `RecipientsSection` render branching if still warned. | Lizard warnings drop from 4 toward 0; no context API regression. | +2 |
| 4 | Triage advisories | Upgrade, override, or document moderate advisory reachability. | 0 high/critical remains true and moderate advisories have dated rationale. | risk reduction |
| 5 | Record hardware evidence | Run and document hardware-in-loop signing matrix. | Hardware proof artifact exists and is referenced by tests/docs. | +1 to +2 confidence/completeness |

---

## Strengths To Preserve

- Broad automated test suite with 100% reported coverage across frontend, server, and gateway.
- Strong security and reliability scaffolding: CSRF, HttpOnly cookie auth, rate limits, Zod validation, request timeouts, structured errors, and fatal process handling.
- Clear operational enablers: Docker/Compose, CI, health endpoints, metrics, tracing, and structured logging.
- Rationalization discipline: known divergent paths are documented, classified, and now reconciled in the checked-out source.

## Work To Defer Or Avoid

- Do not start a broad generated-client or framework rewrite to chase the grade; the demonstrated risk is narrower route/export/base-URL drift and duplication-tooling reliability.
- Do not remove raw refresh/health fetch boundaries; those are justified by auth-interceptor recursion constraints.
- Do not collapse LLM proxy validation into backend validation; that would weaken the egress isolation boundary.
- Do not chase every test-fixture duplicate mechanically; first distinguish intentional contract matrices from production duplication through the fixed repo-owned report.

## Verification Notes

- `git rev-parse HEAD origin/main` - both resolved to `222d7ab8e7671e9a222720ad42fb8631dc299792`.
- `! rg -n "psbt: z\\.unknown|payjoinUrl: z\\.unknown|customUrl: z\\.unknown|\\.passthrough\\(\\)\\.catch\\(\\{\\}\\)|ledger_gen_5.*LEDGER_FLEX|ledger_gen_5.*LEDGER_NANO_S|export \\{ API_BASE_URL \\}" ...` - passed with no matches.
- `npm --prefix shared run build` - passed before server tests so shared constants were available.
- `npx vitest run tests/api/client.test.ts` - passed, 94 tests.
- `npm --prefix server run test:run -- tests/unit/api/payjoin.test.ts tests/unit/api/admin-monitoring-routes.test.ts tests/unit/api/wallets-export-routes.test.ts tests/unit/services/export/formatHandlers.test.ts` - passed, 124 tests.
- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - passed native tests, lint, typecheck, coverage, audit, secrets, lizard, file-size, and readiness collection.
- `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-phase1 scripts/quality/jscpd-only.sh` - failed as expected/currently polluted, reporting 49.74% duplicated lines across `.claude/worktrees` and other paths.
- `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd-phase1-source --ignore ... .` - measured cleaned source-wide duplication at 4.99%.
- Trend history was appended under `docs/plans/grade-history/sanctuary_.jsonl`.
