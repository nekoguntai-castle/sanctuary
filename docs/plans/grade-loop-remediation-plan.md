# Grade Loop Remediation Plan

Date: 2026-06-04
Status: Local verification complete
Source grade report: `docs/plans/codebase-health-assessment.md`
Source grade commit: `5a74710b`
Source grade score: 93/100 A, high confidence
Selected finding: `lizard_warning_count=6` and `lizard_max_ccn=25` crossed the maintainability threshold, dropping Maintainability from 12/15 to 10/15.

## Objective

Reduce the current six lizard complexity warnings to zero without changing runtime behavior, public API contracts, data schema, authorization policy, or UI semantics.

Expected grade movement: Maintainability 10/15 -> 14/15 and overall 93/100 -> about 97/100 if all other signals remain stable.

## Non-Goals

- Do not capture physical hardware signing evidence; that requires external devices and remains a separate validation task.
- Do not upgrade or replace dependencies for the 14 moderate and 12 low advisories while high/critical count remains 0.
- Do not rationalize wallet policy or draft route schemas in this PR.
- Do not split large files unless a touched file needs a small extraction to remove the selected complexity warnings.
- Do not change branch protection, CI requirements, release version metadata, Docker service topology, or runtime configuration.

## Selected Hotspots

| Hotspot | Evidence | Planned approach |
| --- | --- | --- |
| `server/src/services/bitcoin/electrumPool/metricsExporter.ts` | CI lizard: anonymous server-stat mapper has CCN 17. | Extract named helpers for server connection filtering, healthy count, active cooldown, and server-stat mapping. |
| `server/src/services/bitcoin/networkStatusService.ts` | CI lizard: `getExplorerUrl` span reported at CCN 16, covering network status assembly. | Split pool probing, singleton fallback, threshold loading, and return-shape assembly into small helpers. |
| `server/src/repositories/nodeConfigRepository.ts` | CI lizard: `esUpdateHealth` has CCN 19. | Introduce a typed health-data alias and a small builder for the Prisma update payload. |
| `components/WalletDetail/webhooks/WalletWebhookRow.tsx` | Grade lizard: row render path has CCN 25. | Extract row header/actions, metadata, secret rotation, delivery state, and delivery table row helpers. |
| `tests/contexts/UserContext.test.tsx` | Grade lizard: `MappingConsumer` test component has CCN 18. | Replace repeated optional/ternary display branches with small value-formatting helpers or data-driven field rendering. |
| `tests/components/send/SendTransactionPage.test.tsx` | Grade lizard: mocked `SendTransactionWizard` has CCN 16. | Move mock rendering into a named helper component and remove inline optional/ternary branches through formatter helpers. |

## Phases

### Phase 1 - Server Production Complexity

Status: Completed

Files:

- `server/src/services/bitcoin/electrumPool/metricsExporter.ts`
- `server/src/services/bitcoin/networkStatusService.ts`
- `server/src/repositories/nodeConfigRepository.ts`
- Existing focused server tests around Electrum pool metrics, network status, and node config repository health updates.

Steps:

1. Extract pure helpers from the Electrum pool metrics mapper and keep `computePoolStats` behavior unchanged.
2. Extract network-status helper functions so `getBitcoinNetworkStatus` reads as orchestration rather than branch-heavy assembly.
3. Extract `buildElectrumServerHealthUpdateData` from `esUpdateHealth`, preserving null/undefined semantics for every optional health field.
4. Add or update focused behavioral tests only where existing coverage does not assert the refactored boundary.

Verification:

- `cd server && npm run test:run -- tests/unit/repositories/nodeConfigRepository.test.ts tests/unit/api/bitcoin.test.ts tests/unit/services/bitcoin/electrumPoolConnections/internal-reconnect-metrics.contracts.ts`
- `cd server && npm run build`
- `npm run quality:lizard`

Acceptance:

- The three CI lizard warnings are gone.
- Existing node config health-update tests still prove healthy/unhealthy error handling, capability fields, silent payment fields, and omitted-field semantics.
- Network status still falls back from pool to singleton and preserves explorer URL, thresholds, display connection, and pool stat semantics.
- Completed evidence: focused server tests passed (144 tests), `cd server && npm run build` passed, and `npm run quality:lizard` passed.

### Phase 2 - Frontend And Test Complexity

Status: Completed

Files:

- `components/WalletDetail/webhooks/WalletWebhookRow.tsx`
- `tests/components/WalletDetail/webhooks/WalletWebhookRow.test.tsx`
- `tests/contexts/UserContext.test.tsx`
- `tests/components/send/SendTransactionPage.test.tsx`

Steps:

1. Split `WalletWebhookRow` into small local components/helpers without changing props exported by `WalletWebhookRow`.
2. Keep button labels, busy-state checks, disabled-state checks, alerts, delivery empty/error/table behavior, and replay semantics unchanged.
3. Simplify the two test helper components by extracting formatting helpers and reducing repeated inline conditional rendering.
4. Update focused tests only if the refactor exposes a missing behavioral assertion.

Verification:

- `npm run test:run -- tests/components/WalletDetail/webhooks/WalletWebhookRow.test.tsx tests/contexts/UserContext.test.tsx tests/components/send/SendTransactionPage.test.tsx`
- `npm run quality:lizard`
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` after all changes, because the grade collector counts the grade-only test/frontend warnings.

Acceptance:

- `WalletWebhookRow` tests pass with the same user-visible controls and states.
- Test-helper refactors do not change the mocked outputs asserted by their owning tests.
- Full grade collector reports `lizard_warning_count=0`.
- Completed evidence: focused frontend/test suite passed (66 tests), app/test/server-test TypeScript checks passed, and direct lizard over all six hotspot files reported zero warnings.

### Phase 3 - Closeout Evidence

Status: Completed

Steps:

1. Run focused tests from Phases 1 and 2.
2. Run the repo lizard gate via `npm run quality:lizard`.
3. Run relevant typechecks:
   - `npm run typecheck:app`
   - `npm run typecheck:tests`
   - `cd server && npm run build`
   - `cd server && npm run typecheck:tests`
4. Run the final full grade collector and repo-owned jscpd scan if the grade collector still lacks global `jscpd`.
5. Update `docs/plans/codebase-health-assessment.md`, this plan, and `tasks/todo.md` with final evidence.

Acceptance:

- Focused tests pass.
- `npm run quality:lizard` passes with zero-warning baseline.
- App, frontend-test, server production, and server-test TypeScript checks pass.
- Full grade collector reports `tests=pass`, `lint=pass`, `typecheck=pass`, `coverage=100.00`, `security_high=0`, `secrets=0`, and `lizard_warning_count=0`.
- Final grade report records the score movement and no hard-fail blockers.

Completed evidence:

- Added `server/tests/unit/services/bitcoin/electrumPool.backoff.test.ts` coverage for expired cooldowns after the first post-change grade attempt exposed an uncovered `metricsExporter.ts` branch.
- `cd server && npm run test:run -- tests/unit/services/bitcoin/electrumPool.backoff.test.ts` passed (25 tests).
- `cd server && npm run test:coverage` passed with escalated localhost binding: 100% statements, branches, functions, and lines.
- `npm run quality:lizard` passed with zero warnings.
- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` passed with escalated localhost binding and reported `tests=pass`, `lint=pass`, `typecheck=pass`, 100% combined coverage, `security_high=0`, `secrets=0`, `lizard_warning_count=0`, and `lizard_max_ccn=15`.
- `QUALITY_JSCPD_OUTPUT_DIR=.tmp/grade-jscpd-2026-06-04 scripts/quality/jscpd-only.sh` passed and measured 1.64% duplication.

## Compatibility And Backout

- All planned changes are local refactors and test helper simplifications. There are no migrations, persisted data shape changes, environment changes, or new runtime dependencies.
- Backout is a normal revert of the PR if a behavioral regression appears. Because the changes preserve public exports and route contracts, rollback does not require database or configuration repair.
- If the network-status split reveals missing behavior coverage, add focused tests before changing the implementation further.
- If a lizard warning remains after a planned extraction, stop and re-plan the specific hotspot instead of adding indirection that obscures behavior.

## Deferred Findings

| Finding | Reason deferred |
| --- | --- |
| Physical hardware-in-loop signing evidence | Requires access to external Ledger/Trezor/BitBox devices and sanitized artifacts. |
| Moderate/low dependency advisories | No high/critical advisories; some fixes are breaking or upstream-limited and need dependency triage. |
| Wallet policy and draft schema drift watch items | Separate contract rationalization slice; changing schemas here would broaden risk beyond complexity remediation. |
| Largest-file moderate risk | Current largest file is within the 500-1000 moderate bucket; splitting it would be churn-heavy relative to the selected finding. |

## Final Delivery Gates

- Recursive plan review reports no verified actionable comments remain.
- Implementation follows this plan or records a scoped divergence with rationale.
- One adversarial implementation review subagent runs after local verification and before PR delivery.
- Required local checks are green before staging unless a failure is unrelated, documented, and allowed by repo delivery rules.
- PR delivery verifies pre-merge CI, merge ancestry, target-branch post-merge CI, local branch cleanup, running-container rebuild status, and post-closeout grade.
