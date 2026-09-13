# Iteration 17 — P2 remediation plan

- Iteration: 17 (bug-scrub-loop run `bug-scrub-loop-20260912t210000z-p2-backlog`)
- Source target-branch SHA: `a6f753126a6666fcea0a758bec7c2206ec12c324` (main, after PR #1114)
- Scope: whole repository (server, gateway, frontend, shared, scripts/ci)
- Blocking findings (all P2, coordinator-reconfirmed at source):
  `batch-transaction-ignores-frozen-and-draftlocked-utxos`,
  `cpfp-transaction-ignores-frozen-and-draftlocked-parent-utxo`,
  `rbf-fee-delta-refusal-surfaces-as-500-not-400`,
  `vault-policy-specific-quorum-deadlock-after-roster-shrink`,
  `confirmation-refresh-lock-released-before-detached-writer-settles`,
  `push-provider-resolved-failure-silently-dropped`,
  `send-broadcast-lease-drop-silent-success`,
  `qr-signing-combine-failure-drops-prior-signatures`.
- P3 backlog (outside the blocking fix set, not planned here):
  `wallet-view-role-patches-own-notification-settings`,
  `integration-db-guard-sticky-optin-not-scoped-to-proven-url`, plus the 30 P3 items carried in run state.

## Goal, non-goals, assumptions

Goal: fix the eight P2 findings with a failing regression test per finding, in seven independently mergeable phases, without schema migrations and without changing release gates.

Non-goals: no product-policy changes (frozen/draft-lock semantics stay as documented in `schema.prisma:690`), no new tables or migrations (the release replay gate pins the migration tree to the immutable RC10 image; see the Phase 4 note in the iteration-16 plan), no refactor of the send wizard beyond the two named hooks, no P3 work.

Assumptions: main stays green (verified locally on `a6f75312`: backend 15931, frontend 8569, gateway 571, all gates, 100% coverage); repository rules apply (tests-first; no `catch (error: any)`, `console.log`, `@ts-ignore`, empty catch; backend coverage scoped to `tests/unit`; lizard exactly 86; `check-large-files.mjs` 1000-line limit; `arch:check` output committed; server `typecheck:tests`; wallet-safety mutation map line pins for `server/src/services/bitcoin/**` files must be re-pinned and re-proven with the fee-policy stryker profile + `check-wallet-safety-mutation-map.mjs` whenever lines shift in pinned files).

## Phase 1 — batch and CPFP honour frozen and draft-locked UTXOs (server)

Findings: `batch-transaction-ignores-frozen-and-draftlocked-utxos`, `cpfp-transaction-ignores-frozen-and-draftlocked-parent-utxo` (same boundary: `server/src/services/bitcoin/advancedTx/`).

Evidence: `batch.ts:59` calls `utxoRepository.findUnspent(walletId)` with no options, so `where.frozen` is unset and `draftLock` is never filtered; `cpfp.ts:102-110` checks only `utxo.spent` on the parent output from `findByOutpoint`. Every other send path excludes frozen coins (`utxoSelection.ts:346` `{ excludeFrozen: true }`; `findAvailableForSpending` also sets `draftLock = null`).

Contract:
- Batch auto-selection uses the same spendability set as normal sends: exclude `frozen` and draft-locked UTXOs. `utxoRepository.findUnspent` only has an `excludeFrozen` option (`utxoRepository.ts:66-78`) — it has no `excludeDraftLocked`; that option lives on the separate `findAvailableForSpending` query (`utxoRepository.ts:354-380`, unconditionally excludes `frozen` and optionally sets `draftLock: null`). Switch `batch.ts` from `findUnspent(walletId)` to `findAvailableForSpending(walletId, { excludeDraftLocked: true })`, mirroring the already-safe sibling implementation `server/src/services/bitcoin/transactions/createBatchTransaction.ts:276` (used by the drafting route, see Files note below). When `selectedUtxoIds` are supplied, keep `assertExactUtxoSelection` semantics but reject a frozen or draft-locked selection with a clear error. Do not model this on `selectUTXOsExact`/`resolveSpendableUtxos` (`utxoSelection.ts:124-135`): that helper deliberately sets `excludeDraftLocked: false` when `selectedUtxoIds` is supplied, i.e. it *allows* pinning a coin locked by the caller's own in-progress draft — a draft-editing affordance that only makes sense for the drafting-route flow, which carries draft context. The advancedTx batch/CPFP endpoints take no `draftId` at all (see the CPFP note above), so there is no "my own draft" to exempt; always reject a draft-locked pinned selection here regardless of which draft holds the lock.
- CPFP refuses a parent output that is `frozen` or has any existing draft lock. `createCPFPTransaction` (`cpfp.ts:75`) has exactly one caller (`server/src/api/bitcoin/transactions.ts:225`) and takes no `draftId` — there is no "caller's own draft" to exempt, so the earlier "locked by a draft other than the caller's own" framing does not apply here: refuse on *any* lock via `draftLockRepository.findByUtxoId(utxo.id)` returning non-null, with explicit error text ("UTXO is frozen" / "UTXO is locked by a pending draft").

Files: `server/src/services/bitcoin/advancedTx/batch.ts`, `cpfp.ts` (both already pinned in `config/wallet-safety-mutation-map.json`'s `serverFeePolicy` profile, along with `utxoSelection.ts` and `transactions/createBatchTransaction.ts` — re-pin whichever files' lines actually shift). No `utxoRepository.ts` change needed: `findAvailableForSpending` already exists with the required options.

Callers — verified, and note the two `createBatchTransaction` implementations are distinct: `server/src/api/bitcoin/transactions.ts:225` calls `advancedTx.createCPFPTransaction` (the vulnerable CPFP path); `transactions.ts:279` calls `advancedTx.createBatchTransaction` from `advancedTx/batch.ts` (the vulnerable batch path — this is the only route this phase must fix). `server/src/api/transactions/drafting.ts:206` calls a *different*, already draft-lock-aware function, `txService.createBatchTransaction` from `services/bitcoin/transactions/createBatchTransaction.ts` (uses `findAvailableForSpending` already) — it is not a caller of the buggy code and does not need touching.

Failing tests first: `server/tests/unit/services/bitcoin/advancedTx/` batch contracts — wallet with one frozen UTXO that alone covers the amount and one small unfrozen UTXO → expect "Insufficient funds"/no-spendable error rather than a PSBT spending the frozen coin; draft-locked variant; CPFP contracts — parent output `frozen: true` → throws; parent output with a foreign draft lock → throws. Prove red against `origin/main`.

Verification: server tsc, `typecheck:tests`, lint, `check:architecture-boundaries`, unit coverage 100% on `tests/unit`, lizard 86, large-files, `arch:check`, `git diff --check`; if `batch.ts`/`cpfp.ts` are pinned in `config/wallet-safety-mutation-map.json`, re-pin and run the fee-policy stryker profile + `node scripts/ci/check-wallet-safety-mutation-map.mjs`.

Acceptance: both new tests red on main and green on the branch; no other send-path behaviour changes.

Status: done. `batch.ts` switched from `utxoRepository.findUnspent(walletId)` to `utxoRepository.findAvailableForSpending(walletId, { excludeDraftLocked: true })` (unconditionally, since the advancedTx endpoints carry no draftId to exempt); a pinned selection naming a frozen or draft-locked outpoint is now rejected by the existing `assertExactUtxoSelection` "Selected UTXOs are unavailable" path, since it no longer appears in the filtered set. `cpfp.ts` gained explicit `utxo.frozen` and `draftLockRepository.findByUtxoId(utxo.id)` checks on the parent output, throwing "UTXO is frozen" / "UTXO is locked by a pending draft". Six new tests added (4 batch, 2 CPFP) in `server/tests/unit/services/bitcoin/advancedTx/advancedTx.batch-fees.contracts.ts` and `advancedTx.cpfp.contracts.ts`, proven red against `origin/main` (all 6 failed — the batch tests showed the buggy code constructing a valid PSBT that spent the frozen/locked coin instead of rejecting it; the CPFP tests showed `createCPFPTransaction` resolving instead of throwing) and green on the fix (76/76 in `advancedTx.test.ts`). `config/wallet-safety-mutation-map.json`'s `advanced-batch-change-and-fee-selection` invariant and its two canaries were re-pinned from lines 111/127/130 to 115/131/134 (the fix added 4 lines before the selection loop); `cpfp.ts`'s pinned block (lines 53-61) was unaffected since the fix lands below it. `serverFeePolicy` stryker profile (`cd server && npm run test:mutation:fee-policy`): `batch.ts` 97.37% (37/38 killed, 1 pre-existing unrelated survivor outside the touched lines), `cpfp.ts` 100.00% (8/8), both above their 75-point file floors; overall profile 90.63% (break threshold 75). `node scripts/ci/check-wallet-safety-mutation-map.mjs` requires all six mutation profiles' reports (CI runs them together in one job); only `serverFeePolicy` was regenerated here, so the full script was validated in isolation by importing its own `validateMutationEvidence` function against just the `serverFeePolicy` profile and the fresh report — passed ("wallet-safety mutation map invariants are complete and non-vacuous"). Gates: server `tsc --noEmit` and `typecheck:tests` clean; root `npm run lint` clean; `check:architecture-boundaries` passed (2417 files, 13 rules); `check-large-files.mjs` passed; `lizard-only.sh` exactly 86 warnings; `git diff --check` clean; full `server` unit suite 694 files / 15937 tests passed.

## Phase 2 — RBF fee-not-raised refusal is a 400 (server)

Status: done

Finding: `rbf-fee-delta-refusal-surfaces-as-500-not-400`.

Evidence: `rbf.ts:352-355` throws a plain `Error`; the route (`transactions.ts:169`) is wrapped only by `asyncHandler`; `errorHandler.ts` maps non-`ApiError` to 500; `bitcoin.transaction.contracts.ts:262-277` documents the 500 fallthrough.

Contract: throw `InvalidInputError` (from `server/src/errors/ApiError`) with the same message and field `newFeeRate` so the API answers 400 `INVALID_INPUT`. Keep the message text pinned by the existing `advancedTx.rbf-creation.contracts.ts` tests. Do not widen to other advancedTx errors in this phase.

Failing tests first: route-level supertest in `server/tests/unit/api/bitcoin/bitcoin.transaction.contracts.ts` letting `createRBFTransaction` reject with the real `InvalidInputError` and asserting 400 + `INVALID_INPUT`; service-level assertion that the thrown error is an `InvalidInputError` (`toBeInstanceOf`).

Verification: as Phase 1 (rbf.ts is pinned in the wallet-safety mutation map: re-pin line numbers, run the fee-policy stryker profile and the map checker).

## Phase 3 — 'specific' quorum resolves against the live policy (server)

Status: done

Finding: `vault-policy-specific-quorum-deadlock-after-roster-shrink`.

Evidence: `approvalService.ts:452-459` compares eligible votes to `request.requiredApprovals` (snapshotted at creation); `checkAllQuorumMet` (:424-444) derives its count live; `vaultPolicyService.ts:400-405` validates only the new config.

Contract: `checkSpecificQuorumMet` reads the live policy config once (`loadSpecificApprovers` already loads it; extend it to return `{ specificApprovers, requiredApprovals }`) and compares eligible votes against `Math.min(live.requiredApprovals, specificApprovers.length)` — the *live* threshold, not `request.requiredApprovals`.

Rejected alternative and why: an earlier draft of this plan used `min(request.requiredApprovals, live.requiredApprovals)`. Verified against `vaultPolicyService.ts:391-405`, `validateApprovalRequiredConfig` already enforces `requiredApprovals <= specificApprovers.length` on every policy write while `quorumType === 'specific'`, so the live values alone can never demand more votes than the live roster has — the `min` with the *request's* stale snapshot was solving a problem (over-demanding) that the live values don't have, while introducing a real one: when a policy is tightened (e.g. `requiredApprovals` raised from 3 to 4 with the same roster), `min(3, 4) = 3` would let an in-flight request resolve with fewer approvals than the live policy currently requires — a security weakening. The only comparable precedent in this file, `checkAllQuorumMet`/`'all'` quorum, does the opposite: it always re-derives the required count from live membership (`checkAndResolveRequest`'s inline comment on `'all'`), so a membership *increase* after creation does retroactively demand more votes. There is no existing "snapshot protects against tightening" semantics to match. The kept rule (`min(live.requiredApprovals, specificApprovers.length)`) fixes the roster-shrink deadlock (bounds the requirement to however many eligible approvers remain) without ever letting a request resolve on fewer votes than the live policy demands. Document this precedence, and the rejected alternative's failure mode, in the function comment.

Failing tests first: `server/tests/unit/services/approvalService/approvalService.quorum-membership.contracts.ts` — request created under `[A,B,C,D]/3`, A votes, policy edited to `[A,B]/2`, B votes → request resolves `approved` (today stays pending); separately, request created under `[A,B,C,D]/3`, A/B/C vote (3 of 3, would resolve today) but the policy is edited to raise `requiredApprovals` to 4 with the same roster before resolution runs → request stays `pending` (needs a 4th vote) rather than resolving on the stale count of 3.

Verification: as Phase 1 (no bitcoin pins).

## Phase 4 — confirmation refresh keeps the lock until the writer settles (server)

Status: done

Finding: `confirmation-refresh-lock-released-before-detached-writer-settles`.

Evidence: `confirmationUpdater.ts:318-382` `awaitExecutionSettlement` defaults to false and `refreshWalletConfirmations` (:373-381) omits it; `refreshWalletConfirmationsAtHeight` (:384-402) passes `signal, true`.

Contract: `refreshWalletConfirmations` passes `awaitExecutionSettlement = true` (via `runSettledSyncAttemptWithTimeout`) so `lease.release()` in `finally` runs only after the executor has settled; the timeout error is still surfaced as `ConfirmationRefreshError`. Keep `SYNC_ABORT_GRACE_MS` semantics for the settled variant as already implemented in `syncAttemptLifecycle.ts`.

Failing tests first: `server/tests/unit/services/sync/confirmationUpdater*.test.ts` — fake executor ignoring its signal and resolving after `maxSyncDurationMs + grace`; assert `lease.release` is not called before the executor promise settles (spy ordering), and the result/error shape is unchanged.

Verification: as Phase 3.

## Phase 5 — resolved push failures are recorded (server)

Finding: `push-provider-resolved-failure-silently-dropped`.

Evidence: `pushService.ts:159-173` has no `else` for `result.success === false` that is not an invalid-token error; the `catch` (:174) records thrown errors.

Contract: add the missing branch: `log.error` with platform, `errorCode` and `error`, and record the failure through the same path the thrown-error branch uses (dead-letter / failure recording helper in this file). Invalid-token handling is unchanged. No retry semantics change.

Failing tests first: `server/tests/unit/services/push/pushService*.test.ts` — stub provider whose `send` resolves `{ success:false, errorCode:'provider_rate_limited', error:'rate limited' }`; assert the failure is recorded/logged and the device is not deleted.

Verification: as Phase 3.

Status: done

## Phase 6 — a completed broadcast always reports and refreshes (frontend)

Finding: `send-broadcast-lease-drop-silent-success`.

Evidence: `useBroadcast.ts:289-309` gates the success branch on `lease.isCurrent()`; the HTTP call carries no signal; `useSendOperationOwner.ts` aborts the broadcasting slot on unmount.

Contract: once `transactionsApi.broadcastTransaction` resolves, always show the success or reconciliation toast and run `refetchBroadcastCaches()` (the notification and query-client handles are app-scoped, not component-scoped); only the `navigate()` and any component-local state updates remain gated on `lease.isCurrent()`. Error branch semantics stay as they are for a lost lease (no stale error state on an unmounted wizard).

Failing tests first: `tests/hooks/useBroadcast.test.tsx` (verified path — not `tests/hooks/send/`, which does not exist) — resolve the broadcast after `owner.invalidate()`; assert `showSuccess`/`showBroadcastReconciliationWarning` and the cache refetch are invoked and `navigate` is not.

Verification: typecheck app/tests/all, lint, frontend coverage 100%, lizard 86, large-files, `arch:check`, `git diff --check`.

Status: done

## Phase 7 — a PSBT combine failure never discards collected signatures (frontend)

Finding: `qr-signing-combine-failure-drops-prior-signatures`.

Evidence: `useQrSigning.ts:174-206` and `:208-235` return the newest PSBT from the `catch`; callers (:281-307, :403-422) then `setUnsignedPsbt` and `markSignedDevice` unconditionally.

Contract: on combine failure, surface an error (`setError` with a message naming the device/file and that the PSBT does not match the transaction being signed), keep the stored PSBT and `signedDevices` unchanged, and do not mark the device signed. The helpers return a discriminated result (`{ ok: true, psbt } | { ok: false, reason }`) instead of a bare string so callers cannot ignore the failure.

Failing tests first: `tests/hooks/useQrSigning.test.tsx` (verified path — not `tests/hooks/send/`, which does not exist) — stored PSBT for transaction X with one signature, upload/scan a signed PSBT for transaction Y so `Psbt.combine()` throws; assert an error is shown, `unsignedPsbt` still equals X's PSBT, and `signedDevices` is unchanged.

Verification: as Phase 6.

## Delivery

One PR per phase, serial merges on `main` (`block_on_outdated_branch`), each rebased only when it is next; target-branch CI verified after each merge; branches deleted only after the merge-commit ancestry gate. PR order: 1, 2, 3, 4, 5, 6, 7 (server phases first so the pinned-file re-pins land before frontend work). No container rebuild until the loop's clean pass (`--deploy final`).

## Completion criteria

All eight findings resolved in run state with a target-CI-verified attempt record; a fresh full scrub (iteration 18) of the resulting main SHA finds zero P0–P2.

## Review notes

Recursive plan review, 3 passes, no actionable comments remaining after pass 3.

Accepted (applied):
- Phase 1: corrected a factual error — `findUnspent` has no `excludeDraftLocked` option (only `excludeFrozen`); that option belongs to the separate `findAvailableForSpending` query. Switched the directive to use `findAvailableForSpending`, matching the already-safe sibling `transactions/createBatchTransaction.ts`.
- Phase 1: corrected the CPFP contract — `createCPFPTransaction` has one caller and no `draftId`, so "locked by a draft other than the caller's own" was unimplementable; simplified to refuse any existing lock.
- Phase 1: corrected the "Callers" list — `drafting.ts:206` calls a distinct, already-safe `createBatchTransaction` implementation, not the vulnerable `advancedTx/batch.ts` one; removed it as a caller needing a fix, and disambiguated the two same-named functions.
- Phase 1: removed a misleading "mirror `selectUTXOsExact`" citation — that helper intentionally *allows* pinning a draft-locked coin for the drafting-route's own-draft editing flow, which is the opposite of what Phase 1 needs for the draft-less advancedTx endpoints.
- Phase 3 (the mandated scrutiny target): replaced the unsafe `min(request.requiredApprovals, live.requiredApprovals)` rule with `min(live.requiredApprovals, specificApprovers.length)`. Verified `vaultPolicyService.ts` already bounds live `requiredApprovals` to the live roster size on every write, so the rejected rule's only effect was to let a tightened policy resolve on the stale, lower snapshot — fewer votes than the live policy currently demands. Updated the second test scenario to match (tightening now leaves the request pending, not resolved).
- Phase 6 and 7: corrected the failing-test file paths from a nonexistent `tests/hooks/send/` directory to the verified existing paths `tests/hooks/useBroadcast.test.tsx` and `tests/hooks/useQrSigning.test.tsx`.

Rejected/deferred:
- Flagged but not acted on: `getSpendableUTXOs` (`utxoSelection.ts:346`, used for sendMax balance calculations) excludes frozen but not draft-locked UTXOs. This is a real gap but belongs to a different (non-listed) finding — out of this plan's fixed scope of eight named P2s — and touching it would be scope creep. Worth a follow-up scrub item, not a plan edit here.
- No other stale line citations, missing files, or unverifiable claims found in Phases 2, 4, 5; their evidence (route wrapping/500 fallthrough, `awaitExecutionSettlement` default, `pushService.ts` missing branch) and named test files were all confirmed against source.

Verification performed: `rg`/`grep` and focused `Read`s against every evidence citation and named function/option/file/test path in all seven phases; `git -C /home/nekoguntai/sanctuary-wt-i17-plan diff --check` clean; no other files touched.
