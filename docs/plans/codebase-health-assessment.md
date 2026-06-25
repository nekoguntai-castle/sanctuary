# Software Quality Report

Date: 2026-06-25
Owner: Claude
Status: Complete

**Overall Score**: 93/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: `7ae26a00`

---

## Hard-Fail Blockers

None. `tests=pass`, `typecheck=pass`, `lint=pass`, `security_high=0`, `secrets=0`.

---

## Domain Scores

| Domain | Score | Notes |
| --- | ---: | --- |
| Correctness | 20/20 | Frontend/server/gateway tests, lint, typecheck all pass; suppression density ~0.05/KLOC (28 sites). |
| Reliability | 14/15 | 1339 timeout/retry sites; typed error handling (`getErrorMessage`, Prisma helpers); `blocking_io_count=106` keeps 2.3 at Medium. |
| Maintainability | 9/15 | **3.1 drops to 0**: ESLint AST complexity finds **35 functions CCN>15** (lizard's 2 is a known TS under-count — see standards.md). Duplication 2.68% (<3%, +3); largest file 966 (+1); architecture/readability High. |
| Security | 15/15 | npm audit high=0; gitleaks 0; Zod validation at trust boundaries; no `eval`/`innerHTML`/string-SQL. |
| Performance | 10/10 | Anchored: sampled hot paths use bounded I/O, timeouts, pagination; Prisma everywhere. |
| Test Quality | 15/15 | **Coverage 100%** (frontend/server/gateway, authoritative run); 1423 test files; behavioral structure; `test_sleep_count=10`. |
| Operational Readiness | 10/10 | Dockerfile + Compose + CI (2 deploy artifacts); 201 health endpoints; observability lib; structured logging (352 sites). |
| **TOTAL** | **93/100** | |

---

## Trend

vs 2026-06-06 (`7db313cf`): overall **98 → 93 (-5)**, grade **A → A**, confidence High → High.

Domain deltas:
- Maintainability: 14 → 9 (**-5**) — driven entirely by **complexity measurement methodology change**, not a code regression. The prior run scored 3.1 from lizard (`lizard_warning_count=0` → +5). This run uses ESLint's AST-based `complexity` rule (`complexity_tool=eslint`, `complexity_warning_count=35`), which standards.md mandates for TS repos because lizard mis-parses `.tsx`/generic signatures. 35 functions exceed CCN 15 → mechanical 3.1 = 0. These functions are pre-existing; the signal is **newly measured, not newly introduced**.

Signal deltas (vs prior):
- `complexity_warning_count`: (lizard 0) → 35 (eslint) — **measurement change**, see above.
- `coverage`: 100 → 100 (no change; grade.sh's `GRADE_TIMEOUT=120` killed the coverage chain mid-run, so its inline signal showed `unknown`. Authoritative `npm run coverage` confirms 100% across all three packages).
- `duplication_pct`: 2.67 → 2.68 (flat, under 3%).
- `largest_file_lines`: 966 → 966 (flat).
- `test_file_count`: 1415 → 1423 (+8).
- `suppression_count`: 29 → 28 (-1).
- `blocking_io_count`: 105 → 106 (+1).
- `timeout_retry_count`: 1335 → 1339 (+4).

---

## Quality Delta

- **threshold crossing (3.1 complexity)**: `>15 warnings` bucket — but caused by switching to the accurate ESLint measurement, not by code change. Real per-function complexity was always above lizard's report.
- **newly measured**: ESLint AST complexity (35 functions CCN>15). This is now the authoritative maintainability complexity signal for this repo.
- **no lost evidence**: coverage re-confirmed at 100% out-of-band.

---

## Evidence

### Mechanical

| Signal | Value | Tool | Scoring criterion |
| --- | --- | --- | --- |
| tests | pass | vitest (frontend+server+gateway) | 1.1 → +6 |
| typecheck | pass | tsc | 1.2 → +4 |
| lint | pass | eslint | 1.3 → +3 |
| coverage | 100 | `npm run coverage` (authoritative; grade.sh inline = unknown due to 120s timeout) | 6.1 → +5 |
| security_high | 0 | npm audit | 4.1 → +5 |
| secrets | 0 | gitleaks | 4.2 → +4 |
| complexity_warning_count | 35 | eslint `complexity:[error,15]` (AST) | **3.1 → 0** |
| lizard_warning_count | 2 | lizard (TS under-count; provenance only) | (info) |
| lizard_avg_ccn | 1.4 | lizard | (info) |
| duplication_pct | 2.68 | jscpd | 3.2 → +3 |
| largest_file_lines | 966 | wc -l | 3.3 → +1 |
| deploy_artifact_count | 2 | filesystem | 7.1 → +3 |
| health_endpoint_count | 201 | grep heuristic | 7.2 → +2 |
| observability_lib_present | 1 | filesystem | 7.3 → +2 |
| validation_lib_present | 1 | filesystem | 4.3 (signal) |
| suppression_count | 28 | grep heuristic | 1.4 (signal) |
| timeout_retry_count | 1339 | grep heuristic | 2.2 (signal) |
| blocking_io_count | 106 | grep heuristic | 5.1/2.3 (signal) |
| logging_call_count | 352 | grep heuristic | 7.4 (signal) |
| test_file_count | 1423 | filesystem | 6.2 (signal) |
| test_sleep_count | 10 | grep heuristic | 6.4 (signal) |

### Complexity Hotspots (ESLint AST, CCN>15) — full list

Source-scoped: **14 frontend + 17 server + 0 gateway = 31 production functions**, plus 4 in `scripts/`. Top offenders:

| CCN | Function | File | Domain |
| ---: | --- | --- | --- |
| 31 | Arrow (component body) | `components/WalletDetail/modals/ExportModal.tsx` | frontend (presentational) |
| 23 | Arrow | `components/ChangePasswordModal.tsx` | frontend |
| 23 | `signPsbt` | `services/hardwareWallet/adapters/ledger/signPsbt.ts` | frontend (signing) |
| 23 | Arrow (route) | `server/src/api/admin/version.ts` | server (admin) |
| 22 | `signPSBT` | `services/hardwareWallet/adapters/jade.ts` | frontend (signing) |
| 22 | `enforceAgentFundingPolicy` | `server/src/services/agentFundingPolicy.ts` | server (funds) |
| 22 | Arrow (route) | `server/src/api/auth/tokens.ts` | server (auth) |
| 21 | `DashboardContent` | `components/Dashboard/DashboardContent.tsx` | frontend |
| 21 | `notifyAIInsight` | `server/src/services/notifications/channels/aiInsights.ts` | server |
| 21 | `workerHealth` arrow | `server/src/services/workerHealth.ts` | server |
| 18 | `handleMessage` | `services/websocket.ts` | frontend |
| 18 | `updateAgent` | `server/src/repositories/agentRepository.ts` | server |
| 18 | `invoke` | `server/src/providers/registry.ts` | server |
| 17–16 | 18 more (mix of frontend/server) | (see eslint output) | mixed |

### Judged Findings (ISO 25010-anchored)

- **[1.4] Suppression density — High → +4**: 28 suppressions across ~617k NLOC (~0.05/KLOC), well under 10/KLOC. No critical-path clustering.
- **[1.5] Functional completeness — High → +3**: README + 1423 test files; no large unfinished scope.
- **[2.1] Error handling — High → +6**: `getErrorMessage`, typed Prisma helpers, `createLogger`; no bare catches in spot-check.
- **[2.2] Timeouts & retries — High → +4**: 1339 sites; external I/O wrappers in `services/bitcoin/`, webhook delivery.
- **[2.3] Crash-prone paths — Medium → +4**: `blocking_io_count=106` (flat vs prior); nothing flagrant in hot-path spot-check.
- **[3.1] Complexity — 0 (mechanical)**: 35 functions CCN>15 per ESLint AST. ISO Modularity/Modifiability. See hotspot table; remediation requires a phased effort (Roadmap).
- **[3.4] Architecture clarity — High → +3**: clear frontend/server/gateway/shared split; `@sanctuary/shared` workspace; no unjustified parallel paths in this pass.
- **[3.5] Readability — High → +2**: naming/structure consistent.
- **[4.3] Input validation — High → +3**: Zod schemas in `shared/schemas/*`; routes validate at boundary.
- **[4.4] Safe API usage — High → +3**: no dangerous sinks; Prisma everywhere.
- **[5.x] Performance — anchored 10/10**: bounded I/O, pagination, timeouts on sampled hot paths.
- **[6.1] Coverage — +5**: 100% across all packages (authoritative run).
- **[6.2/6.3/6.4] Test structure/edge/flaky — High**: behavioral tests, explicit boundaries, low sleep count.
- **[7.4] Logging — High → +3**: `createLogger()` enforced; 352 sites; raw `console.log` prohibited by CLAUDE.md.

### Missing / Caveats

- `lizard_max_ccn` — unknown (collector did not emit; eslint count supersedes for scoring).
- grade.sh inline `coverage=unknown` is a `GRADE_TIMEOUT=120` artifact, **not** a repo regression — re-run out-of-band at 100%.
- v1 trend JSON schema has no `complexity_warning_count` field; the 35-count is recorded here in the report. JSON keeps `lizard_warning_count=2` for schema continuity, so automated lizard-based trend lines understate complexity.

---

## Top Risks

1. **Distributed cyclomatic complexity (31 production functions CCN>15)** — highest-risk instances are in funds/auth/signing code (`enforceAgentFundingPolicy` 22, `tokens.ts` 22, ledger/jade `signPsbt` 22–23). Complexity here raises change-cost and bug risk in exactly the paths where mistakes move money. Currently **ungated** — the repo's own ESLint config does not enable the `complexity` rule, so this has crept up silently.
2. **No complexity guardrail** — nothing prevents further creep. The lizard-based history masked it (0 → "really 35").
3. **`blocking_io_count` 106 (flat)** — re-spot-check hot paths next pass; no regression this run.

## Divergent Paths

| Candidate | Evidence | Disposition | Risk / Next Step |
| --- | --- | --- | --- |
| Hardware-wallet PSBT signing | `adapters/ledger/signPsbt.ts`, `adapters/jade.ts` both CCN 22–23 | watch | Per-device adapters are a justified boundary; complexity is internal, not duplication. Reduce individually. |
| All other workflows | Single canonical implementation | justified / watch | No active drift candidates found this pass. |

## Fastest Improvements

1. **Reduce the worst hotspot (`ExportModal.tsx`, CCN 31 → <15)** by extracting its 5 tab bodies into sub-components — low-risk (46 existing tests), no funds/auth logic. ~1–2h. (Selected for this loop.)
2. **Add a complexity-budget guardrail** (eslint `complexity` ratchet) so the count can only decrease. Defer — adds a new CI gate to a documented-fragile CI; sequence after a reduction pass lands.
3. **Phased reduction of funds/auth/signing hotspots** (write non-regression tests first per CLAUDE.md, then refactor) — defer to subsequent bounded passes.

## Roadmap To A Grade

| Phase | Target | Work | Exit Criteria | Expected Score Movement |
| --- | --- | --- | --- | --- |
| 1 (this loop) | Reduce worst hotspot | `ExportModal.tsx` 31 → <15 via tab sub-components | 46 tests green; eslint complexity clean on file | Maintainability cleanup (mechanical bucket unchanged until ≤15 total) |
| 2 | Funds/auth/signing | Reduce the 6 CCN≥21 funds/auth/signing functions with non-regression tests first | Each ≤15; tests green | Risk reduction in money paths |
| 3 | Cross below thresholds | Reduce remaining until ≤15 total functions CCN>15 | `complexity_warning_count` ≤15 | 3.1: 0 → +1 (Maintainability 9 → 10) |
| 4 | Guardrail | Add eslint `complexity` ratchet to CI once count is low | New violations fail CI | Locks the gain |

## Strengths To Preserve

- 100% coverage across three packages with a real behavioral suite (1423 files).
- Zero secrets, zero high-vuln deps, Zod validation at boundaries, Prisma-only data access.
- Strong ops readiness: health endpoints, observability, structured logging, enforced logger.

## Work To Defer Or Avoid

- **Do not** cram all 35 complexity reductions into one PR — the rubric warns against broad refactoring campaigns, and no single PR moves the all-or-nothing mechanical bucket (need ≤15 total).
- **Do not** add the complexity CI gate before reductions land — it would lock in 35 violations and add a failure surface to a fragile CI.
- Do not refactor funds/auth/signing complexity without non-regression tests first.

## Verification Notes

- `bash grade.sh` (full): tests=pass, lint=pass, typecheck=pass, security_high=0, secrets=0, complexity_warning_count=35 (eslint), duplication=2.68%, largest_file=966.
- `npm run coverage` (out-of-band, GRADE_TIMEOUT=1800): 100% stmts/branches/funcs/lines across frontend, server, gateway.
- `npx eslint <globs> --rule '{"complexity":["error",15]}'`: 14 frontend + 17 server + 0 gateway + 4 scripts = 35.
- Commit `7ae26a00`, branch `main`, working tree clean except untracked `.prismatic-thread.yaml` (unrelated tooling config, preserved).
