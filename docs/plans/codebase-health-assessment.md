# Software Quality Report

Date: 2026-05-16
Owner: Codex
Status: Current full grade of the checked-out worktree; local `main` is `ahead 1, behind 18` relative to `origin/main`

**Overall Score**: 87/100
**Grade**: B
**Confidence**: High
**Mode**: full
**Commit**: `4baa75e6`

---

## Hard-Fail Blockers

None.

The grade hard-fail gates are clear: tests pass, typecheck passes, high/critical dependency vulnerabilities are 0, and gitleaks found 0 tracked-tree secrets.

Important scope note: this is a full grade of the current checkout, not of the newer remote `origin/main`. The local branch is behind by 18 commits, so several rationalization fixes already present on `origin/main` still count as active risks in this worktree.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 18/20 | Tests, typecheck, and lint pass; functional completeness is held below full credit because physical hardware-in-loop proof and the newer remote convergence fixes are not present in this checkout. |
| Reliability | 15/15 | Central error handling, request timeouts, abort signaling, retry/backoff, fatal process handlers, and structured operational logging are present. |
| Maintainability | 6/15 | Lizard reports 4 warnings, source-wide duplication is 5.11%, largest file is 949 lines, and this checkout still has active divergent route/export/API paths fixed only on remote. |
| Security | 13/15 | Dependency high/critical count and secrets are clean, but input validation is only medium because current Payjoin and admin monitoring routes still accept loose `z.unknown()`/passthrough bodies. |
| Performance | 10/10 | Blocking-I/O guard passes, request paths use timeouts/retries, and sampled hot paths did not show obvious N+1 or synchronous hot-path work. |
| Test Quality | 15/15 | Coverage reports 100% for frontend, server, and gateway; inspected tests cover success, validation, empty, error, and timeout paths with mostly deterministic timers. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability, structured logging, rate limits, and request tracing hooks are present. |
| **TOTAL** | **87/100** | |

---

## Trend

- Previous full run: 95/100, A, commit `efd18003`, confidence High, dated 2026-05-13.
- Current full run: 87/100, B, commit `4baa75e6`, confidence High, dated 2026-05-16.
- Delta: -8 points, A -> B.

The score drop is not from broken gates. It comes from scoring the stale local checkout: remote rationalization fixes for Payjoin/admin monitoring/hardware export/API base URL are not in the checked-out code, source-wide duplication now measures 5.11%, and `UserContext` complexity rose to CCN 71.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass; 491 files / 6174 tests in root `npm test` | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` | Correctness 1.1: pass = +6 |
| typecheck | pass | `npx --no-install tsc --noEmit` via `grade.sh` | Correctness 1.2: pass = +4 |
| lint | pass; includes API-body, Bitcoin-boundary, safety-catch, and blocking-I/O guards | `npm run lint` via `grade.sh` | Correctness 1.3: pass = +3 |
| suppression_count | 29 | `grade.sh` heuristic count plus inspection | Correctness 1.4: high, low density and mostly documented defensive guards = +4 |
| coverage | 100.00% lines/statements/functions/branches across frontend, server, gateway | `npm run coverage` via `grade.sh` | Test Quality 6.1: >=80 = +5 |
| security_high | 0 | `npm audit --audit-level=high` / `npm audit --json` | Security 4.1: 0 = +5 |
| dependency advisories | 23 total: 20 low, 3 moderate, 0 high, 0 critical | `npm audit --json` | Non-blocking risk; no hard-fail |
| secrets | 0 | `gitleaks detect --no-git --redact` via `grade.sh` | Security 4.2: 0 = +4 |
| lizard_warning_count | 4 | `lizard` via `grade.sh` | Maintainability 3.1: 1-5 = +3 |
| lizard_avg_ccn | 1.4 | `lizard` via `grade.sh` | Informational |
| lizard_max_ccn | 71 | `lizard` warning output, `contexts/UserContext.tsx` | Finding evidence |
| duplication_pct | 5.11% source-wide; 3.14% production-biased excluding tests/docs | `npx --yes jscpd@4` with generated/nested worktree dirs excluded | Maintainability 3.2: >5% = 0 |
| largest_file_lines | 949 | `grade.sh` file-size scan | Maintainability 3.3: 500-1000 = +1 |
| deploy_artifact_count | 2 | `grade.sh` filesystem check | Operational 7.1: >=2 = +3 |
| health_endpoint_count | 199 | `grade.sh` heuristic | Operational 7.2: >=1 = +2 |
| observability_lib_present | 1 | `grade.sh` heuristic | Operational 7.3: present = +2 |
| validation_lib_present | 1 | `grade.sh` heuristic | Security inspection hint |
| timeout_retry_count | 1309 | `grade.sh` heuristic | Reliability/performance inspection hint |
| blocking_io_count | 103; blocking-I/O guard passed with 5 allow-listed production files | `grade.sh` and `npm run check:blocking-io` | Performance/reliability inspection hint |
| logging_call_count | 350 | `grade.sh` heuristic | Operational 7.4 judged high = +3 |
| test_file_count | 1385 | `grade.sh` heuristic | Test Quality inspection hint |
| test_sleep_count | 10 | `grade.sh` heuristic plus timer inspection | Test Quality 6.4 judged high = +3 |

### Judged Findings

- **[Correctness 1.5] Functional completeness - Medium -> +1**: The native suite is broad, but this checkout lacks newer remote convergence fixes and still lacks physical hardware-in-loop proof for real device signing.
- **[Reliability 2.1] Error handling quality - High -> +6**: `server/src/errors/errorHandler.ts`, `server/src/middleware/validate.ts`, and `src/api/client.ts` show contextual error mapping, validation errors, request IDs, and retry-aware client failures.
- **[Reliability 2.2] Timeouts and retries - High -> +4**: `server/src/middleware/requestTimeout.ts`, `src/api/client.ts`, gateway rate-limit/backoff middleware, and support-package child-process calls use explicit timeouts or retry controls.
- **[Reliability 2.3] Crash-prone paths - High -> +5**: Fatal process-handler tests are present, production `unwrap`/panic-style patterns were not found, and risky process work is bounded to scripts or fixed commands.
- **[Maintainability 3.4] Architecture clarity and path convergence - Low -> +0**: Current local code still has active divergent Payjoin validation, admin monitoring validation, hardware export mapping, and API base URL paths that have already needed rationalization on `origin/main`.
- **[Maintainability 3.5] Readability/naming - High -> +2**: Spot checks in `src/api/client.ts`, server middleware, and route tests are explicit and mostly self-documenting despite large-file/branching hotspots.
- **[Security 4.3] Input validation quality - Medium -> +1**: Zod, auth, CSRF, rate-limit, and route validation are widely used, but current `server/src/api/payjoin.ts` and `server/src/api/admin/monitoring.ts` still accept loose request bodies.
- **[Security 4.4] Safe system/API usage - High -> +3**: Inspected shell/process sites use fixed commands or argument arrays; Redis `eval` uses committed Lua scripts; no production user-controlled `dangerouslySetInnerHTML` or JavaScript `eval` surfaced.
- **[Performance 5.1] Hot-path efficiency - High -> +5**: Sampled request/client code uses retry/timeout controls and does not show obvious repeated synchronous work on request hot paths.
- **[Performance 5.2] Data access patterns - High -> +3**: Sampled repository/service tests and route code exercise batching, pagination, scoped queries, and transaction boundaries.
- **[Performance 5.3] No blocking in hot paths - High -> +2**: `check-blocking-io` passed; remaining child-process/sync sites are scripts, startup migrations, support collectors, or allow-listed cold/ops paths.
- **[Test Quality 6.2] Test structure - High -> +4**: Inspected Payjoin, admin monitoring, websocket, route, and API-client tests are behavior-oriented rather than snapshot-only.
- **[Test Quality 6.3] Edge cases covered - High -> +3**: Tests cover malformed input, extras, 401/400/500 paths, timeout/abort behavior, empty results, and service failures.
- **[Operational 7.4] Logging quality - High -> +3**: Server/gateway code uses structured contextual loggers with request IDs, route context, status, timeout, and error metadata.

### Missing Or Limited

- `jscpd` was not installed globally, so it was run through `npx --yes jscpd@4`; the measured source-wide result is still usable.
- Static grading cannot measure live SLOs, production latency, MTTR, or real change-failure rate.
- Physical Ledger/Trezor/BitBox hardware-in-loop signing remains outside this software-only run.
- Remote `origin/main` contains newer fixes than this local checkout; no merge or fast-forward was performed by this grade run.

---

## Top Risks

1. **Current checkout is stale relative to the remote convergence work** - Payjoin/admin monitoring/hardware export/API base URL fixes exist on `origin/main` but not in local `HEAD`, so this grade scores active local drift in `server/src/api/payjoin.ts`, `server/src/api/admin/monitoring.ts`, `server/src/api/wallets/export.ts`, `server/src/services/export/handlers/sparrow.ts`, and `src/api/client.ts`.
2. **Source-wide duplication is above the poor threshold** - `jscpd` measured 5.11% duplicated lines across source and tests; the largest clusters are contract/test fixtures under `server/tests/unit/services/bitcoin/sync/phasesProcessTransactions/*`.
3. **`UserContext` is a maintainability hotspot** - lizard reports CCN 71 for `UserProvider` in `contexts/UserContext.tsx`, where auth bootstrap, logout subscription, theme application, login/2FA/register/logout, preference mutation, and context assembly are coupled.
4. **Moderate dependency advisories remain** - `npm audit` reports 3 moderate advisories, including `@hono/node-server`, `@tootallnate/once` chains, and `elliptic` with no direct high/critical advisory.
5. **Hardware proof remains static-only** - software vectors and adapter tests are strong, but they do not prove live hardware behavior on real devices.

---

## Divergent Paths

| Candidate | Evidence | Disposition | Risk / Next Step |
| --- | --- | --- | --- |
| Payjoin attempt route contract | Local `server/src/api/payjoin.ts` still uses `psbt: z.unknown()` and `payjoinUrl: z.unknown()` while service/OpenAPI expect strings. | rationalize | Already fixed on `origin/main` via Phase R; fast-forward/import the fix before trusting local route-boundary behavior. |
| Admin monitoring update contract | Local `server/src/api/admin/monitoring.ts` still uses `customUrl: z.unknown().optional()`, `.passthrough()`, and `.catch({})`. | rationalize | Already fixed on `origin/main` via Phase S; local malformed payloads can still diverge from OpenAPI. |
| Hardware/export device model mapping | Local export route maps `ledger_gen_5` to `LEDGER_FLEX`, while Sparrow handler maps it to `LEDGER_NANO_S`. | rationalize | Already fixed on `origin/main` via Phase T with a shared Sparrow mapping owner. |
| API base URL ownership | Local `src/api/client.ts` still exports `API_BASE_URL` and builds several URLs directly from it. | rationalize | Already fixed on `origin/main` via Phase Q4; local code still keeps a broader public constant surface. |
| Policy/draft route schemas | Rationalization plan records wallet/admin policy schemas and draft status route schema as looser than service/OpenAPI contracts. | watch | Handle when touching policy/draft APIs; service validation currently reduces blast radius. |
| Root health/raw refresh paths | Raw health and refresh fetches intentionally sit outside authenticated client interceptor recursion. | justified | Keep separate; this is a runtime/auth boundary. |
| LLM egress proxy/backend validation | Proxy-local validation and backend validation both exist. | justified | Keep separate; proxy isolation is the security boundary. |

---

## Fastest Improvements

1. **Fast-forward or reconcile local `main` with `origin/main`** - expected +4 to +6 points - low/medium effort depending on preserving dirty docs.
2. **Add a repo-owned `jscpd` command/config with generated, nested-worktree, coverage, and intentional fixture exclusions** - expected +1 to +3 points if true source duplication stays below 5% - small effort.
3. **Extract `UserContext` session/theme/preference concerns into focused hooks/helpers** - expected +2 maintainability points if lizard warnings drop below current level - medium effort.
4. **Triage the 3 moderate npm advisories** - expected security risk reduction, no hard-gate point gain while high/critical remains 0 - small/medium effort.
5. **Capture hardware-in-loop signing evidence** - expected +2 correctness confidence/completeness points - requires physical devices.

---

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 | Restore current-code convergence | Bring local checkout onto the `origin/main` fixes for Q4/R/S/T while preserving dirty docs. | Local `rg` no longer finds old Payjoin/admin/hardware/API-base drift; tests/lint/typecheck stay green. | +4 to +6 |
| 2 | Stabilize duplication measurement | Add committed duplication config or script and document intentional test fixture duplication. | `jscpd` source-wide signal is reproducible and below or explicitly scoped around 5%. | +1 to +3 |
| 3 | Reduce complexity hotspots | Split `UserProvider`; simplify `RecipientsSection` render branching if still warned. | lizard warnings drop from 4 toward 0; no context API regression. | +2 |
| 4 | Close verification gaps | Run hardware-in-loop signing matrix and record firmware/device/vector evidence. | Hardware proof artifact exists and is referenced by tests/docs. | +1 to +2 confidence/completeness |

---

## Strengths To Preserve

- Broad automated test suite with 100% reported coverage across frontend, server, and gateway.
- Strong security and reliability scaffolding: CSRF, HttpOnly cookie auth, rate limits, Zod validation, request timeouts, structured errors, and fatal process handling.
- Clear operational enablers: Docker/Compose, CI, health endpoints, metrics, tracing, and structured logging.
- Rationalization discipline: known divergent paths are documented and already fixed on the remote branch.

## Work To Defer Or Avoid

- Do not start a broad generated-client or framework rewrite to chase the grade; the demonstrated risk is narrower route/export/base-URL drift.
- Do not remove raw refresh/health fetch boundaries; those are justified by auth-interceptor recursion constraints.
- Do not collapse LLM proxy validation into backend validation; that would weaken the egress isolation boundary.
- Do not chase every test-fixture duplicate mechanically; first distinguish intentional contract matrices from production duplication.

## Verification Notes

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - passed native tests, lint, typecheck, coverage, audit, secrets, lizard, file-size, and readiness collection; `jscpd` was not on PATH.
- `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd-source --ignore ... .` - measured source-wide duplication at 5.11% after excluding generated/nested-worktree directories.
- `npx --yes jscpd@4 --silent --reporters json --output .tmp/grade-jscpd-prod --ignore ... .` - measured production-biased duplication at 3.14% for context only.
- `npm audit --json | jq ...` - confirmed 20 low, 3 moderate, 0 high, 0 critical advisories.
- Targeted inspections covered `contexts/UserContext.tsx`, `components/send/steps/OutputsStep/sections/RecipientsSection.tsx`, `src/api/client.ts`, `server/src/errors/errorHandler.ts`, `server/src/middleware/requestTimeout.ts`, `server/src/middleware/validate.ts`, `server/src/api/payjoin.ts`, `server/src/api/admin/monitoring.ts`, hardware export mapping, and the current rationalization plan.
- Trend history was appended under `docs/plans/grade-history/sanctuary_.jsonl`.
