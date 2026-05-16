# Software Quality Report

Date: 2026-05-16
Owner: Codex
Status: Current Phase 2 duplication-tooling checkpoint after reconciling source and fixing the repo-owned `jscpd` command

**Overall Score**: 95/100
**Grade**: A
**Confidence**: High
**Mode**: phase2 duplication-tooling checkpoint
**Commit**: `fed96e56+phase2-working-tree`

---

## Hard-Fail Blockers

None.

The hard-fail gates are clear after rerun verification: tests pass, typecheck passes, high/critical dependency vulnerabilities are 0, and gitleaks found 0 tracked-tree secrets.

Scope note: this checkpoint builds on the Phase 1 source reconciliation at `222d7ab8` and the Phase 1 closeout merge at `fed96e56`. Phase 2 changes only the committed duplication-tooling path and related documentation.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 18/20 | Native tests, typecheck, and lint pass; physical hardware-in-loop proof is still outside this software-only run. |
| Reliability | 15/15 | Central error handling, request timeouts, abort signaling, retry/backoff, fatal process handlers, and structured operational logging remain present. |
| Maintainability | 12/15 | Q4/R/S/T path drift is reconciled and the repo-owned production-biased `jscpd` signal is now 1.65%; remaining loss is lizard warnings and the 949-line largest file. |
| Security | 15/15 | High/critical vulnerabilities and secrets are clean; Payjoin/admin monitoring route inputs now use stricter schemas at the trust boundary. |
| Performance | 10/10 | Blocking-I/O guard passes, request paths use timeouts/retries, and sampled hot paths did not show obvious N+1 or synchronous hot-path work. |
| Test Quality | 15/15 | Coverage reports 100% for frontend, server, and gateway; inspected tests cover success, validation, empty, error, and timeout paths with mostly deterministic timers. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability, structured logging, rate limits, and request tracing hooks are present. |
| **TOTAL** | **95/100** | |

---

## Trend

- Previous checkpoint: 93/100, A, commit `222d7ab8`, confidence High, dated 2026-05-16.
- Current checkpoint: 95/100, A, commit `fed96e56+phase2-working-tree`, confidence High, dated 2026-05-16.
- Delta: +2 points, A held.

The score moved because the canonical duplication command now honors the committed config and `.gitignore`, excludes local hidden worktrees and generated/temp paths, and reports 1.65% duplicated lines over the intended production-biased source set. Remaining point loss is concentrated in `UserContext` complexity, a smaller send-flow render hotspot, moderate dependency advisories, and missing physical hardware-in-loop evidence.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| source base | `fed96e56315267b29ec0790f132c229b7fa40aff` from `origin/main` before Phase 2 edits | `git log origin/main` | Scope evidence |
| stale divergence scan | no old Q4/R/S/T signatures found in Phase 1 | targeted `rg` no-match scan | Maintainability 3.4/Security 4.3 judged evidence |
| tests | pass; 497 files / 6196 tests on rerun | `npm test` after the grade collector run | Correctness 1.1: pass = +6 |
| focused transient-test rerun | pass; 6 tests | `npx vitest run tests/contexts/CurrencyContext/settings.test.tsx` | Confirms grade-collector test failure was transient/unrelated |
| typecheck | pass | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` | Correctness 1.2: pass = +4 |
| lint | pass; includes API-body, Bitcoin-boundary, safety-catch, and blocking-I/O guards | `grade.sh` | Correctness 1.3: pass = +3 |
| suppression_count | 29 | `grade.sh` heuristic count plus inspection | Correctness 1.4: high, low density and mostly documented defensive guards = +4 |
| coverage | 100.00% lines/statements/functions/branches across frontend, server, gateway | `npm run coverage` via `grade.sh` | Test Quality 6.1: >=80 = +5 |
| security_high | 0 | `npm audit --audit-level=high` / `npm audit --json` via `grade.sh` | Security 4.1: 0 = +5 |
| dependency advisories | 23 total: 20 low, 3 moderate, 0 high, 0 critical | `npm audit --json` via `grade.sh` | Non-blocking risk; no hard-fail |
| secrets | 0 | `gitleaks detect --no-git --redact` via `grade.sh` | Security 4.2: 0 = +4 |
| lizard_warning_count | 4 | `lizard` via `grade.sh` | Maintainability 3.1: 1-5 = +3 |
| lizard_avg_ccn | 1.4 | `lizard` via `grade.sh` | Informational |
| lizard_max_ccn | 71 | `lizard`; `contexts/UserContext.tsx` | Finding evidence |
| repo duplication_pct | 1.65%; 5,223 duplicated lines; 259 exact clones; 2,601 files | `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-phase2 scripts/quality/jscpd-only.sh` | Maintainability 3.2: <3% = +3 |
| repo duplication scope check | no `.claude`, `.tmp`, `node_modules`, test, `.test`, or `.spec` paths found in report source list | `jq ... | rg ...` against `.tmp/grade-jscpd-phase2/jscpd-report.json` | Phase 2 exit evidence |
| repo duplication reports | JSON and markdown reports present | `test -s .tmp/grade-jscpd-phase2/jscpd-report.json` and `.md` | Phase 2 exit evidence |
| script syntax | pass | `bash -n scripts/quality/jscpd-only.sh` | Script safety evidence |
| largest_file_lines | 949 | `grade.sh` file-size scan | Maintainability 3.3: 500-1000 = +1 |
| deploy_artifact_count | 2 | `grade.sh` filesystem check | Operational 7.1: >=2 = +3 |
| health_endpoint_count | 199 | `grade.sh` heuristic | Operational 7.2: >=1 = +2 |
| observability_lib_present | 1 | `grade.sh` heuristic | Operational 7.3: present = +2 |
| validation_lib_present | 1 | `grade.sh` heuristic | Security inspection hint |
| timeout_retry_count | 1309 | `grade.sh` heuristic | Reliability/performance inspection hint |
| blocking_io_count | 105; blocking-I/O guard passed with 6 allow-listed production files | `grade.sh` | Performance/reliability inspection hint |
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
- **[Test Quality 6.4] No flaky patterns - High -> +3**: The suite still has a small number of sleep/time markers; one full-grade `npm test` lane had a transient failure, but the same test passed in coverage, focused rerun, and full root rerun.
- **[Operational 7.4] Logging quality - High -> +3**: Server/gateway code uses structured contextual loggers with request IDs, route context, status, timeout, and error metadata.

### Missing Or Limited

- The grade collector still reports global `jscpd` as unavailable; the committed repo-owned `scripts/quality/jscpd-only.sh` now supplies the durable duplication signal through `npx --yes jscpd@4`.
- Static grading cannot measure live SLOs, production latency, MTTR, or real change-failure rate.
- Physical Ledger/Trezor/BitBox hardware-in-loop signing remains outside this software-only run.

---

## Top Risks

1. **`UserContext` is a maintainability hotspot** - lizard reports CCN 71 for `UserProvider` in `contexts/UserContext.tsx`, where auth bootstrap, logout subscription, theme application, login/2FA/register/logout, preference mutation, and context assembly are coupled.
2. **Moderate dependency advisories remain** - `npm audit` reports 3 moderate advisories and 20 low advisories, with no high or critical advisories.
3. **Hardware proof remains static-only** - software vectors and adapter tests are strong, but they do not prove live hardware behavior on real devices.
4. **A smaller send-flow render hotspot remains** - `components/send/steps/OutputsStep/sections/RecipientsSection.tsx` still reaches CCN 17 and should be simplified when touching the send UI.
5. **Source-wide test fixture duplication remains intentional but large** - the production-biased repo gate is 1.65%, while broad all-source measurements include contract-test matrices; keep test fixture cleanup behavior-preserving and evidence-driven.

---

## Divergent Paths

| Candidate | Evidence | Disposition | Risk / Next Step |
| --- | --- | --- | --- |
| Payjoin attempt route contract | `server/src/api/payjoin.ts` now uses `AttemptPayjoinBodySchema`; old `psbt: z.unknown()` / `payjoinUrl: z.unknown()` signatures are absent. | converged | Keep route tests as the contract owner; no new cleanup needed. |
| Admin monitoring update contract | `server/src/api/admin/monitoring.ts` now uses typed nullable/optional `customUrl`; old passthrough/catch signatures are absent. | converged | Keep malformed-payload tests around null/blank/omitted semantics. |
| Hardware/export device model mapping | Sparrow export mapping now uses the shared `LEDGER_NANO_GEN5` target value while preserving Sanctuary's local `ledger_gen_5` alias. | converged | Keep target-format translation owned by export adapters. |
| API base URL ownership | `src/api/client.ts` consumes `getApiBaseUrl` / `joinApiBaseUrl`; the broad `API_BASE_URL` export is absent. | converged | Keep direct URL construction behind shared helpers. |
| Duplication measurement path | `.jscpd.json` is now explicitly passed by `scripts/quality/jscpd-only.sh`, `.gitignore` is honored, and hidden workspace ignores cover nested `.claude`, `.tmp`, `.tmp-gh`, and `.git` paths. | converged | Keep one repo-owned duplication path; avoid parallel one-off commands in future grade reports. |
| Policy/draft route schemas | Rationalization plan records wallet/admin policy schemas and draft status route schema as looser than service/OpenAPI contracts. | watch | Handle when touching policy/draft APIs; service validation currently reduces blast radius. |
| Root health/raw refresh paths | Raw health and refresh fetches intentionally sit outside authenticated client interceptor recursion. | justified | Keep separate; this is a runtime/auth boundary. |
| LLM egress proxy/backend validation | Proxy-local validation and backend validation both exist. | justified | Keep separate; proxy isolation is the security boundary. |

---

## Fastest Improvements

1. **Extract `UserContext` session/theme/preference concerns into focused hooks/helpers** - expected +2 maintainability points if lizard warnings drop below current level - medium effort.
2. **Triage the 3 moderate npm advisories** - risk reduction, with no direct hard-gate point gain while high/critical remains 0 - small/medium effort.
3. **Capture hardware-in-loop signing evidence** - expected +1 to +2 correctness confidence/completeness points - requires physical devices.
4. **Simplify `RecipientsSection` while touching send UI** - small maintainability improvement; lower priority than `UserContext`.

---

## Roadmap To Hold Or Improve A

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 | Restore current-code convergence | Bring local checkout onto the `origin/main` fixes for Q4/R/S/T while preserving dirty docs. | Local stale-signature scan is clean; focused tests/lint/typecheck/full grade are green. | complete; +6 |
| 2 | Stabilize duplication measurement | Fix `.jscpd.json` / `scripts/quality/jscpd-only.sh` so the repo command excludes generated, report, and nested-worktree paths. | Repo-owned command reports 1.65% duplication over the intended production-biased source set. | complete; +2 |
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

- Do not start a broad generated-client or framework rewrite to chase the grade; the demonstrated risk is narrower route/export/base-URL drift, duplication-tooling reliability, and context complexity.
- Do not remove raw refresh/health fetch boundaries; those are justified by auth-interceptor recursion constraints.
- Do not collapse LLM proxy validation into backend validation; that would weaken the egress isolation boundary.
- Do not chase every test-fixture duplicate mechanically; first distinguish intentional contract matrices from production duplication through the fixed repo-owned report.

## Verification Notes

- `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-phase2 scripts/quality/jscpd-only.sh` - passed, reporting 1.65% duplicated lines, 5,223 duplicated lines, 259 clones, 2,601 files, with JSON and markdown reports.
- `jq -r '.statistics.formats[]?.sources? | keys[]?' .tmp/grade-jscpd-phase2/jscpd-report.json | rg '(^|/)\\.claude/|(^|/)\\.tmp/|(^|/)node_modules/|(^|/)tests?/|\\.test\\.|\\.spec\\.'` - no matches.
- `bash -n scripts/quality/jscpd-only.sh` - passed.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` - completed collection; lint, typecheck, coverage, audit, secrets, lizard, file-size, and readiness signals were collected. Its initial root `npm test` lane reported one transient failure in `tests/contexts/CurrencyContext/settings.test.tsx`.
- `npx vitest run tests/contexts/CurrencyContext/settings.test.tsx` - passed 6 tests after the grade collector run.
- `npm test` - passed on rerun, 497 files / 6196 tests.
- Trend history was appended under `docs/plans/grade-history/sanctuary_.jsonl`.
