# Iteration 19 — P1/P2 remediation plan

- Iteration: 19 (bug-scrub-loop run `bug-scrub-loop-20260912t210000z-p2-backlog`)
- Source target-branch SHA: `b419edb5e7eaceb163ee9f655c666c95bc2971ea` (main, after PR #1130)
- Scope: whole repository
- Blocking findings (coordinator-reconfirmed at source):
  P1 `time-delay-policy-enforce-mode-is-a-silent-no-op`;
  P2 `advancedtx-rbf-cpfp-plain-error-still-surfaces-as-500`,
  `rbf-replacement-link-not-cas-guarded-by-rbfstatus`,
  `reconcileutxos-listed-branch-ignores-authenticated-spend-evidence`,
  `batch-transaction-pinned-utxo-selection-stops-early`,
  `push-outer-lookup-failure-reported-as-full-success`,
  `rbf-draft-recipient-picks-arbitrary-output-not-change-aware`,
  `wallet-telegram-settings-cross-wallet-error-revert-on-switch`,
  `send-privacy-analysis-out-of-order-async-overwrite`.
- P3 backlog (outside the blocking fix set; `batch-parent-min-confirmations-not-enforced` is folded into Phase 5 because it is the same selection boundary): `llm-egress-proxy-unvalidated-id-path-injection`, `single-sig-sign-and-broadcast-dead-hardware-branch`, `confirmation-refresh-perpetual-fanout-for-replaced-transactions`, `draftcreate-orphan-draft-on-nonlock-error-during-utxo-locking`, `utxo-spenttxid-never-populated`, plus the earlier P3 items in run state.

## Goal, non-goals, assumptions

Goal: fix the nine blocking findings with a failing regression test per finding, in nine independently mergeable phases, without schema migrations.

Non-goals: implementing the time-delay cooling-period/veto feature (Phase 1 makes the control honest by failing closed, it does not build the hold); redesigning coin selection beyond the pinned-selection contract; changing the notification retry model.

Assumptions: main is green (verified locally on `b419edb5`: backend 16026, frontend 8593, gateway 571, 100% coverage, all gates); repository rules apply (tests-first; no `catch (error: any)`, `console.log`, `@ts-ignore`, empty catch; backend coverage scoped to `tests/unit`; lizard exactly 86; `check-large-files.mjs`; `arch:check` output committed; server `typecheck:tests`; `prisma.*` only in repositories; no new migrations — the release replay gate pins the migration tree). Wallet-safety mutation-map pins for `server/src/services/bitcoin/**` must be re-pinned and re-proven (fee-policy stryker profile + `check-wallet-safety-mutation-map.mjs`) and `server/stryker.fee-policy.config.mjs` ranges realigned whenever lines shift in pinned files (`rbf.ts`, `cpfp.ts`, `batch.ts`, `utxoSelection.ts`, `transactions/createBatchTransaction.ts`).

## Phase 1 — enforce-mode time-delay policies fail closed until the feature exists (server, P1)

Finding: `time-delay-policy-enforce-mode-is-a-silent-no-op`.

Evidence: `policyEvaluationEngine.ts:224-248` labels an enforced trigger `time_delay` but never sets `state.blocked` (`allowed: !state.blocked` at `:334`); `draftCreate.ts:36-38` gates only on `approval_required`; no sign/broadcast gate exists; the frontend has no handling for the action. An admin who configures a cooling period gets nothing.

Contract (fail closed, no feature build):
- `vaultPolicyService` rejects creating or updating a `time_delay` policy with `enforcement: 'enforce'` (`InvalidInputError`: time-delay enforcement is not available yet; use monitor mode). Monitor mode stays allowed.
- `applyTimeDelayPolicy` treats an already-stored enforce-mode `time_delay` policy as `blocked` (`state.blocked = true`, reason: "time-delay enforcement is not available; switch this policy to monitor mode or disable it") so the draft is refused explicitly instead of proceeding; monitor mode stays `'monitored'`. Keep the `'time_delay'` action value in the union for API/OpenAPI compatibility but stop emitting it.
- Document the product gap in the plan and in the policy service comment.

Failing tests first: `server/tests/unit/services/policyEvaluationEngine.test.ts` (enforced time-delay → `blocked` with the reason; monitor → `monitored`); `vaultPolicyService.test.ts` (create/update with enforce + time_delay → 400; monitor accepted); a draft-creation contract asserting a stored enforced time-delay policy refuses the draft with the explicit reason (today: succeeds silently). Prove red against `origin/main`.

Verification: server tsc, `typecheck:tests`, lint, `check:architecture-boundaries`, unit coverage 100% on `tests/unit`, lizard 86, large-files, `arch:check`, `git diff --check`; OpenAPI enum/tests untouched (value retained).

## Phase 2 — remaining advancedTx user-input errors map to 400 (server)

Finding: `advancedtx-rbf-cpfp-plain-error-still-surfaces-as-500`.

Evidence: `rbf.ts:171` (not replaceable), `:175-177` (fee rate not higher), `cpfp.ts:161` (no positive child fee), `:167-169` (parent value insufficient), `:174-176` (dust child output) throw plain `Error`; routes are wrapped only by `asyncHandler`.

Contract: each becomes `InvalidInputError` with the same message (fields `txid`/`newFeeRate` for RBF, `targetFeeRate`/`parentVout` for CPFP). Internal invariants stay plain. Re-pin the wallet-safety map and realign `stryker.fee-policy.config.mjs` for `rbf.ts`/`cpfp.ts` if lines shift; prove with the fee-policy profile and the map checker.

Failing tests first: service contracts asserting `toBeInstanceOf(InvalidInputError)` for each condition; route supertests asserting 400 for the RBF not-replaceable and fee-rate cases and a CPFP dust case; update the contract test that currently pins 500 for RBF creation failures to use an internal error instead.

Verification: as Phase 1 plus mutation evidence.

## Phase 3 — RBF replacement linkage is compare-and-swap guarded (server)

Finding: `rbf-replacement-link-not-cas-guarded-by-rbfstatus`.

Evidence: `persistTransaction.ts:115-122` blind `transaction.update`; `findUnconfirmedTransactionForReplacement` (`repositories/transactions/core.ts:32-41`) does not exclude an original that is already `replaced`.

Contract: the pre-broadcast `assertReplacementLink` also refuses an original whose `rbfStatus === 'replaced'` or `replacedByTxid` is set ("transaction was already replaced"); the post-broadcast link uses a repository CAS (`updateMany` with `where: { id, rbfStatus: { not: 'replaced' }, replacedByTxid: null }`) and, when it updates zero rows, persists the new transaction without linkage and logs a warning with both txids (never throws after broadcast). `findUnconfirmedTransactionForReplacement` gains the same exclusion.

Failing tests first: repository test for the exclusion and the CAS shape; `persistTransaction.test.ts` — original already replaced → stored without link + warning; `replacementLink.test.ts` — assert refuses an already-replaced original before broadcast. Prove red against `origin/main`.

Verification: as Phase 1.

## Phase 4 — a listing alone never un-spends a locally spent UTXO (server)

Finding: `reconcileutxos-listed-branch-ignores-authenticated-spend-evidence`.

Evidence: `reconcileUtxos.ts:48-61` `createUtxoUpdate` returns `{ spent: false }` for any listed outpoint; `:66-83` applies it even when `dbUtxo.spent` is true; `persistTransaction.ts:52-65` marks spends immediately after broadcast.

Contract: when `dbUtxo.spent` is true and the outpoint is still listed, keep it spent (update confirmations/blockHeight only) unless the sync context carries authenticated evidence that the spending transaction is gone (e.g. the spending txid is neither in the mempool nor confirmed per the same authenticated history used by the not-listed branch); log at debug when a listing is ignored for a locally spent coin. Keep the existing not-listed branch unchanged.

Failing tests first: `reconcileUtxos` unit test — spent UTXO still listed by the server stays `spent: true`; unspent UTXO listed updates as today; spent UTXO with authenticated evidence that the spend vanished is restored. Prove red against `origin/main`.

Verification: as Phase 1 (no bitcoin pins in `sync/phases`).

## Phase 5 — a pinned batch selection spends every pinned input (server)

Findings: `batch-transaction-pinned-utxo-selection-stops-early`; folds in P3 `batch-parent-min-confirmations-not-enforced`.

Evidence: `createBatchTransaction.ts:356-386` returns on first coverage; `getAvailableUtxos` (`:266-292`) returns exactly the pinned set; `utxoSelection.ts` `selectUTXOsExact` spends the whole selection; `advancedTx/batch.ts:64` omits `minConfirmations`.

Contract: when `selectedUtxoIds` is supplied, `createBatchTransaction` spends the entire pinned set (change = total − outputs − fee for the full set; insufficient → `InvalidInputError`), matching `selectUTXOsExact`; auto-selection keeps the greedy loop. `advancedTx/batch.ts` passes `minConfirmations: confirmationThreshold` like its sibling. Re-pin the wallet-safety map (`createBatchTransaction.ts` and `batch.ts` are pinned) and realign stryker ranges; prove with the fee-policy profile and the map checker.

Failing tests first: `createBatchTransaction` contracts — three pinned UTXOs where the first covers the total → all three are inputs and the change reflects the full set; insufficient pinned set → 400; auto-selection unchanged; `advancedTx/batch.ts` contract asserting `minConfirmations` is passed.

Verification: as Phase 1 plus mutation evidence.

## Phase 6 — push channel reports real outcomes (server)

Finding: `push-outer-lookup-failure-reported-as-full-success`.

Evidence: `pushService.ts:221-254` swallows wallet/user lookup errors; `channels/push.ts:33-65` returns `{ success: true, usersNotified: 1 }` after the call resolves; `notificationJobHelpers` skips push as self-recording.

Contract: `notifyNewTransactions` (and the sibling notify entry points) return a `{ success, usersNotified, error? }` result instead of swallowing: lookup failures return `success: false` with the message (still logged); the push channel maps that result through; the job helper treats a failed push result like any other failed channel except it does not double-record when `recordPushFailure` already ran for that delivery (pass a flag or check the result's `recorded` marker).

Failing tests first: `pushService` unit test — lookup throws → result `success: false`; `channels/push` test → channel reports failure; job helper test → a push channel failure that was not self-recorded gets a DLQ entry, one that was does not.

Verification: as Phase 1.

## Phase 7 — RBF drafts name the real recipient and change (server + frontend)

Finding: `rbf-draft-recipient-picks-arbitrary-output-not-change-aware`.

Evidence: `rbf.ts:254` strips `isChange`; `transactionActionsData.ts:34-62` uses `outputs[0]` and `changeAmount: 0`; `DraftRecipientSummary` renders every output as a recipient.

Contract: the RBF response (`server/src/api/bitcoin` types + `src/api/bitcoin.ts` `RBFTransactionResponse`) includes `isChange` per output; `rbfDraftRequest` picks the first non-change output as `recipient`/`amount`/`effectiveAmount`, sets `changeAmount`/`changeAddress` from the change output (0/undefined when none), and lists only non-change outputs in `outputs` while keeping the PSBT untouched; `DraftRecipientSummary` shows a change row distinctly if the draft carries change. OpenAPI schema for the RBF response updated.

Failing tests first: server RBF creation contract asserting `isChange` on the wire; frontend `transactionActionsData` test with change at index 0 → recipient is the external output and change fields are set; component test for the summary.

Verification: server gates as Phase 1 (rbf.ts pins: re-pin if lines shift); frontend typecheck app/tests/all, lint, coverage 100%, lizard 86, large-files, `arch:check`, `git diff --check`.

## Phase 8 — Telegram settings saves are wallet-scoped (frontend)

Finding: `wallet-telegram-settings-cross-wallet-error-revert-on-switch`.

Evidence: `useWalletTelegramSettingsController.ts:90-113` `saveSettings` applies catch/finally state unconditionally; the load effect guards with `isMounted` but the save path does not.

Contract: `saveSettings` captures a request token (walletId + a monotonically increasing counter or the mounted ref) and applies `setSettings`/`setError`/`setSaving`/`setSuccess` only when the token is still current for the mounted wallet; a stale rejection is logged at debug and ignored.

Failing tests first: controller test — toggle on wallet A, re-render with wallet B, B's load resolves, A's save rejects → B's settings and error unchanged. Prove red against `origin/main`.

Verification: frontend gates as Phase 7.

## Phase 9 — privacy analysis applies only the latest request (frontend)

Finding: `send-privacy-analysis-out-of-order-async-overwrite`.

Evidence: `useTransactionComposition.ts:146-170` sets the analysis after `await` with no ownership check; cleanup only clears the debounce timer.

Contract: the effect carries a cancelled flag/AbortController in its cleanup; results from a superseded request are ignored (no state update); loading state is cleared only by the latest request.

Failing tests first: hook test — first request resolves after a second selection's request; assert the displayed analysis is the second one and the first result is ignored. Prove red against `origin/main`.

Verification: frontend gates as Phase 7.

## Delivery

One PR per phase, serial merges on `main`, each rebased only when it is next; target-branch CI verified after each merge; branches deleted only after the merge-commit ancestry gate. PR order: 1 (P1), 2, 3, 4, 5, 6 (server), 8, 9 (frontend), 7 (cross-cutting, last). No container rebuild until the loop's clean pass (`--deploy final`).

## Completion criteria

All nine findings resolved in run state with a target-CI-verified attempt record; a fresh full scrub (iteration 20) of the resulting main SHA finds zero P0–P2.

## Delivery record

All nine phases merged serially on `main` (squash merges), each with target-branch CI verified:

| Phase | PR | Merge SHA | Notes / verified divergences |
| --- | --- | --- | --- |
| 8 | #1132 | `d6e11d81` | Per-mount request id instead of a walletId ref (A → B → A); wallet switch resets saving/error/success and clears the success timeout. |
| 1 | #1133 | `d6610517` | Update rule is the stricter reading: any config/enforcement edit of an enforce-mode time_delay policy is rejected until it is switched to monitor. |
| 2 | #1134 | `30645d2a` | `canReplaceTransaction` marks upstream/node failures (`upstreamError`) so those stay 500; only business-rule rejections became 400. `rbf.ts` pins re-pinned 209-219 → 217-227. |
| 3 | #1135 | `74ad0f5e` | The CAS lives inside `resolveReplacementLinkAfterBroadcast` (repository `linkReplacementIfUnreplaced`); `persistTransaction` no longer touches Prisma for the link. |
| 4 | #1136 | `e57a75cc` | Restore requires BOTH no authenticated spend this round AND no live locally recorded spender (`findLocallySpentOutpointKeys`, inventoried in `config/wallet-sync-mutation-boundaries.json` after the Architecture lane caught the missing entry). |
| 6 | #1137 | `fbde91ca` | Send-loop errors also return `success: false` with the partial `usersNotified` count (never thrown after partial sends); regenerated notifications call graph committed. |
| 9 | #1138 | `8109694d` | Early-return branch (coin control off / selection cleared) clears the loading flag itself. |
| 7 | #1139 | `70b06b3b` | All-change edge keeps every output as a recipient with no change fields so the draft never has zero outputs. |
| 5 | #1140 | `c0f5bd00` | Both batch paths (`transactions/createBatchTransaction.ts` and `advancedTx/batch.ts`) spend the whole pinned set; two new wallet-safety invariants with canaries. |

Iteration-19 plan PR: #1131 (`86556a22`). Custody after delivery: no loop branches or worktrees remain.
