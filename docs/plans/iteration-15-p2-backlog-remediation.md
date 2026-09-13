# Iteration 15 — P2 backlog remediation plan

Run: `bug-scrub-loop-20260912t210000z-p2-backlog` (successor to `…-361d68a`, which closed
`blocked` at iteration 14 with these findings deferred).
Iteration: 15 (numbering continues the predecessor lineage).
Source: target branch `main` @ `00f01ddb7171a51a8ba8a674d5c31f688f65fa78`.
Discovery: full eight-domain scrub at `a231c551`
(`reports/bug-scrub-iteration-13-closing-scrub-2026-09-12.md`), **re-verified against
`00f01ddb` on 2026-09-12** by four read-only shards. All 25 still reproduce; none were fixed by
PRs #1069–#1075. Four were escalated to P1 by the coordinator on evidence (see Ordering).

Goal: remediate the full P0–P2 blocking set — 4 P1 + 21 P2 — in dependency-ordered,
independently mergeable phases, **each finding with a failing-first regression test that the
coordinator proves red against `origin/main`'s production files before delivery.** This is the
owner's stated priority for this run.

Non-goals: the 14 P3 findings remain non-blocking backlog. No refactors beyond what a fix
requires, no product-policy changes, no schema changes. The prevout unit-heuristic question is
flagged, not fixed.

Assumptions: phases are independent unless a dependency is stated. Helper names are
implementation steps. Merges are strictly serial per `CLAUDE.md`; rebase only the next PR.

Execution model: Sonnet subagents implement one phase each on a task branch; the coordinator
reviews every diff, re-proves red/green, reruns every gate (**including
`check-large-files.mjs`, lizard at its exact 86-warning baseline, and `arch:check`**), and
delivers. Subagents never push, open PRs, or touch the ledger.

Deployment: this run's `containersRunningAtStart` is **`true`** (18 containers at init). Unlike
the predecessor, the final policy **will** rebuild the running stack via `./start.sh --rebuild`
after the clean pass; the coordinator confirms with the owner before doing so.

---

## Ordering

P1s first, in blast-radius order, then P2s grouped by implementation boundary. Grouping follows
the shards' boundary analyses: findings share a PR only when they share files or a single fix
point; same-*shape* findings in different files stay separate.

| Phase | Sev | Findings | Boundary |
| --- | --- | --- | --- |
| 1 | P1 | `admin-user-delete-orphans-sole-owned-wallets` | `userAdminUpdate.ts` |
| 2 | P1 | `create-user-modal-retains-password-after-success` + P2 `group-create-enter-double-submit` | `src/components/UsersGroups/` |
| 3 | P1 | `draft-signed-state-partial-failure-duplicates-drafts` | `useDraftManagement.ts` + send reducer |
| 4 | P1 | `send-broadcast-lost-lease-wedges-wizard` | `useSendOperationOwner.ts`, `useBroadcast.ts`, `ReviewStep.tsx` — **sequenced after 3** (Phase 3 threads a new callback through `useSendTransactionActions`, which Phase 4 also edits) |
| 5 | P2 | `sendmax-subtractfees-skip-spendability-filters` | `utxoRepository.ts`, `utxoModes.ts` |
| 6 | P2 | `vacuum-statement-timeout-not-connection-affine` + `vacuum-integration-test-never-runs-and-skips-production-path` | maintenance VACUUM path + CI group wiring |
| 7 | P2 | `body-parser-route-table-trailing-slash-mismatch` | `bodyParsing.ts` |
| 8 | P2 | `webhook-min-amount-filter-drops-sent-transactions` | `webhooks/subscriptions.ts` |
| 9 | P2 | `decoy-change-split-emits-sub-dust-outputs` | `decoyAmounts.ts` |
| 10 | P2 | `electrum-estimatefee-sentinel-becomes-1-satvb` | `electrum/methods.ts` |
| 11 | P2 | `pending-feerate-uses-serialized-size-not-vsize` | `crossWallet.ts` (+ `pending.ts` fallback) |
| 12 | P2 | `utxos-route-hardcoded-confirmation-threshold-default` | `api/transactions/utxos.ts` |
| 13 | P2 | `explorer-getstatus-rejects-legacy-testnet-network` | one normalization point in `src/api/bitcoin.ts` |
| 14 | P2 | `websocket-reconnect-counter-reset-defeats-backoff` | `services/websocket.ts` |
| 15 | P2 | `sync-refresh-superseded-reported-as-failure` | `useWalletDetailController.ts` / `useWalletData.ts` |
| 16 | P2 | `wallet-transaction-filters-survive-wallet-switch` | `useTransactionFilters.ts` — **sequenced after 15**: its new `ownershipKey` parameter changes the call site at `useWalletDetailController.ts:144`, the file Phase 15 edits |
| 17 | P2 | `draftlist-operation-error-dead-retry` | `useDraftListController.ts` |
| 18 | P2 | `device-list-load-failure-renders-empty-state` + `ai-feature-toggle-error-never-rendered` + `label-selector-create-failure-silent` | three one-line "error captured, never rendered" wirings; disjoint files |
| 19 | P2 | `add-parsed-accounts-silent-total-failure` | `useAddAccountFlow.ts` (port of the same file's USB guard) |
| 20 | P2 | `autopilot-load-failure-swallowed-then-overwrites` | autopilot controller — **separate** because the write-back fix changes `saveSettings`/`prevSettingsRef` semantics |
| 21 | P2 | `backup-complete-reminder-never-shows` | `BackupRestore.tsx` + `useBackupHandlers.ts` — needs an integration-level test |

Twenty-one PRs. Each phase below states the verified root cause, the contract, the
**failing-first test(s)**, verification, acceptance, and rollback.

---

## Phase 1 — P1: deleting a user must not strand the wallets only they own

Owner: `server/src/repositories/userAdminUpdate.ts`; `server/src/api/admin/users.ts` (error surface).
Tests: `server/tests/unit/repositories/userAdminUpdate.test.ts`, plus an admin-route contract.

**Root cause (verified):** `attemptAdminUserDelete` (`:79-95`) guards only the final-administrator
invariant, then `tx.user.delete`. `WalletUser.user` is `onDelete: Cascade`
(`schema.prisma:203`; `model WalletUser` starts at `:195` — line 99 is `GroupMember.user`, a
different model); `Wallet` has no owner/user column (only `groupRole` and
`syncExecutionOwner`, neither a user reference). Deleting the sole `owner`-role `WalletUser` of a
non-group wallet leaves it reachable by zero users with no admin surface to reattach one. In a
watch-only coordinator the wallet row *is* the record — descriptors, labels, history, UTXO state.

**Contract:** inside the existing serializable transaction, before `user.delete`, find wallets
where this user is the **only** `WalletUser` (any role) and the wallet has no `groupId`. If any
exist, **refuse** with a typed conflict listing the wallet ids, mirroring the final-admin guard
(`:88`). Do not auto-reassign or cascade-delete wallets — that is a product decision this plan
does not make. Group-owned wallets and wallets with other members are unaffected.

**Failing-first tests:** (a) sole-owner user → delete refused, the wallet's `WalletUser` row
survives, error names the wallet; (b) user who is one of two members → delete proceeds;
(c) sole member of a group wallet → proceeds; (d) the existing final-admin contracts unchanged;
(e) route contract: the refusal surfaces as a 409 with the wallet list.

Verification: `cd server && npx tsc --noEmit && npx vitest run tests/unit/repositories/userAdminUpdate.test.ts tests/unit/api/admin`, then `npx vitest run --coverage tests/unit`.
Acceptance: no path deletes a `User` whose removal would leave a non-group wallet with zero members.
Rollback: revert; no schema change.

## Phase 2 — P1 + P2: UsersGroups admin surface

Owner: `src/components/UsersGroups/CreateUserModal.tsx`, `useUsersGroupsController.ts`, `GroupPanel.tsx`.

**`create-user-modal-retains-password-after-success` (P1, verified):** the modal stays mounted
(`if (!isOpen) return null`, `:34`) so `useState` survives; `handleClose` resets on Cancel/X only;
the success path (`useUsersGroupsController.ts:88-95`) does `setShowCreateUser(false); loadData()`
with no reset. Reopening shows the previous user's username, email and **plaintext password**,
revealable via the eye toggle.
Contract: reset the form on **every** close, success included — simplest is keying the modal on
an `openCount`/`instanceKey` that increments on open so it remounts fresh, or calling the same
reset the Cancel path uses from the success path. Never retain a password across closes.
Failing-first test: submit a valid create → success closes → reopen → **all fields empty**
(currently stale).

**`group-create-enter-double-submit` (P2, verified):** `GroupPanel.tsx:45` `onKeyDown` Enter is
unguarded while the button (`:47`) is disabled on `isCreatingGroup`; the controller has no
reentrancy guard and `useLoadingState.execute` sets `loading` only after the async body starts.
Contract: guard the Enter path with the same condition as the button, **and** add a reentrancy
guard in `handleCreateGroup` so no entry point can double-submit.
Failing-first test: `fireEvent.keyDown` Enter twice without awaiting → `createGroup` called
**exactly once** (currently twice).

Verification: `npm run typecheck:app && npm run typecheck:tests && npm run test:run`, `npm run test:coverage`.
Rollback: revert.

## Phase 3 — P1: a saved draft is remembered so the next save updates it

Owner: `src/hooks/send/useDraftManagement.ts`, `src/contexts/send/` (reducer already has the case).
Tests: `tests/hooks/useDraftManagement.test.tsx`.

**Root cause (coordinator-verified):** `SET_DRAFT_ID` has **zero dispatch sites** — only the type
(`types.ts:167`) and reducer (`reducerParts/draft.ts:18`) exist. `createNewDraft` (`:186-212`)
returns `result.id` without storing it; `saveDraft` (`:276`) branches on `stateSnapshot.draftId`.
So `draftId` is never set after a create, and **every** second Save-as-Draft creates a new draft.
The partial-failure scenario originally filed is the easiest-to-hit subset.

**Contract:** dispatch `SET_DRAFT_ID` (`{ type: 'SET_DRAFT_ID', id }` — the action's field is `id`,
`types.ts:167`) with the new id immediately after a successful `createDraft` — **before** the
follow-up signed-state `updateDraft` — so a failure in that second call leaves the id adopted and
a retry updates rather than re-creates. Keep the lease check: dispatch only if `lease.isCurrent()`.

**Plumbing required (plan review):** `dispatch` is **not** in scope in `useDraftManagement`. Its
deps (`UseDraftManagementDeps`, `:226-236`) carry only `setIsSavingDraft`/`setError`, and its sole
caller `useSendTransactionActions.ts:242-260` has no `dispatch` either — it lives in
`SendTransactionContext.tsx:137` (`useReducer`), reached via `useSendTransaction()` in
`WizardContent` (`SendTransactionWizard.tsx:36`), two layers up. Thread a narrow
`setDraftId: (id: string) => void` callback (not the whole `dispatch`) from `WizardContent` →
`useSendTransactionActions` → `useDraftManagement`. This is new plumbing across three files, not
a one-line change.

**Failing-first tests:** (a) two `saveDraft` calls on one hook instance → second uses
`updateDraft`, not `createDraft` (currently creates twice); (b) `createDraft` succeeds,
`updateDraft` throws → `state.draftId` is set and a retry updates; (c) a lost lease between create
and dispatch does not adopt the id.

Verification: frontend typechecks + `test:run` + `test:coverage`.
Acceptance: after any successful create, `state.draftId` is the created id.
Rollback: revert.

## Phase 4 — P1: a broadcast in flight cannot be aborted by a signing control

Owner: `src/hooks/send/useSendOperationOwner.ts`, `src/hooks/send/useBroadcast.ts`, `src/components/send/steps/ReviewStep.tsx`.
**Sequenced after Phase 3** (same neighborhood; rebase after it merges).

**Root cause (verified):** `beginSigning()` (`useSendOperationOwner.ts:63`) and the broadcast lease
(`useBroadcast.ts:274` also calls `beginSigning()`) share **one** `signing` slot, and `begin()`
(`:41`) calls `abortSlot` unconditionally — so a signing click mid-broadcast aborts the broadcast's
lease after the server call already completed. `ReviewStep.tsx:201,219` pass `signing` but not
`broadcasting` to `SigningFlow`/`UsbSigning`, so the controls are enabled. Every post-await branch
in `useBroadcast` then short-circuits on `!lease.isCurrent()`, including the `finally` that resets
`isBroadcasting` (`:317`), and `navigationLocked` (`SendTransactionWizard.tsx:86`) keeps Cancel/Back
disabled.

**Contract:** two layers. (1) UI: pass `broadcasting` into the signing controls and disable them
while a broadcast is in flight. (2) Ownership: give the broadcast its own slot (`beginBroadcast`)
rather than borrowing `signing`, so a signing attempt cannot abort it; **or** make the broadcast
`finally` reset `isBroadcasting` unconditionally (a lost lease must still clear the spinner — the
success toast/navigation may stay gated, the stuck flag may not). Do both (1) and the
unconditional reset; the slot split is preferred if it stays small.

**Failing-first tests:** (a) `ReviewStep` with `broadcasting=true` → sign controls disabled;
(b) lease lost mid-broadcast → `isBroadcasting` ends `false`; (c) existing lease-loss contracts
(suppressed navigation) still hold.

Verification: frontend gates; render-regression unaffected (disabled state only on the in-flight path).
Rollback: revert.

**Status: done.** Implemented both layers as specified: `useSendOperationOwner.ts` gained a
`beginBroadcast` slot separate from `signing` (aborted independently, still cleared by
`invalidate()`); `useBroadcast.ts` takes `beginBroadcast` instead of `beginSigning` and its
`finally` now calls `setIsBroadcasting(false)` unconditionally (success/navigation stay gated on
`lease.isCurrent()`). `ReviewStep.tsx` now passes `signing || broadcasting` into `SigningFlow`'s
and `UsbSigning`'s existing `signing` prop (already a pure disable flag with no other display
effect), rather than threading a new prop through — the smallest change consistent with existing
props. No divergence: `npm run arch:check` passes on the rebased commit in the primary checkout
(an `arch:check` failure seen in the implementation worktree was that worktree's symlinked
`node_modules` resolving `shared/*` outside the checkout, not generator drift).

## Phase 5 — P2: send-max / subtract-fees honor the spendability filters

Owner: `server/src/repositories/utxoRepository.ts`, `server/src/services/bitcoin/transactions/utxoModes.ts`.

**Root cause (verified):** `findUnspent` (`:66-78`) has no `minConfirmations`/`excludeDraftLocked`
parameter at all; `selectUtxosForSendMax`/`SubtractFees` (`:78,140`) call it with only
`excludeFrozen`. Normal mode uses `findAvailableForSpending(..., { minConfirmations, excludeDraftLocked })`.
`draftCreate.lockSelectedUtxos` early-returns without `selectedUtxoIds`, so an unconstrained
send-max draft is never locked and two can race on one outpoint.

**Contract:** route send-max and subtract-fees through `findAvailableForSpending` with the same
confirmation threshold and `excludeDraftLocked: true` normal mode uses. Do not change locking
semantics in this phase.
**Failing-first tests:** seed an unconfirmed UTXO and a draft-locked UTXO; `selectUtxosForSendMax`
and `SubtractFees` exclude both (currently include both).
Verification: server gates + coverage. Rollback: revert.

**Status: done.** Extracted `resolveSpendableUtxos` into `utxoSelection.ts` (reads
`confirmationThreshold` via `systemSettingRepository.getParsed`, calls
`findAvailableForSpending(..., { minConfirmations, excludeDraftLocked: !hasCoinControl })`) and
reused it from `selectUTXOsExact`, `selectUTXOs`, and both send-max/subtract-fees in `utxoModes.ts`
— a fourth inline copy was how these modes drifted from normal mode in the first place, so this is
now the single source. `findUnspent` is still used elsewhere (`autopilot/utxoHealth.ts`,
`advancedTx/batch.ts`), so it was kept. Six non-regression tests added to
`transactionSelection.boundaries.test.ts` covering unconfirmed exclusion, draft-lock exclusion,
explicit coin-control override, and the operator confirmation threshold being read, for both
modes; all failed pre-fix and pass post-fix.

## Phase 6 — P2: the VACUUM timeout actually binds, restores the real default, and is tested in CI

Owner: `server/src/repositories/maintenanceRepository.ts`, `server/src/jobs/definitions/maintenance.ts`, `server/src/models/prisma.ts` (a pinned-client helper), `server/tests/integration/repositories/maintenanceStatementTimeout.test.ts`, `scripts/ci/backend-integration-groups.sh`, `.github/workflows/test.yml`.

**Root cause (verified):** `set_config(..., is_local=false)` is session-scoped but each
`$executeRaw` takes an independent PrismaPg pool connection (`prisma.ts:55-56`), so the timeout is
not guaranteed to reach the VACUUM; the `finally` resets to `'0'` (unlimited) rather than the
`30000` the worker `DATABASE_URL` sets. `weeklyVacuumJob` duplicates the repository logic inline.
The integration test hand-writes SQL, never calls the production path, and **never runs** because
it is assigned to no group: `backend-integration-groups.sh --check` exits 1 naming it.

**Correction from plan review — the guard IS wired, but path-scoped.** `--check` runs in CI via
`quality.yml:882` → `tests/ci/backend-integration-groups.test.sh:41`. It did not catch the
iteration-14 spec because that job (`CI classifier tests` / `Workflow policy guards`) was
**skipped** on PR #1065 — the job is gated on changed paths, and a PR that adds only an
integration spec does not trigger it. So the gate exists and is currently red at HEAD, but a
test-only change can slip past it. The earlier claim that "no workflow invokes `--check`" was
wrong (it searched workflow files for the script name and missed the indirection through the
test harness).

**Contract:** (1) one shared implementation, used by both the repository and the job, that
acquires a **dedicated `pg` client** (not the pool) for `set_config → VACUUM/REINDEX → restore`,
and restores the **configured** default — read from the `statement_timeout` query param of
`DATABASE_URL`, precedented at `prisma.ts:144` — not `'0'`.
**`pg` is not a declared dependency**: `server/package.json` has only `@prisma/adapter-pg`; `pg`
is a hoisted transitive. Add `pg` + `@types/pg` to `server/package.json` explicitly
(`npm install pg @types/pg --workspace=server`); the resulting `package-lock.json` diff needs
scrutiny in review and **will break `tests/ci/hardwareCompatibilityReport.test.ts`** — not
because it pins a hash literal (it does not), but because
`scripts/ci/hardware-compatibility-report.ts:375` computes `packageLockSha256` live and the test
asserts the freshly-built report equals the **checked-in generated artifacts**
`docs/reference/generated/hardware-wallet-compatibility.{json,md}`, which go stale. The fix is to
**regenerate those two artifacts in the same PR** via the report script's write path
(`hardware-compatibility-report.ts:531-536`), and the brief must say so.
(2) The integration test calls the shared function against real PostgreSQL and asserts the timeout
is observed *on the same backend pid* and the restored value equals the configured default.
(3) Add the spec to a group array in `scripts/ci/backend-integration-groups.sh` so the existing
`--check` passes. (4) Fix the scoping gap: the `CI classifier tests` job (`quality.yml:616`) is
gated solely on `needs.determine-scope.outputs.run_ci_classifier_tests` (`:620`), computed by the
literal case-pattern list `is_ci_classifier_file()` in `scripts/ci/classify-quality-scope.sh`.
That list already matches `scripts/ci/*` and `tests/ci/*`; the **sole** gap is
`server/tests/integration/**`. Add that one pattern (additively — the list is exercised by
`tests/ci/classify-quality-scope.test.sh`, so extend that test with the new case). Do **not** add
a duplicate `--check` step.
**Failing-first tests:** the rewritten integration spec (red today because the function does not
exist / the reset is `'0'`); a unit contract that `weeklyVacuumJob` delegates to the shared function.
Verification: `npm run test:integration tests/integration/repositories/maintenanceStatementTimeout.test.ts` from the root, `bash scripts/ci/backend-integration-groups.sh --check` exits 0, server gates.
Rollback: revert; no schema change.

**Status: done.** Landed as a single shared `runDedicatedMaintenance` helper in
`server/src/models/maintenanceConnection.ts` (a dedicated `pg` client for
`set_config → work → restore`, restoring the `statement_timeout` query param
of `DATABASE_URL` — `'0'` only when unset/unparsable), used by both
`maintenanceRepository.vacuumAnalyze`/`reindexHeavyTables` and
`weeklyVacuumJob`. `pg`/`@types/pg` were added explicitly to
`server/package.json` pinned to the versions already resolved as transitives
(`pg@8.22.0`, `@types/pg@8.15.6`), so the `package-lock.json` diff is 2 lines.
`docs/reference/generated/hardware-wallet-compatibility.{json,md}` were
regenerated in the same commit (only `packageLockSha256` changed).
`server/tests/integration/repositories/maintenanceStatementTimeout.test.ts`
was rewritten to call the shared function against real PostgreSQL and assert
same-backend-pid binding and configured-default restoration (including on
both a maintenance-work failure and a restore failure); a new unit suite
(`server/tests/unit/models/maintenanceConnection.test.ts`) covers
`resolveDefaultStatementTimeout` and `runDedicatedMaintenance`'s control flow
directly for coverage. A unit contract in
`server/tests/unit/jobs/maintenanceDefinitions.behavior.test.ts` asserts
`weeklyVacuumJob` delegates to `runDedicatedMaintenance`. The spec was added
to the `repositories-core` group in `backend-integration-groups.sh`,
confirmed red first (`Missing backend integration group assignments`) then
green. `is_ci_classifier_file()` in `classify-quality-scope.sh` gained one
additive `server/tests/integration/*` pattern, confirmed red first
(`expected run_ci_classifier_tests=true, got run_ci_classifier_tests=false`)
then green, with a new case in `classify-quality-scope.test.sh`.
Divergence from the plan: `vacuumAnalyze` and `reindexHeavyTables` each open
their own dedicated connection (the plan's "set_config → VACUUM/REINDEX →
restore" contract is per-repository-call), while `weeklyVacuumJob` wraps
VACUUM ANALYZE and its REINDEX loop in one shared connection/timeout window
— matching its pre-existing single-session behavior. One intentional
behavior change: a `statement_timeout` restore failure is contained by
`runDedicatedMaintenance` (logged at warn, the dedicated connection is
closed regardless) and no longer fails the job after the VACUUM/REINDEX
already succeeded; previously the restore lived in the job's outer
`finally`, so its failure escaped the job's `catch` unaudited. The unit
test's helper mock mirrors that containment so it cannot assert a contract
the helper does not have.

## Phase 7 — P2: route-specific body parsers match with a trailing slash

Owner: `server/src/middleware/bodyParsing.ts`.
**Root cause (verified):** `usesRouteSpecificJsonParser` keys on exact `req.path`; Express 5
routes `/restore/` to the same handler but the lookup misses, so the global 10 MB parser runs
first. Measured: `/admin/restore/` 413s a 12 MB backup on a 200 MB route; `/incident/` accepts
~10 MB on a 4 KB route.
**Contract:** normalize the lookup key (strip one trailing slash, except for `/`) — do not enable
strict routing globally. **Failing-first tests:** the four table routes with a trailing slash
return `true` (currently `false`); a supertest that `/admin/restore/` accepts an 11 MB body.
Verification: server gates. Rollback: revert.

**Status: done.** Added `normalizeRoutePath`/`toRouteKey` helpers in `bodyParsing.ts` and used
them in both `usesRouteSpecificLargeJsonParser` and `usesRouteSpecificJsonParser` (the only two
`req.path`-keyed lookups in the file). Non-regression tests confirmed failing pre-fix, then
passing; server gates (tsc, typecheck:tests, 100% unit coverage) and root gates (lint,
architecture boundaries, large-files, lizard at 86 warnings, `git diff --check`) all pass. During
implementation a second instance of the same defect class was found: Express also routes
case-insensitively (nothing in `server/src` sets `case sensitive routing`), so `POST
/API/V1/hardware/jade/pin` missed the lookup the same way a trailing slash did. Fixed in the same
phase by lower-casing the path inside `normalizeRoutePath` alongside the trailing-slash strip; no
other divergence from the plan.

## Phase 8 — P2: `minAmountSats` compares magnitude

Owner: `server/src/services/webhooks/subscriptions.ts`.
**Root cause (verified):** sync-discovered sent transactions carry **negative** amounts
(`historyTransactions.ts:234-247`) while the own-broadcast path notifies a positive amount; the
filter compares the signed value, silently dropping every sync-discovered outgoing payment.
**Contract:** compare the absolute value. **Failing-first test:** a sent event with
`amountSats: "-5000000"` against `minAmountSats: "100000"` passes (currently dropped).
Verification: server gates. Rollback: revert.

**Status: done.** `matchesEndpointFilters` now compares `|amountSats|` against `minAmountSats`
(bigint magnitude, existing inclusive boundary preserved). New tests in
`server/tests/unit/services/webhooks/webhookCore.test.ts` cover the negative-magnitude pass,
still-below-minimum drop, the `-100000` boundary, and unchanged positive-amount behavior.

## Phase 9 — P2: decoy change split never emits sub-dust outputs

Owner: `server/src/services/bitcoin/psbtBuilder/decoyAmounts.ts`.
**Root cause (verified, simulated):** the `floor(remaining/2)` override runs after the
`minPerOutput` clamp and is not re-clamped; at `1650/3/546` it produces `[559,545,546]`,
`[562,544,544]`. `outputBuilder` pushes them unchecked.
**Contract:** re-clamp after the override; if the remainder cannot satisfy `count × dust`, reduce
`count` rather than emit dust. **Failing-first test:** seeded `randomSource`, `generateDecoyAmounts(1650,3,546)`
→ `min >= 546` (currently fails); plus a property test over a range.
Verification: server gates. Rollback: revert.

**Status: done.** Replaced the unclamped `floor(remaining/2)` override with a per-step
reserve clamp (`amount ∈ [minPerOutput, remaining - minPerOutput × outputsAfterThis]`)
and a pre-loop count-reduction while-loop so a total that can't cover `count × dust`
shrinks the split instead of emitting sub-dust. Fixed `outputBuilder.ts`'s
`buildDecoyChangeOutputs` to iterate `amounts.length` instead of assuming
`length === numChangeOutputs`. New tests in `psbtBuilder.test.ts`: seeded
regression, a property-style sweep over totals/counts/dust, and a count-reduction
case. All server gates (typecheck, 100% unit coverage, lint, architecture
boundaries, lizard at 86 warnings) pass.

## Phase 10 — P2: Electrum `-1` means "no estimate"

Owner: `server/src/services/bitcoin/electrum/methods.ts`.
**Root cause (verified):** `-1 → Math.max(1, -100000) = 1`; the `{20,15,10,5}` fallback in
`networkOperations.ts` is never reached. **Contract:** treat a non-positive result as
no-estimate (throw / return `null`) so the caller's fallback engages. **Failing-first test:** mock
`requestFn` returning `-1` → no-estimate signalled, not `1`.
Verification: server gates. Rollback: revert.

**Status: done.** `estimateFee` now throws `ElectrumNoFeeEstimateError` (new in `types.ts`)
for any non-positive/non-finite result instead of clamping it to 1, so `getFeeEstimates`'s
existing catch returns the `{20,15,10,5}` fallback. Non-regression tests added at both the
Electrum-method level and the `networkOperations.getFeeEstimates` level; server coverage
gates pass at 100%.

**Follow-on (same phase):** that fix made the no-estimate path routine — thin-mempool and
regtest servers answer `-1` for far targets often — and both `getFeeEstimates`
(`networkOperations.ts`) and `getAdvancedFeeEstimates` (`advancedTx/feeEstimation.ts`) resolved
their per-target `client.estimateFee()` calls with `Promise.all`, so one missing target
discarded every other target's live estimate for the *entire* fallback schedule. Both now
resolve targets with `Promise.allSettled` and substitute only the missing tier's documented
fallback value (logged at `warn`, not `error`); a genuine non-`ElectrumNoFeeEstimateError`
failure (e.g. a transport error) still falls back to the full default schedule and keeps the
existing `error`-level log, unchanged. Fallback values were not changed. Non-regression tests
cover mixed near/far-target scenarios for both functions and assert the log level split;
server coverage gates pass at 100%.

## Phase 11 — P2: pending fee rate uses vsize

Owner: `server/src/api/transactions/crossWallet.ts` (primary), `walletTransactions/pending.ts` (fallback only).
**Root cause (verified, scope corrected):** `crossWallet.ts:299-301` divides by serialized bytes;
`pending.ts` already uses `weight/4` from mempool.space and only falls back to the byte division.
**Contract:** compute vsize from the raw tx (weight/4 via bitcoinjs) in both places; share one
helper. **Failing-first test:** a 1-in/2-out P2WPKH raw tx at 1410 sat fee → `feeRate ≈ 10`,
not `6.35`.
Verification: server gates. Rollback: revert.

**Status: done.** Added `server/src/services/bitcoin/transactionVsize.ts`
(`computeVirtualSizeFromRawTx`), a shared helper that authenticates raw hex
against its txid via `rawTransactionEvidence.ts`'s existing weight-preflight
parser and returns `Transaction.virtualSize()`. `crossWallet.ts` and
`walletTransactions/pending.ts` now both prefer this vsize and only fall back
to byte length/mempool.space weight when it is unavailable. Non-regression
tests added in `transactionVsize.test.ts`, `transactionsCrossWallet.test.ts`,
and `transactionsHttpRoutes.reads.contracts.ts`.

## Phase 12 — P2: the UTXO route uses the shared confirmation default

Owner: `server/src/api/transactions/utxos.ts`.
**Contract:** `getParsed(..., DEFAULT_CONFIRMATION_THRESHOLD)`. **Failing-first test:** no stored
setting, a 1-conf UTXO → `spendable: true` (currently `false`).
**Status: done.** Replaced the hard-coded `3` default with `DEFAULT_CONFIRMATION_THRESHOLD` from
`server/src/constants.ts`, matching `utxoSelection.ts`/`networkStatusService.ts`/
`createBatchTransaction.ts`; no other route/service had the divergent literal.

## Phase 13 — P2: legacy `testnet` normalized before `getStatus`

Owner: `src/api/bitcoin.ts` (single fix point); the three call sites drop their casts.
**Root cause (verified):** all three sites cast the raw `wallet.network` with
`as Parameters<typeof getStatus>[0]` — the cast PR #1067 added silences the very type error that
would catch `'testnet'`; `/bitcoin/status` 400s on it while `/bitcoin/fees` normalizes.
**Contract:** normalize inside `getStatus` via `normalizeLegacyNetworkType`, **and widen its
declared parameter type** — `getStatus(network: BitcoinStatusNetwork = 'mainnet')` where
`BitcoinStatusNetwork = Exclude<NetworkType, 'regtest'>` (`bitcoin.ts:124,206`) will not accept
the bare `string | null | undefined` the three call sites hold once their casts are removed; that
is a real `tsc` failure, not style. Accept `LegacyNetworkType | string | null | undefined` at the
boundary, normalize, then narrow (unknown → `'mainnet'`, matching the current default). Then
remove the three `as Parameters<typeof getStatus>[0]` casts.
**Failing-first test:** `useExplorerUrl('testnet')` → the request carries `testnet3`; same for the
other two sites; `getStatus(undefined)` still resolves to mainnet.
Verification: frontend gates; render-regression unaffected. Rollback: revert.

**Status: done.** `getStatus` now normalizes via `normalizeLegacyNetworkType` and accepts
`LegacyNetworkType | string | null | undefined`; the three `as Parameters<typeof getStatus>[0]`
casts are removed. All gates green (100% coverage, lizard at 86, typecheck/lint clean).

## Phase 14 — P2: reconnect backoff survives accept-then-close

Owner: `src/services/websocket.ts`.
**Root cause (verified):** `onopen` resets the counter, and the server's `close(1008)` fires
*after* the upgrade, so `onopen` always precedes `onclose` and backoff never engages.
**Contract:** reset the counter only after a connection has stayed open for a stable window (or
after the first message), not on `onopen`. **Failing-first test:** repeated open-then-close →
delay grows geometrically and the exhaustion branch is reachable (the existing test at `:674`
deliberately avoids `simulateOpen`).
**Existing test that must change (plan review):** `tests/services/websocket.test.ts:696-708`
`'should reset reconnect attempts on successful connection'` calls `simulateOpen()` then closes
again after only 2000 ms with no message and asserts the fast/reset backoff — it encodes the exact
behavior this fix removes and will go red. Rewrite it to hold the connection open past the stable
window (or deliver a message) before closing, then assert the reset; do not delete it.
Verification: frontend gates. Rollback: revert.

**Status: done.** Reset now gated on a `RECONNECT_STABLE_WINDOW_MS = 5000` stability timer
(started in `onopen`, cleared in `onclose`/`disconnect`, and short-circuited by the first
`onmessage`) instead of `onopen` itself. Existing test rewritten; new tests cover repeated
open-then-close reaching the exhaustion branch, window-based reset, and message-based reset.

## Phase 15 — P2: a superseded refresh is not a failure

Owner: `src/components/WalletDetail/useWalletDetailController.ts`, `useWalletData.ts`.
**Root cause (verified):** `fetchDataWithResult` returns `false` at every `!ownsRequest()`
checkpoint, which fires on supersession, and `refreshSyncStatus` throws on `false`.
**Contract:** distinguish superseded from failed — return a tri-state (`'ok' | 'superseded' | 'failed'`)
and only throw on `failed`. **Failing-first test:** supersession → no warning; a genuine rejection →
warning still raised.

**Status: done.** `fetchDataWithResult` now returns the exported `FetchDataResult` tri-state
(`walletDataTypes.ts`); `refreshSyncStatus` only throws on `'failed'`. New tests in
`tests/components/WalletDetail/hooks/useWalletData.supersession.test.ts` and a
`WalletDetailWrapper.states.contracts.tsx` case cover ok/superseded/failed end-to-end.

## Phase 16 — P2: transaction filters reset on wallet switch

Owner: `src/components/WalletDetail/hooks/useTransactionFilters.ts`.
**Contract:** accept `ownershipKey` and reset to `DEFAULT_FILTERS` when it changes, like every
sibling hook. **Failing-first test:** set a label filter, rerender with a new key → defaults.

**Status: done.** `useTransactionFilters` now takes `ownershipKey` and resets on change (mirrors
`useWalletMutations`'s `useLayoutEffect` idiom); `useWalletDetailController.ts` passes its existing
`ownershipKey`.

## Phase 17 — P2: Try-again clears an operation error

Owner: `src/components/DraftList/useDraftListController.ts`.
**Contract:** the retry path clears `operationError` too (or the two states collapse into one).
**Failing-first test:** reject `deleteDraft`, resolve `getDrafts`, click Try again → error cleared.

**Status: done** — `loadDrafts` now clears `operationError` before reloading, so the "Try again"
retry clears a lingering delete/upload error instead of leaving the banner stuck.

## Phase 18 — P2: three captured-but-unrendered errors

Owner: `useDeviceListRecords.ts` + `DeviceList.tsx`; `AISettings.tsx` + `StatusTab`; `useLabelSelectorController.ts` + its renderer.
**Contract:** thread the existing error state to the UI in each: DeviceList renders an error
state (not EmptyState) on load failure; StatusTab renders `toggle.saveError`; LabelSelector
exposes `createMutation.error` and renders it (mirror `useLabelManagerController.ts:95`).
**Failing-first tests:** one per site — reject the API call, assert an error renders (currently
nothing does).

**Status: done.** `DeviceList` now renders a rose-toned error state with a Retry button on load
failure instead of `EmptyState`; `StatusTab` renders `toggle.saveError`; `LabelSelector`'s
dropdown create form renders `createMutation.error` via the shared `ErrorAlert` component
(mirroring `useLabelManagerController.ts:95`). Six failing-first tests added across
`tests/components/DeviceList.test.tsx`, `tests/components/AISettingsSubcomponents.test.tsx`,
`tests/components/AISettings/AISettings.toggle.contracts.tsx`, and
`tests/components/LabelSelector.test.tsx`, all confirmed red before the fix.

## Phase 19 — P2: parsed-account import reports total failure

Owner: `src/components/DeviceDetail/accounts/hooks/useAddAccountFlow.ts`.
**Contract:** port the USB sibling's `addedCount === 0` guard (`:571-579`) to
`handleAddParsedAccounts`; on total failure set `addAccountError` and do not close. Partial
success reports the count. **Failing-first test:** every `addDeviceAccount` rejects → `onClose`
not called, error set (mirror the USB test at `branches.test.tsx:640`).

**Status: done.** Extracted a shared `concludeAccountAdditions` tail (renamed from an initial
`finalizeAccountAdditions` to avoid a false-positive match in the signer-inventory generator's
`finalize*` capability matcher) used by both the USB and parsed-account handlers.

## Phase 20 — P2: autopilot load failure is surfaced and never written back

Owner: `src/components/WalletDetail/WalletAutopilotSettings/useWalletAutopilotSettingsController.ts`.
**Contract:** any non-404/403 load failure sets an error, logs, and marks settings as
**unloaded** so `saveSettings` refuses to write while the baseline is unknown. Keep the existing
display fallback the current test pins. **Failing-first test:** reject the load with a plain
`Error`, trigger a toggle → `updateWalletAutopilotSettings` **not** called with defaults.

## Phase 21 — P2: the backup-complete reminder shows after a backup

Owner: `src/components/BackupRestore/BackupRestore.tsx`, `useBackupHandlers.ts`.
**Contract:** render the reminder on `showBackupCompleteModal` alone (it must not require
revealed keys — its purpose is to tell the admin to go reveal and save them), and clear the flag
on dismiss so it cannot pop later over the key display. **Failing-first test (integration-level,
`tests/components/BackupRestore.test.tsx`):** create a backup → reminder visible; dismiss; reveal
keys later → reminder does not reappear.

---

## Final verification (after all phases merge)

Backend: `cd server && npx tsc --noEmit && npx vitest run --coverage tests/unit`; integration lane
including the VACUUM spec; `bash scripts/ci/backend-integration-groups.sh --check`.
Frontend: `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run && npm run test:coverage`.
Both: `node scripts/quality/check-large-files.mjs`, lizard at 86, `npm run arch:check`, lint.
Render regression via the static-`dist/` harness for any phase that changes rendered output
(Phases 2, 4, 18, 19, 20, 21 add error/disabled states on failure paths only).

## Delivery, cleanup, deployment

One PR per phase via `$pr-delivery`; serial merges; branch deletion only after ancestry + a
zero-content-diff gate. `rebuild_policy: defer` per phase. At the clean pass, because
`containersRunningAtStart` is `true`, the final policy rebuilds the running stack via
`./start.sh --rebuild` — the coordinator confirms with the owner first, then verifies build
identity, health and readiness. Then a fresh full-scope scrub decides termination.

## Completion criteria

All 25 findings resolved with merged, CI-verified PRs and regression tests proven red against
`origin/main`; `--check` wired so an unassigned integration spec fails CI; P3 backlog preserved;
a fresh scrub at the resulting SHA with zero P0–P2 findings — or a clear statement of what remains.
