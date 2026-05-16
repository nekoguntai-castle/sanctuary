# Software Quality Report

Date: 2026-05-16
Owner: Codex
Status: Current Phase 6 final-grade checkpoint after Phases 0-5 were merged and the final re-grade found and fixed an auth-bootstrap preference race

**Overall Score**: 95/100
**Grade**: A
**Confidence**: High
**Mode**: phase6-final-grade-checkpoint
**Commit**: `2cd1c143+phase6-working-tree`

---

## Hard-Fail Blockers

None.

The final post-fix grade collector has no hard-fail blockers: root tests pass, typecheck passes, lint passes, high/critical dependency vulnerabilities are 0, and gitleaks found 0 tracked-tree secrets.

Scope note: this checkpoint builds on Phase 0 preservation, Phase 1 source reconciliation, Phase 2 duplication-tooling fix, Phase 3 `UserContext` split, Phase 4 advisory triage, and Phase 5 hardware-readiness/blocker documentation. Phase 6 also fixed a small frontend preference persistence race discovered by the full re-grade: currency setting changes made while auth bootstrap is still loading are now queued and flushed once the authenticated user is available.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 18/20 | Native tests, typecheck, and lint pass; physical hardware-in-loop proof remains outside this software-only run. |
| Reliability | 15/15 | Central error handling, request timeouts, abort signaling, retry/backoff, fatal process handlers, and structured operational logging remain present. |
| Maintainability | 12/15 | Q4/R/S/T path drift is reconciled, repo-owned production-biased `jscpd` is 1.65%, and `UserProvider` is no longer a lizard warning; remaining loss is other small lizard warnings and the 949-line largest file. |
| Security | 15/15 | High/critical vulnerabilities and secrets are clean; trust-boundary validation remains strong. |
| Performance | 10/10 | Blocking-I/O guard passes, request paths use timeouts/retries, and sampled hot paths did not show obvious N+1 or synchronous hot-path work. |
| Test Quality | 15/15 | Coverage reports 100% for frontend, server, and gateway; the final root test run covers 497 files / 6,197 tests. |
| Operational Readiness | 10/10 | Docker/Compose, CI, health endpoints, observability, structured logging, rate limits, and request tracing hooks are present. |
| **TOTAL** | **95/100** | |

---

## Trend

- Previous checkpoint: 95/100, A, commit `9edf7a62+phase5-working-tree`, confidence High, dated 2026-05-16.
- Current checkpoint: 95/100, A, commit `2cd1c143+phase6-working-tree`, confidence High, dated 2026-05-16.
- Delta: +/-0 points, A held.

Phase 6 confirms the remediation plan holds A range after all deliverable phases. The score stays flat because the remaining point loss is still in the same buckets: physical hardware evidence is unavailable, one production lizard warning remains, two test helper warnings remain, and the largest file is still below the 1,000-line poor threshold but above the preferred 500-line line.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| final tests | pass; 497 files / 6,197 tests | `bash /home/nekoguntai/.codex/skills/grade/grade.sh` -> `npm test` | Correctness 1.1: pass = +6 |
| final lint | pass | `grade.sh` -> `npm run lint` | Correctness 1.3: pass = +3 |
| final typecheck | pass | `grade.sh` -> `npx --no-install tsc --noEmit` | Correctness 1.2: pass = +4 |
| final coverage | 100.00% lines/statements/functions/branches across frontend, server, gateway | `grade.sh` -> `npm run coverage` | Test Quality 6.1: >=80 = +5 |
| security_high | 0 | `grade.sh` -> `npm audit --audit-level=high` and `npm audit --json` | Security 4.1: 0 = +5 |
| dependency advisories | 23 total: 20 low, 3 moderate, 0 high, 0 critical | `npm audit --json` via `grade.sh` | Non-blocking risk; no hard-fail |
| remaining moderate advisory chain | accepted; `prisma -> @prisma/dev -> @hono/node-server`; npm proposes a breaking downgrade and current same-major Prisma dev tooling still pins the vulnerable nested package | Phase 4 audit triage | Phase 4 rationale |
| website advisories | 0 total after Mermaid lockfile refresh | `npm --prefix website audit --json` | Phase 4 exit evidence |
| secrets | 0 | `gitleaks detect --no-git --redact` via `grade.sh` | Security 4.2: 0 = +4 |
| lizard_warning_count | 3 | `lizard` via `grade.sh` | Maintainability 3.1: 1-5 = +3 |
| lizard_avg_ccn | 1.4 | `lizard` via `grade.sh` | Informational |
| largest_file_lines | 949 | `grade.sh` file-size scan | Maintainability 3.3: 500-1000 = +1 |
| repo duplication_pct | 1.65%; 5,223 duplicated lines; 259 exact clones; 2,601 files | `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-phase2 scripts/quality/jscpd-only.sh` | Maintainability 3.2: <3% = +3 |
| global jscpd availability | unknown in `grade.sh`; repo-owned duplication command supplies the durable signal | `grade.sh` | Missing tool note, confidence remains High because repo-owned `npx --yes jscpd@4` path passed |
| suppression_count | 29 | `grade.sh` heuristic plus inspection | Correctness 1.4: high, low density and mostly documented defensive guards = +4 |
| deploy_artifact_count | 2 | `grade.sh` filesystem check | Operational 7.1: >=2 = +3 |
| health_endpoint_count | 199 | `grade.sh` heuristic | Operational 7.2: >=1 = +2 |
| observability_lib_present | 1 | `grade.sh` heuristic | Operational 7.3: present = +2 |
| validation_lib_present | 1 | `grade.sh` heuristic | Security inspection hint |
| timeout_retry_count | 1309 | `grade.sh` heuristic | Reliability/performance inspection hint |
| blocking_io_count | 105; blocking-I/O guard passed with 6 allow-listed production files | `grade.sh` | Performance/reliability inspection hint |
| logging_call_count | 350 | `grade.sh` heuristic | Operational 7.4 judged high = +3 |
| test_file_count | 1391 | `grade.sh` heuristic | Test Quality inspection hint |
| test_sleep_count | 10 | `grade.sh` heuristic plus timer inspection | Test Quality 6.4 judged high = +3 |
| auth-bootstrap currency preference fix | pass; 7 settings tests and 10 provider-init tests focused, final full root tests green | `npx vitest run tests/contexts/CurrencyContext/settings.test.tsx tests/contexts/CurrencyContext/providerInit.test.tsx`; `npm test`; `grade.sh` | Phase 6 corrective evidence |
| hardware validation software gates | pass; address verifier 122 vectors / 0 disagreements, PSBT verifier 5 unsigned + 4 signed vectors, hardware adapter tests 100 tests, non-strict hardware fixture replay 16 tests, typecheck and lizard gates pass | `docs/plans/hardware-wallet-validation-2026-05-16.md` | Phase 5 readiness evidence |
| strict hardware signed fixture gate | expected fail; 11 required physical rows are missing and 4 multisig rows are product-blocked | `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` | Phase 5 blocker evidence |

### Judged Findings

- **[Correctness 1.5] Functional completeness - Medium -> +1**: The native suite is broad and the reconciled route/export/base-URL fixes are present, but live hardware-in-loop signing proof remains outside this static/software run.
- **[Reliability 2.1] Error handling quality - High -> +6**: `server/src/errors/errorHandler.ts`, `server/src/middleware/validate.ts`, and `src/api/client.ts` show contextual error mapping, validation errors, request IDs, and retry-aware client failures.
- **[Reliability 2.2] Timeouts and retries - High -> +4**: `server/src/middleware/requestTimeout.ts`, `src/api/client.ts`, gateway rate-limit/backoff middleware, and support-package child-process calls use explicit timeouts or retry controls.
- **[Reliability 2.3] Crash-prone paths - High -> +5**: Fatal process-handler tests are present, production panic-style patterns were not found, and risky process work is bounded to scripts or fixed commands.
- **[Maintainability 3.4] Architecture clarity and path convergence - High -> +3**: The old Payjoin, admin monitoring, hardware export, API base URL, duplication-tooling, and `UserContext` responsibility drift have converged; remaining documented splits are watch/justified boundaries.
- **[Maintainability 3.5] Readability/naming - High -> +2**: Spot checks in `src/api/client.ts`, server middleware, export mapping code, `contexts/useUserPreferenceMutation.ts`, and `contexts/CurrencyContext.tsx` are explicit and mostly self-documenting despite remaining smaller hotspots.
- **[Security 4.3] Input validation quality - High -> +3**: Payjoin and admin monitoring route inputs now use strict typed schemas at the boundary, and the broader app continues to use Zod, auth, CSRF, and rate-limit middleware.
- **[Security 4.4] Safe system/API usage - High -> +3**: Inspected shell/process sites use fixed commands or argument arrays; Redis `eval` uses committed Lua scripts; no production user-controlled `dangerouslySetInnerHTML` or JavaScript `eval` surfaced.
- **[Performance 5.1] Hot-path efficiency - High -> +5**: Sampled request/client code uses retry/timeout controls and does not show obvious repeated synchronous work on request hot paths.
- **[Performance 5.2] Data access patterns - High -> +3**: Sampled repository/service tests and route code exercise batching, pagination, scoped queries, and transaction boundaries.
- **[Performance 5.3] No blocking in hot paths - High -> +2**: `check-blocking-io` passed; remaining child-process/sync sites are scripts, startup migrations, support collectors, or allow-listed cold/ops paths.
- **[Test Quality 6.2] Test structure - High -> +4**: Inspected Payjoin, admin monitoring, wallet export, API-client, websocket, UserContext, and CurrencyContext tests are behavior-oriented rather than snapshot-only.
- **[Test Quality 6.3] Edge cases covered - High -> +3**: Tests cover malformed input, extras, 401/400/500 paths, timeout/abort behavior, empty results, service failures, auth bootstrap timing, and provider reload fallback.
- **[Test Quality 6.4] No flaky patterns - High -> +3**: A full-grade run exposed a deterministic timing gap in CurrencyContext; the production race and brittle provider reload assertion were fixed, and the final root and grade runs are green.
- **[Operational 7.4] Logging quality - High -> +3**: Server/gateway code uses structured contextual loggers with request IDs, route context, status, timeout, and error metadata.

### Missing Or Limited

- `jscpd` is not globally installed for `grade.sh`; the repo-owned duplication command remains the source of truth and passed through `npx --yes jscpd@4`.
- Static grading cannot measure live SLOs, production latency, MTTR, or real change-failure rate.
- Physical Ledger/Trezor/BitBox hardware-in-loop signing remains outside this software-only run.

---

## Top Risks

1. **Physical hardware proof remains blocked** - software gates are ready, but the strict fixture gate still needs 11 sanitized Ledger, Trezor, and BitBox physical signing artifacts.
2. **Accepted Prisma dev-tool Hono advisory remains** - root workspace `npm audit` reports 3 moderate records for one dev-tool chain, with no high or critical advisories; revisit when Prisma updates `@prisma/dev`.
3. **A smaller send-flow render hotspot remains** - `components/send/steps/OutputsStep/sections/RecipientsSection.tsx` still reaches CCN 17 and should be simplified when touching the send UI.
4. **Two test helper components still exceed the lizard threshold** - `MappingConsumer` in `tests/contexts/UserContext.test.tsx` and `SendTransactionWizard` in `tests/components/send/SendTransactionPage.test.tsx` remain warning sites.
5. **Source-wide test fixture duplication remains intentional but large** - the production-biased repo gate is 1.65%, while broad all-source measurements include contract-test matrices; keep test fixture cleanup behavior-preserving and evidence-driven.

---

## Divergent Paths

| Candidate | Evidence | Disposition | Risk / Next Step |
| --- | --- | --- | --- |
| Payjoin attempt route contract | `server/src/api/payjoin.ts` now uses `AttemptPayjoinBodySchema`; old `psbt: z.unknown()` / `payjoinUrl: z.unknown()` signatures are absent. | converged | Keep route tests as the contract owner. |
| Admin monitoring update contract | `server/src/api/admin/monitoring.ts` now uses typed nullable/optional `customUrl`; old passthrough/catch signatures are absent. | converged | Keep malformed-payload tests around null/blank/omitted semantics. |
| Hardware/export device model mapping | Sparrow export mapping now uses the shared `LEDGER_NANO_GEN5` target value while preserving Sanctuary's local `ledger_gen_5` alias. | converged | Keep target-format translation owned by export adapters. |
| API base URL ownership | `src/api/client.ts` consumes `getApiBaseUrl` / `joinApiBaseUrl`; the broad `API_BASE_URL` export is absent. | converged | Keep direct URL construction behind shared helpers. |
| Duplication measurement path | `.jscpd.json` is explicitly passed by `scripts/quality/jscpd-only.sh`, `.gitignore` is honored, and hidden workspace ignores cover nested `.claude`, `.tmp`, `.tmp-gh`, and `.git` paths. | converged | Keep one repo-owned duplication path. |
| UserContext provider responsibilities | `contexts/UserContext.tsx` delegates auth lifecycle, auth actions, theme sync, and preference mutation to focused helper modules; targeted lizard shows 0 warnings across the refactored context files. | converged | Keep the public context contract stable. |
| Currency preference bootstrap | `contexts/CurrencyContext.tsx` now queues settings changed while `/auth/me` is loading and flushes them after the user is available; `contexts/useUserPreferenceMutation.ts` keeps its user ref synchronous with rendered context state. | converged | Keep bootstrap preference writes covered by `tests/contexts/CurrencyContext/settings.test.tsx`. |
| Policy/draft route schemas | Rationalization plan records wallet/admin policy schemas and draft status route schema as looser than service/OpenAPI contracts. | watch | Handle when touching policy/draft APIs; service validation currently reduces blast radius. |
| Root health/raw refresh paths | Raw health and refresh fetches intentionally sit outside authenticated client interceptor recursion. | justified | Keep separate; this is a runtime/auth boundary. |
| LLM egress proxy/backend validation | Proxy-local validation and backend validation both exist. | justified | Keep separate; proxy isolation is the security boundary. |

---

## Fastest Improvements

1. **Capture hardware-in-loop signing evidence** - expected +1 to +2 correctness confidence/completeness points; requires physical devices.
2. **Simplify `RecipientsSection` while touching send UI** - small maintainability improvement; now the primary production lizard hotspot.
3. **Simplify the two remaining test helper warnings when touching those tests** - low risk, low priority.

---

## Roadmap Status

| Phase | Target | Status | Evidence |
| --- | --- | --- | --- |
| 0 | Preserve dirty docs before branch reconciliation | complete and merged | PR #492 / closeout PR #493 |
| 1 | Reconcile local source with remote convergence | complete and merged | PR #494 / closeout PR #495 |
| 2 | Make duplication measurement reproducible | complete and merged | PR #496 / closeout PR #497 |
| 3 | Split `UserContext` complexity | complete and merged | PR #498 / closeout PR #499 |
| 4 | Triage moderate dependency advisories | complete and merged | PR #500 / closeout PR #501 |
| 5 | Record hardware software readiness and physical blocker | readiness complete and merged | PR #502 / closeout PR #503 |
| 6 | Re-grade and lock the improvement | in delivery | final grade collector is green; this report and history entry are the Phase 6 artifacts |

---

## Strengths To Preserve

- Broad automated test suite with 100% reported coverage across frontend, server, and gateway.
- Strong security and reliability scaffolding: CSRF, HttpOnly cookie auth, rate limits, Zod validation, request timeouts, structured errors, and fatal process handling.
- Clear operational enablers: Docker/Compose, CI, health endpoints, metrics, tracing, and structured logging.
- Rationalization discipline: known divergent paths are documented, classified, and either converged or explicitly justified.

## Work To Defer Or Avoid

- Do not start a broad generated-client or framework rewrite to chase the grade; the demonstrated risk was narrower route/export/base-URL drift, duplication-tooling reliability, context complexity, and auth-bootstrap preference timing.
- Do not remove raw refresh/health fetch boundaries; those are justified by auth-interceptor recursion constraints.
- Do not collapse LLM proxy validation into backend validation; that would weaken the egress isolation boundary.
- Do not chase every test-fixture duplicate mechanically; first distinguish intentional contract matrices from production duplication through the fixed repo-owned report.

## Verification Notes

- Final full grade: `bash /home/nekoguntai/.codex/skills/grade/grade.sh` passed with `tests=pass`, `lint=pass`, `typecheck=pass`, 100% aggregate coverage, `security_high=0`, `secrets=0`, and `lizard_warning_count=3`.
- Focused Phase 6 fix verification passed: `npx vitest run tests/contexts/CurrencyContext/settings.test.tsx tests/contexts/CurrencyContext/providerInit.test.tsx`, `npx vitest run tests/contexts/UserContext.preferences.test.tsx tests/hooks/useUserPreference.test.tsx`, `npm run typecheck:app`, `npm run typecheck:tests`, and `npm run lint:app`.
- Full root verification passed after the Phase 6 fix: `npm test` reported 497 files / 6,197 tests.
- Hardware readiness verification remains as recorded in `docs/plans/hardware-wallet-validation-2026-05-16.md`; strict hardware fixture capture is blocked on 11 missing physical rows and 4 product-blocked multisig rows.
- Trend history was appended under `docs/plans/grade-history/sanctuary_.jsonl`.
