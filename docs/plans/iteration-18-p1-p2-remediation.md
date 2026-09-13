# Iteration 18 — P1/P2 remediation plan

- Iteration: 18 (bug-scrub-loop run `bug-scrub-loop-20260912t210000z-p2-backlog`)
- Source target-branch SHA: `fb6b008c4661a37789fb53df586fc470cfbc57c1` (main, after PR #1122)
- Scope: whole repository
- Blocking findings (coordinator-reconfirmed at source):
  P1 `time-delay-policy-config-cast-breaks-draft-creation`;
  P2 `sync-routes-view-role-triggers-destructive-resync`,
  `cpfp-batch-user-input-errors-surface-as-500-not-400`,
  `usb-signing-disconnect-skipped-on-superseded-lease`,
  `rbf-memo-prefix-spoofs-transaction-replacement`,
  `dead-letter-oversized-entry-write-rejected-and-relost-forever`,
  `notification-channel-partial-failure-marked-job-completed`.
- P3 backlog (outside the blocking fix set; only `batch-stryker-fee-policy-mutate-range-stale-after-1121` is folded into Phase 3 because it lives in the same pinned files):
  `llm-egress-ai-rate-limit-shared-single-bucket`, `wallet-transaction-amount-noninteger-crashes-bigint`, `batch-transaction-outputs-array-unbounded`, `push-service-recordpushfailure-throw-masks-original-error`, plus the 32 P3 items carried in run state.

## Goal, non-goals, assumptions

Goal: fix the seven blocking findings with a failing regression test per finding, in seven independently mergeable phases, without schema migrations.

Non-goals: implementing the time-delay cooling-period feature end to end (no `vetoDeadline` flow exists today; Phase 1 only stops the policy from breaking draft creation and records the gap); per-user AI rate limiting; changing the notification job retry model to retry already-delivered channels.

Assumptions: main is green (verified locally on `fb6b008c`: backend 15948, frontend 8574, gateway 571, 100% coverage, all gates); repository rules apply (tests-first; no `catch (error: any)`, `console.log`, `@ts-ignore`, empty catch; backend coverage scoped to `tests/unit`; lizard exactly 86; `check-large-files.mjs`; `arch:check` output committed; server `typecheck:tests`; `prisma.*` only in repositories; no new migrations — the release replay gate pins the migration tree). Wallet-safety mutation-map pins for `server/src/services/bitcoin/**` must be re-pinned and re-proven (fee-policy stryker profile + `check-wallet-safety-mutation-map.mjs`) whenever lines shift in pinned files, and `server/stryker.fee-policy.config.mjs` mutate ranges must be realigned with the pins.

## Phase 1 — time-delay policies never masquerade as approval quorums (server, P1)

Finding: `time-delay-policy-config-cast-breaks-draft-creation`.

Evidence: `policyEvaluationEngine.ts:224-242` labels a triggered `time_delay` policy with action `'approval_required'` unless enforcement is `monitor`; `approvalService.ts:65` selects triggered policies by action only, `:79` casts the config to `ApprovalRequiredConfig`, `:93-104` reads `config.requiredApprovals` (undefined for `TimeDelayConfig`) and `policyRepository.createApprovalRequest` fails on the non-nullable `requiredApprovals` (`schema.prisma:1715`); `draftCreate.ts:222` calls it on every draft, so an enforced time-delay policy blocks all drafts on the wallet.

Contract:
- `applyTimeDelayPolicy` labels the trigger with a dedicated action (`'time_delay'`, added to the triggered-policy action union) when enforced, `'monitored'` when monitor; it never emits `'approval_required'`.
- `createApprovalRequestsForDraft` selects only triggered policies whose policy `type === 'approval_required'` (belt and braces with the action), so no other config shape can reach the `ApprovalRequiredConfig` cast; add a narrow type guard instead of the unchecked cast.
- Draft creation with an enforced time-delay policy succeeds; the evaluation result still lists the time-delay policy for the UI. Record in the plan that the cooling-period/veto flow is unimplemented (product gap, not fixed here) and add a P3 backlog note in run state.
- Any consumer that switches on the action union (UI types under `shared/`, API responses) must accept the new value; check `shared/` types and `src/` consumers with `rg "approval_required"` and add exhaustive-switch handling where needed.

Failing tests first: `server/tests/unit/services/policyEvaluationEngine.test.ts` (enforced time-delay → action `'time_delay'`, not `'approval_required'`; note there is no `services/vaultPolicy/` test directory — `vaultPolicyService.test.ts` is the unrelated policy-CRUD suite); `server/tests/unit/services/approvalService.test.ts` (a triggered time-delay policy creates no approval request; an approval-required policy still does); `draftCreate` unit test or existing draft-creation contract: draft succeeds with an enforced time-delay policy (today: throws from Prisma validation). Prove red against `origin/main`.

Verification: server tsc, `typecheck:tests`, lint, `check:architecture-boundaries`, unit coverage 100% on `tests/unit`, lizard 86, large-files, `arch:check`, `git diff --check`; frontend typecheck if a shared type changes.

Status: done. Implemented in worktree `/home/nekoguntai/sanctuary-wt-i18-phase1` on branch `codex/bug-scrub-loop/i18-phase1`.
- `server/src/services/vaultPolicy/types.ts`: added `'time_delay'` to the triggered-policy `action` union.
- `server/src/services/vaultPolicy/policyEvaluationEngine.ts`: `applyTimeDelayPolicy` now labels an enforced time-delay trigger `'time_delay'` (was `'approval_required'`); monitor mode still emits `'monitored'`.
- `server/src/services/vaultPolicy/approvalService.ts`: `createApprovalRequestsForDraft` now filters triggered policies on both `action === 'approval_required'` and `type === 'approval_required'`, and replaced the unchecked `config as unknown as ApprovalRequiredConfig` cast with a narrow `isApprovalRequiredConfig` type guard. On review feedback, a non-conforming config now fails closed — throws `InvalidInputError('Approval-required policy has an invalid configuration', 'policyId', { policyId })` (4xx, aborts draft creation) instead of logging and skipping, since skipping would silently let the draft through with no approval request for the exact policy meant to enforce one.
- No `shared/`/`src/` consumers switch on the action union (`rg "approval_required"` returns zero hits there), confirmed unchanged, matching the plan's rejected/deferred note.
- Failing tests written first and proven red against pre-fix source, then fixed to green:
  - `server/tests/unit/services/policyEvaluationEngine/evaluate.controls-timing.contracts.ts` — two assertions changed from `'approval_required'` to `'time_delay'`.
  - `server/tests/unit/services/approvalService/approvalService.create.contracts.ts` — three new tests: a mislabeled time-delay trigger creates no approval request; a genuine approval-required trigger alongside a non-triggering time-delay type still creates one; an approval-required policy config missing `requiredApprovals` rejects with the `InvalidInputError` (400, `details.policyId`) and creates nothing (`createApprovalRequest` and `updateApprovalStatus` never called).
  - `server/tests/unit/services/draftCreate.test.ts` — new test: an enforced time-delay-only trigger (`action: 'time_delay'`) lets `createDraft` succeed with `approvalService.createApprovalRequestsForDraft` never called and `approvalStatus` left `undefined`. Proven red by temporarily substituting `action: 'approval_required'` (origin/main's actual engine output for this case), which fails the `not.toHaveBeenCalled()` assertion; reverted to `'time_delay'` for the passing test.
  - All source-restore/red proofs used `git show origin/main:<path> > <path>` then reapplied the fix from a saved copy, per the no-stash/no-checkout rule.
- Gates rerun after the review changes and passing: `server` `tsc --noEmit`, `typecheck:tests`; root `lint`, `check:architecture-boundaries`, `check-large-files.mjs`, `lizard-only.sh` (exactly 86 warnings), `git diff --check`; targeted vitest for all three touched test files (`policyEvaluationEngine.test.ts` 82, `approvalService.test.ts` 78, `draftCreate.test.ts` 13) — 173 passed. No `shared/` changes, so frontend typecheck was not required.

## Phase 2 — destructive sync routes require edit access (server)

Finding: `sync-routes-view-role-triggers-destructive-resync`.

Evidence: `server/src/api/sync.ts:100-117` (`/reset/:walletId`, `/resync/:walletId`) and the sync-trigger routes rely on `syncCoordinator.requireWalletAccess` (`:176-182`, `findByIdWithAccess`, any role). `server/src/api/transactions/walletTransactions/recalculate.ts` requires `requireWalletAccess('edit')` since #1100. `server/src/services/sync/syncCoordinator.ts:483-523` (`resyncNetwork`) and `server/src/repositories/walletRepository.ts:149-176` (`findByNetworkWithSyncStatus`, role-blind `buildWalletAccessWhere`) show `/network/:network/resync` shares the identical gap.

Contract: `/reset/:walletId` and `/resync/:walletId` use the route middleware `requireWalletAccess('edit')` (imported from `server/src/middleware/walletAccess`, the same middleware `recalculate.ts` uses — distinct from `syncCoordinator`'s private, role-blind `requireWalletAccess(walletId, userId)` helper at `:176-182`, which stays as defense-in-depth); the non-destructive `/wallet/:walletId` and `/queue/:walletId` sync triggers stay at any-access (they read chain state, they do not clear it) — state this explicitly in the route comments. `/user` batch route is unchanged (it only queues incremental syncs, not full resyncs).

**`/network/:network/resync` has the same bug and must be fixed in this phase too.** It calls `resyncNetwork` → `requestFullResyncBatch` → `syncIntentAdmission.requestFullResync`, the identical destructive full-resync primitive `resyncWallet` uses for the single-wallet route. Its wallet set comes from `walletRepository.findByNetworkWithSyncStatus(userId, network)`, which filters with `buildWalletAccessWhere(userId)` (`server/src/repositories/accessControl.ts`) — membership only, no role check — so a viewer on a shared wallet can trigger a full destructive resync of it via this route today, exactly the vulnerability Phase 2 exists to close. Filter `resyncNetwork`'s wallet set to edit-or-above role before admitting full resync (there is a precedent for a role-filtered wallet query at `walletRepository.findByIdWithEditAccess`, `:399-412`); skip non-edit wallets the way the existing `excludedWallets`/`exclusionClause` pattern already reports skipped wallets, rather than silently dropping them. `/network/:network` (non-resync, queue-only) stays unchanged, same reasoning as `/wallet` and `/queue`.

Failing tests first: route contract tests for `sync.ts` (viewer-role user → 403 on reset and resync; editor/owner → 200; viewer still 200 on the plain sync trigger); a `resyncNetwork`/`syncCoordinator` unit test asserting a viewer-only wallet is excluded from a network resync while an edit-or-above wallet on the same network is admitted. Prove red against `origin/main`.

Verification: as Phase 1.

Status: done. `requireWalletAccess('edit')` added to `POST /sync/reset/:walletId` and `POST /sync/resync/:walletId` in `server/src/api/sync.ts`; route comments added explaining why `/wallet`, `/queue`, and `/network/:network` (non-resync) stay at any-access. `syncCoordinator.resyncNetwork` now scopes its wallet batch to edit-or-above access via new `walletRepository.findNetworkWalletIdsWithEditAccess` (backed by a new `buildWalletEditAccessWhere` helper in `server/src/repositories/accessControl.ts`, parallel to `buildWalletAccessWhere`); view-only wallets are reported in `excludedWallets` with reason `edit_access_required` alongside the existing `network_not_syncable` reason, combined in one message. Failing tests written first and proven red against `origin/main` (`server/tests/unit/api/sync.editAccess.test.ts` — new file, split out of `sync.test.ts` to stay under the large-files line cap; `server/tests/unit/services/sync/syncCoordinator.test.ts`; `server/tests/unit/repositories/walletRepository.test.ts`; `server/tests/unit/repositories/accessControl.repository.test.ts`), then implemented and reproven green. All gates pass: server `tsc --noEmit` and `typecheck:tests`, root `lint`, `check:architecture-boundaries`, `check-large-files.mjs`, `lizard-only.sh` (86 warnings, unchanged), `git diff --check`, and the targeted vitest suites above (159 tests).

## Phase 3 — advancedTx user-input errors map to 400/404 and pins realign (server)

Findings: `cpfp-batch-user-input-errors-surface-as-500-not-400`; folds in P3 `batch-stryker-fee-policy-mutate-range-stale-after-1121`.

Evidence: `server/src/services/bitcoin/advancedTx/cpfp.ts:105-116` and `advancedTx/batch.ts` ("No spendable UTXOs available", "Insufficient funds…") throw plain `Error`; routes in `server/src/api/bitcoin/transactions.ts:225,279` (the `createCPFPTransaction`/`createBatchTransaction` call sites — not `server/src/api/transactions.ts`, a re-export shim, or `server/src/api/transactions/drafting.ts`) are wrapped only by `asyncHandler`; `server/stryker.fee-policy.config.mjs:12` still lists `batch.ts:90-140` although the pinned invariant moved to 115-134.

Contract: `UTXO not found` → `NotFoundError`; `already spent`, `frozen`, `locked by a pending draft`, `No spendable UTXOs available`, insufficient funds → `InvalidInputError` (field `parentTxid`/`parentVout` or `utxos`). Keep message text (existing contracts pin it). Internal invariants (`Wallet script identity is unavailable`, `missing scriptPubKey evidence`, `CPFP input spend evidence is missing`) stay plain errors. Realign `stryker.fee-policy.config.mjs` ranges for `batch.ts` and `cpfp.ts` to cover the pinned invariants with the same margins as before; re-pin the map if lines shift; prove with the fee-policy stryker profile and `check-wallet-safety-mutation-map.mjs`.

Failing tests first: service contracts asserting `toBeInstanceOf(NotFoundError|InvalidInputError)`; route supertests in `bitcoin.transaction.contracts.ts` asserting 404/400 codes for CPFP and batch.

Verification: as Phase 1 plus mutation evidence.

## Phase 4 — USB signing always releases the transport it opened (frontend)

Finding: `usb-signing-disconnect-skipped-on-superseded-lease`.

Evidence: `src/hooks/send/useUsbSigning.ts:234` (`signPsbtWithDevice`, called only from `signWithDevice`) connects unconditionally; `:434-439` `finally { if (lease.isCurrent()) { setIsSigning(false); hardwareWallet.disconnect(); } }` is `signWithDevice`'s own finally block (lines 364-441) — this is the one and only connect/disconnect pair to fix. `signWithHardwareWalletResult` (lines 300-356, finally at `:351-353`) requires `hardwareWallet.isConnected` on entry (`:302`) and never calls `.connect()` itself, so it has no transport to release and needs no change.

Contract: track whether this attempt opened the transport (`connected` flag set after `connect` resolves); in `finally`, call `hardwareWallet.disconnect()` whenever the flag is set, regardless of the lease; keep `setIsSigning(false)` and other component state lease-gated. If `disconnect` rejects, log at debug and continue (no throw from `finally`).

Failing tests first: `tests/hooks/useUsbSigning.test.tsx` — start signing, supersede the lease (`owner.invalidate()`/second attempt) before `signPSBT` resolves, then resolve; assert `disconnect` was called exactly once for the superseded attempt and `setIsSigning(false)` was not applied to the stale attempt. Prove red against `origin/main`.

Verification: typecheck app/tests/all, lint, frontend coverage 100%, lizard 86, large-files, `arch:check` (primary checkout), `git diff --check`.

Status: done

## Phase 5 — RBF replacement linkage is structural, not a memo prefix (server + shared + frontend)

Finding: `rbf-memo-prefix-spoofs-transaction-replacement`.

Evidence: `persistTransaction.ts:99-121` links `rbfStatus: 'replaced'` on a memo prefix; `broadcasting.ts:349,371` pass `body.memo`; `transactionActionsData.ts:41` generates the memo for the RBF flow; `mobileApiRequests.ts:274` memo unconstrained.

Contract: add an optional `replacesTxid: z.string().regex(/^[0-9a-f]{64}$/)` to the broadcast request schemas (shared + server, parity test as in #1110); the RBF UI sends it (memo stays purely descriptive); `persistTransaction` links a replacement only when `metadata.replacesTxid` is present AND the original transaction belongs to the wallet, is unconfirmed (`confirmations === 0` / no block height), and shares at least one input outpoint with the new transaction — compare `metadata.utxos`/`metadata.inputs` (already parsed and passed into `persistTransaction`, used later for `storeTransactionIO`) against the *original* transaction's own spent outpoints, which must be fetched inside the same Prisma transaction via `tx.transactionInput.findMany({ where: { transactionId: originalTx.id } })` (no repository helper currently does this — `TransactionInput` has an existing `[txid, vout]` index but no by-`transactionId` lookup is exposed today, so add one); otherwise reject with `InvalidInputError('replacesTxid does not match an unconfirmed transaction sharing an input')`. The memo prefix no longer has any effect. Existing data is untouched.

Failing tests first: `persistTransaction` unit tests (memo prefix alone → no linkage; `replacesTxid` for a confirmed tx → rejected; for an unconfirmed tx with no shared input → rejected; genuine replacement → linked and label inherited); broadcasting route contract for the new field; frontend `transactionActionsData` test that the RBF flow sends `replacesTxid`; shared schema parity test.

Verification: server gates as Phase 1; frontend gates as Phase 4; gateway tsc + tests (shared schema change); `npm --workspace shared run build` before server/gateway tests.

## Phase 6 — oversized dead-letter entries are truncated, never silently lost (server)

Finding: `dead-letter-oversized-entry-write-rejected-and-relost-forever`.

Evidence: `deadLetterQueue.ts:31,79-84` 256 KiB cap with a throw; `:157,170` embed the payload twice; `eventHandlers.ts:127-134` swallow at `log.debug`; `deadLetterReconciler.ts:67-79` re-fails every cycle.

Contract: before validation, if the serialised entry exceeds the cap, first drop the redundant `payload.data` copy (it duplicates `job.data` purely for display/support-package purposes — see `server/src/services/supportPackage/collectors/deadLetterQueue.ts`); only if still oversized, replace both `payload.data` and `job.data` with a bounded summary `{ truncated: true, originalBytes, preview: <first 4 KiB of JSON> }`. This ordering matters: `server/src/api/admin/infrastructure.ts:201` calls `retryDeadLetterSyncJob(entry.job, entry.id)`, which resubmits the job using `entry.job.data` directly (`server/src/services/sync/syncDeadLetterRetryAdmission.ts`, gated by `isSyncWalletEnvelope` in `server/src/services/deadLetterJobEnvelope.ts`, which requires `envelope.data` to satisfy `isSyncWalletJobData`). Truncating `job.data` unconditionally would make every oversized sync entry silently unretryable (`isSyncWalletEnvelope` returns `false` on a `{truncated: true, ...}` shape, so `retryDeadLetterSyncJob` returns `false` with no signal) — dropping only the duplicate `payload.data` copy first avoids this for every entry that fits once de-duplicated. `validateEntrySize` stays as the last-resort guard. The `'failed'` handler logs DLQ write failures at `log.error` with the job id and queue. Add a unit test that the reconciler does not re-enqueue a job whose entry was stored truncated, and a test that a sync-category entry truncated only via the `payload.data` drop still passes `isSyncWalletEnvelope` and remains retryable.

Failing tests first: `deadLetterQueue` unit test with ~200 KiB job data → entry stored with `truncated: true`; `eventHandlers` test → `log.error` on write failure; sync-category entry retains `job.data` (and thus retryability) when dropping `payload.data` alone is sufficient to fit the cap.

Verification: as Phase 1.

## Phase 7 — partial channel failures are recorded per channel (server)

Finding: `notification-channel-partial-failure-marked-job-completed`.

Evidence: `notificationJobHelpers.ts:112-114`; `notificationJobs.ts:126,253,359,469`; `channels/telegram.ts:69,95,150` log-only catches; push failures already recorded via `recordPushFailure` (#1117).

Contract: keep the job outcome as is (do not retry delivered channels); the channel registry (`server/src/services/notifications/channels/registry.ts`) returns per-channel `NotificationResult[]`, and for every failed channel that is not already self-recording (push, via `recordPushFailure`, category `'push'`), the job records a dead-letter entry scoped to `{ channel, userId, notificationType, error }` and logs at `log.error`. `DEAD_LETTER_CATEGORIES` (`server/src/services/deadLetterQueueTypes.ts:79-87`) already has a dedicated `'telegram'` category parallel to `'push'` — use it for telegram failures (matching `recordPushFailure`'s per-channel-category precedent) and fall back to the generic `'notification'` category (singular; there is no `'notifications'` value) for webhook and any other channel without a dedicated bucket. Telegram, webhook, and any other channel either self-record like push or the registry records for them; pick one mechanism and apply it to all channels.

Failing tests first: notification job handler test with a registry stub returning success for push and failure for telegram → a DLQ entry scoped to telegram is written, the job still completes; existing "all channels failed" behaviour unchanged.

Verification: as Phase 1.

## Delivery

One PR per phase, serial merges on `main`, each rebased only when it is next; target-branch CI verified after each merge; branches deleted only after the merge-commit ancestry gate. PR order: 1 (P1) first, then 2, 3, 6, 7 (server), then 4 (frontend), then 5 (cross-cutting, last because it touches shared schemas). No container rebuild until the loop's clean pass (`--deploy final`).

## Completion criteria

All seven findings resolved in run state with a target-CI-verified attempt record; a fresh full scrub (iteration 19) of the resulting main SHA finds zero P0–P2.

## Review notes

Recursive plan review, 3 passes, all against `/home/nekoguntai/sanctuary-wt-i18-plan` on `codex/bug-scrub-loop/i18-plan` (fb6b008c base).

Accepted (evidence-backed, applied):
- **Phase 2 scope gap**: `/network/:network/resync` shares the exact destructive-resync primitive and role-blind access gate the phase was written to fix for `/reset`/`/resync`; the phase's own contract text ("/network/* batch routes ... unchanged") contradicted this. Extended the contract and evidence to include it, with a concrete fix pattern (existing `findByIdWithEditAccess` precedent) and a test.
- **Phase 3 file-path ambiguity**: the repo has five files named/containing `transactions.ts`; the cited routes are in `server/src/api/bitcoin/transactions.ts`, not the 69-line re-export shim at `server/src/api/transactions.ts`. Disambiguated.
- **Phase 4 stray citation**: "Apply the same to the `signWithDevice` path at `:351-353`" pointed at `signWithHardwareWalletResult`'s finally block, a different function that never calls `.connect()` and needs no fix; `signWithDevice`'s connect/disconnect pair is already the `:234`/`:434-439` citations. Removed the redundant, misleading instruction and stated explicitly why the other function is out of scope.
- **Phase 5 missing step**: the contract required comparing the new transaction's inputs against the *original* transaction's inputs but never said how to obtain the original's — no repository helper fetches a transaction's stored inputs by `transactionId` today. Added the concrete query and the note that a new helper is needed.
- **Phase 6 correctness bug**: unconditionally truncating both embedded copies of `job.data` breaks `server/src/api/admin/infrastructure.ts`'s manual dead-letter retry for the sync category — `isSyncWalletEnvelope` requires the untruncated shape, so `retryDeadLetterSyncJob` would silently return `false` for every large sync entry post-fix, the opposite of the phase's goal. Reordered the contract to drop the redundant `payload.data` display copy first and only fall back to truncating `job.data` (the functional copy) when still oversized, with a test pinning retryability.
- **Phase 7 category-naming error**: the contract invented a generic "notifications category" but `DEAD_LETTER_CATEGORIES` already has a dedicated `'telegram'` value parallel to the existing `'push'` (used by `recordPushFailure`), and the correct generic value is singular `'notification'`, not `'notifications'`. Corrected to use the dedicated category for telegram and the real generic value as fallback.
- **Minor citation corrections** (Phase 1 test paths, Phase 2/6/7 line-range precision): `server/tests/unit/services/vaultPolicy/` does not exist (tests are directly under `services/`, and `vaultPolicy/` is reserved for the unrelated `vaultPolicyService` CRUD suite); a few cited line ranges were off by several lines.

Rejected/deferred:
- Whether frontend/shared consumers switch on the triggered-policy action union (Phase 1, bullet 4): verified `rg "approval_required"` across `shared/` and `src/` returns zero hits — no current consumer exists even though the field is returned in the draft-creation API response. The plan's existing conditional phrasing ("check ... and add ... where needed") already correctly anticipates this; no edit needed.
- Whether `requiresApproval`'s `action === 'approval_required'` gate in `draftCreate.ts:36` needed plan-level attention given Phase 1's action-union change: verified it already short-circuits correctly once time-delay policies stop emitting `'approval_required'`, corroborating (not contradicting) the phase's "belt and braces" framing — not a defect.
- `list/pending/crossWallet repositories` phrasing in Phase 5 (evidence for `rbfStatus`/`replacedByTxid` consumers): the actual files live under `server/src/api/transactions/` (`crossWallet.ts`, `walletTransactions/pending.ts`), not `server/src/repositories/`. Left as-is — the instruction to check these consumers is correct in substance and the imprecision doesn't risk sending an implementer to the wrong file (no repository files by those names exist to confuse it with).

Verification performed: every cited file, function, line range, schema field, test path, and script referenced in all seven phases was checked against the actual worktree with `rg`/`sed`/`find`; `git -C /home/nekoguntai/sanctuary-wt-i18-plan diff --check` passes clean after each pass.

Pass 3 found no further actionable comments. Plan is clean.
