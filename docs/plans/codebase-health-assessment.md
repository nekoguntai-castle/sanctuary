# Software Quality Report

Date: 2026-06-06
Owner: Claude
Status: Complete

**Overall Score**: 94/100
**Grade**: A
**Confidence**: High
**Mode**: full
**Commit**: `6c5851d1`

---

## Hard-Fail Blockers

None mechanically tripped.

`tests=pass`, `lint=pass`, `typecheck=pass`, `security_high=0`, `secrets=0`. However, the **coverage pipeline regressed silently** between commit `5a74710b` (prior assessment 2026-06-04) and `6c5851d1` (HEAD): 11 server test files fail under `cd server && npm test` (and therefore under `npm run coverage`) because the workspace import target `@sanctuary/shared/schemas/draftRequests` resolves to a `shared/dist/` artifact that is not rebuilt when only the source is updated. This does not trigger `tests=fail` because grade.sh's `npm test` runs the root frontend vitest (which aliases `@sanctuary/shared` to source), but it does break the coverage chain and any fresh local server test run. See **Top Risks** below.

---

## Domain Scores

| Domain                  | Score     | Notes |
|-------------------------|-----------|-------|
| Correctness             | 20/20     | Frontend tests, lint, typecheck all pass; suppression density very low (29 across ~617k NLOC). |
| Reliability             | 14/15     | Strong timeout/retry presence (1335 sites), centralized error handling, structured logging. |
| Maintainability         | 12/15     | Lizard 0 warnings; duplication 2.67% (just under SonarQube 3%); largest file 966 LOC (just under 1000). |
| Security                | 15/15     | High/critical audit 0; gitleaks 0; schema validation at trust boundaries; no dangerous APIs. |
| Performance             | 10/10     | Anchored: sampled hot paths use bounded I/O, timeouts, and pagination. |
| Test Quality            | 13/15     | Coverage signal is `unknown` (server coverage broke); 1414 test files; structure is behavioral. |
| Operational Readiness   | 10/10     | Dockerfile, Compose, CI, health endpoints, observability lib all present. |
| **TOTAL**               | **94/100** | |

---

## Trend

vs 2026-05-07 (`18134486`): overall **+6** (88 → 94), grade B → A, confidence High → High.

Domain deltas (≥ ±1):
- Maintainability: 12 → 12 (no change, but composition shifted — lizard 5 → 0, duplication 1.69% → 2.67%, largest file 984 → 966)
- Reliability: 12 → 14 (+2; judged uplift from anchored review of expanded timeout/retry footprint)
- Security: 13 → 15 (+2; secrets 0/gitleaks, schema converge work)
- Test Quality: 15 → 13 (-2; coverage regressed from 100 → unknown)

Signal deltas that moved materially:
- `lizard_warning_count`: 5 → 0 (threshold cross to "no warnings")
- `coverage`: 100 → unknown (regression — see Top Risks)
- `duplication_pct`: 1.69 → 2.67 (worsened within band; still under 3%)
- `largest_file_lines`: 984 → 966 (mild improvement)
- `test_file_count`: 1333 → 1414 (+81)
- `blocking_io_count`: 78 → 105 (+27; warrants spot-check next run)
- `suppression_count`: 23 → 29 (+6; still low/kloc)

---

## Evidence

### Mechanical (tool-backed)

| Signal | Value | Tool | Scoring criterion |
|---|---|---|---|
| tests | pass | vitest (root, frontend) | 1.1 |
| lint | pass | eslint | 1.3 |
| typecheck | pass | tsc | 1.2 |
| coverage | unknown | npm run coverage (server run failed) | 6.1 |
| security_high | 0 | npm audit | 4.1 |
| secrets | 0 | gitleaks | 4.2 |
| lizard_warning_count | 0 | lizard (CCN>15) | 3.1 |
| lizard_avg_ccn | 1.4 | lizard | (info) |
| duplication_pct | 2.67 | jscpd | 3.2 |
| largest_file_lines | 966 | wc -l | 3.3 |
| deploy_artifact_count | 2 | filesystem (Dockerfile + Compose + CI) | 7.1 |
| health_endpoint_count | 201 | grep heuristic | 7.2 |
| observability_lib_present | 1 | filesystem | 7.3 |
| validation_lib_present | 1 | filesystem | 4.3 (signal) |
| suppression_count | 29 | grep heuristic | 1.4 (signal) |
| timeout_retry_count | 1335 | grep heuristic | 2.2 (signal) |
| blocking_io_count | 105 | grep heuristic | 5.1 (signal) |

### Judged findings (ISO 25010-anchored)

- **[1.4] Suppression density — High → +4**: ISO Functional Appropriateness. 29 suppressions across ~617k NLOC (~0.05/kloc) is well under the 10/kloc Medium threshold. Inherited from prior — no clustering observed in critical paths.
- **[1.5] Functional completeness — High → +3**: ISO Functional Completeness. README + 1414 test files, no large unfinished scope evident.
- **[2.1] Error handling quality — High → +6**: ISO Fault Tolerance. Anchored — `getErrorMessage`, typed Prisma error helpers, structured logger; no bare-except patterns seen in spot-check.
- **[2.2] Timeouts & retries — High → +4**: ISO Availability. 1335 sites (timeout/retry), `timeout_retry_count` consistent with prior; external I/O wrappers in `services/bitcoin/`, webhook delivery, etc.
- **[2.3] No crash-prone paths — Medium → +4 (downgraded from +5)**: ISO Fault Tolerance. `blocking_io_count` up +27 — would want a Reliability spot-check next iteration; nothing flagrant found in this pass.
- **[3.4] Architecture clarity — High → +3**: ISO Modularity/Analyzability. Active convergence work (multiple "Converge*" commits) is reducing divergent paths; clear server/gateway/frontend/shared split. See Divergent Paths below.
- **[3.5] Readability — High → +2**: ISO Analyzability. Naming and structure consistent; prior assessments confirm.
- **[4.3] Input validation — High → +3**: ISO Integrity. Schemas centralised in `shared/schemas/*` (drafts, vault policy, broadcast); routes validate at boundary.
- **[4.4] Safe system/API usage — High → +3**: ISO Integrity. No `eval`/`innerHTML=`/`shell=True`/string-built SQL found in spot-check; Prisma used everywhere.
- **[5.x] Performance — anchored 10/10**: Hot paths use bounded I/O and pagination. Re-spot-check next run given `blocking_io_count` rise.
- **[6.1] Coverage — Medium → +2**: ISO Functional Completeness. Coverage signal regressed to `unknown` because server coverage broke (root cause in Top Risks). Frontend + gateway are 100%.
- **[6.2] Test structure — High → +4**: ISO Testability. Anchored — 1414 test files including unit/integration/contracts/mutation; arrange-act-assert pattern; meaningful names.
- **[6.3] Edge cases — High → +3**: ISO Functional Completeness. Anchored — explicit malformed/empty/timeout/auth/boundary coverage.
- **[6.4] No flaky patterns — High → +3**: ISO Testability. `test_sleep_count=10` is low for a repo this size; integration tests use seeded clocks/DB.
- **[7.4] Logging — High → +3**: ISO Availability (supporting). `createLogger()` enforced; 350 logging call sites; CLAUDE.md prohibits raw `console.log`.

### Missing

- `lizard_max_ccn` — `unknown` (collector did not emit, but `lizard_warning_count=0` confirms no CCN>15 functions).

---

## Top Risks

1. **Server test/coverage pipeline regresses silently when `shared/dist/` is stale** — concrete signal: `Error: Cannot find package '@sanctuary/shared/schemas/draftRequests' imported from server/src/api/drafts.ts` (and 10 sibling sites). After commit `a02748784 Converge draft request schemas` added new files under `shared/schemas/`, any local checkout that does not re-run `npm install` (or `npm run build --workspace=shared`) after `git pull` will see 11 server test files fail with the same import error. CI is currently protected by `npm ci` running workspace `prepare` hooks, but the local dev loop has no such guard, and the root `npm test` (which grade.sh runs) silently bypasses the failure because the frontend vitest config aliases `@sanctuary/shared` to source. Impact: coverage signal flipped from 100 → unknown in this assessment.
2. **`blocking_io_count` rose 78 → 105 (+27)** in the same window — not a regression by itself, but worth a Reliability spot-check during the next pass to confirm hot paths still avoid synchronous I/O.
3. **`duplication_pct` rose 1.69 → 2.67** — still under the 3% SonarQube threshold but the margin has narrowed. The recent "Converge*" series is *reducing* divergent paths, so this may be a transient duplication during refactor.

---

## Divergent Paths

| Candidate | Evidence | Disposition | Risk / Next Step |
|---|---|---|---|
| Draft request schemas | `shared/schemas/draftRequests.ts` (new in `a02748784`); was duplicated across `server/src/api/drafts.ts`, `server/src/services/draftCreate.ts`, `src/api/drafts.ts` | rationalize — in progress | Active convergence in flight; this is the canonical path. |
| Vault policy request schemas | Similar pattern in `8068d696` | rationalize — in progress | Same as above. |
| Wallet network context | `bug-scrub-slice-4a/4b/4c-fee-network-context.md` | watch | Multi-slice scrub in progress per `tasks/`. |
| All other workflows | Single canonical implementation | justified / watch | No active drift candidates. |

---

## Fastest Improvements

1. **Add a `pretest` (and/or `prebuild`) hook to `server/package.json` that builds `shared` before invoking vitest** — closes the silent-regression vector identified in Top Risk #1. Expected gain: Test Quality 13 → 15 (+2), Confidence stays High. Effort: ~1h including a regression test that wipes `shared/dist/` and asserts `cd server && npm test` still works.
2. **Bundle a top-level `npm run prepare-workspaces` script invoked from `quality.yml`** — makes the "what to do after `git pull`" answer one line in CLAUDE.md. Defer to PR #2 if time-budgeted.
3. **Spot-check the 27 new `blocking_io_count` sites** during the next grade run — likely covered by anchoring if hot paths remain clean.

---

## Summary

Sanctuary is in strong shape — 94/A, High confidence — with mechanical safety nets across security, lint, types, complexity, and ops readiness. The one *concrete actionable regression* is a silent coverage break: the recent schema-convergence work added new files under `shared/schemas/` without a guard that ensures `shared/dist/` is rebuilt before `server` runs vitest. The bounded fix is a single `pretest` hook in `server/package.json` plus a regression test, recoverable in one PR.

Recommended next: enter `grade-loop` Phase 2 with that fix as the sole selected finding; defer the duplication and blocking-IO spot-checks to the post-closeout grade pass.
