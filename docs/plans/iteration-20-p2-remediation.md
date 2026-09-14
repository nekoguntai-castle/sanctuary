# Iteration 20 — P2 remediation plan

- Iteration: 20 (bug-scrub-loop run `bug-scrub-loop-20260912t210000z-p2-backlog`)
- Source target-branch SHA: `c0f5bd002dca17fb4e4c59d32b845fd4c48baf37` (main after PR #1140; main `18519eaf` differs only by the iteration-19 delivery record in `docs/plans/`)
- Scope: whole repository
- Blocking findings (coordinator-reconfirmed at source, all P2):
  `reconcileutxos-confirmation-refresh-clobbers-concurrent-broadcast-spend`,
  `electrum-utxo-batch-silently-coerces-invalid-item-to-empty`,
  `electrum-reconnect-resubscribe-failure-leaves-network-silently-unsubscribed`,
  `rbf-change-adjustment-user-conditions-surface-as-500`,
  `cpfp-modal-hardcoded-vout-and-empty-recipient`,
  `wallet-telegram-toggle-out-of-order-response-reverts-committed-change`,
  `wallet-webhooks-list-overwritten-by-stale-wallet-response`,
  `network-sync-actions-cross-network-state-leak`.
- P3 backlog (outside the blocking fix set; `stryker-fee-policy-truncates-pinned-batch-insufficient-funds-throw` is folded into Phase 4 because it edits the same pinned files): `hardwarewallet-service-getallxpubs-swallows-device-disconnect-as-skipped-path`, `dead-letter-update-is-no-op-for-job-envelope-entries`, `castvote-double-submit-uncaught-unique-violation`, plus the earlier P3 items in run state.

## Goal, non-goals, assumptions

Goal: fix the eight blocking findings with a failing regression test per finding, in eight independently mergeable phases, without schema migrations.

Non-goals: redesigning the sync pipeline's transaction scope; adding a generic request-cancellation layer to the frontend; changing electrum protocol handling beyond the two named gaps.

Assumptions: main is green (target CI verified through `c0f5bd00`); repository rules apply (tests-first; no `catch (error: any)`, `console.log`, `@ts-ignore`, empty catch; backend coverage scoped to `tests/unit`; lizard exactly 86; `check-large-files.mjs`; `arch:check` output committed; server `typecheck:tests`; `prisma.*` only in repositories; no new migrations). Any new repository call from a sync-path file must be inventoried in `config/wallet-sync-mutation-boundaries.json` (`npm run check:wallet-sync-mutation-boundaries`). Wallet-safety mutation-map pins for `server/src/services/bitcoin/**` must be re-pinned and re-proven (fee-policy stryker profile + `validateMutationEvidence` for `serverFeePolicy`) whenever lines shift in pinned files.

## Phase 1 — confirmation refresh never writes `spent` (server)

Finding: `reconcileutxos-confirmation-refresh-clobbers-concurrent-broadcast-spend`.

Evidence: `reconcileUtxos.ts:99-103` returns `{ ..., spent: false }` for an unspent-at-snapshot UTXO whose confirmations changed; `persistUtxoUpdates` (`:175-193`) passes `spent` through `utxoRepository.batchUpdateByIds` (`utxoRepository.ts:416-441`, `update where { id }` only). A spend broadcast between the snapshot read and this write (persistTransaction marks `spent: true` immediately) is reverted to unspent.

Contract: the confirmation-refresh update carries only `confirmations`/`blockHeight` (no `spent` key) — the type becomes `spent?: false`/absent for refreshes and `true`/`false` only for the explicit spent-branch outcomes (Phase 4 of iteration 19); the restore-to-unspent write (`spendEvidenceVanished`) goes through a guarded repository update (`updateMany where { id, spent: true }`) so it cannot resurrect a coin another writer just spent. `batchUpdateByIds` stays generic; add a narrow repository function for the guarded restore if `updateMany` is needed, and inventory it.

Failing tests first: `phases.utxoReconciliation.test.ts` — an unspent UTXO with changed confirmations produces an update WITHOUT a `spent` key (currently `spent: false`); the restore path issues the guarded shape. Prove red against `origin/main`.

Verification: server gates + `check:wallet-sync-mutation-boundaries` + `arch:check`.

## Phase 2 — electrum listunspent batch validates every item (server)

Finding: `electrum-utxo-batch-silently-coerces-invalid-item-to-empty`.

Evidence: `methods.ts:526-529` `resultMap.set(addresses[i], (results[i] as Array<...>) || [])`; the sibling `getAddressHistoryBatch` (`:494-500`) validates each item; `fetchUtxos.ts:120` `recordFailClosed(ctx, 'missing_utxo_result')` exists for an absent entry but is unreachable.

Contract: validate each batch item with the same validator the single-address path uses (`validateResponse`/a `validateUtxoResponse` shaped like `validateHistoryResponse`); an invalid item is NOT set in the map (so the fetch phase records `missing_utxo_result` for that address). `getAddressHistoryBatch`'s per-item `validateHistoryResponse` call is not caught anywhere in its loop, so an invalid item there actually throws and aborts the whole batch — that behavior, if mirrored here, would reject `fetchAddressUtxos`'s `.then` handler entirely (`fetchUtxos.ts:115-123`) and fall back to per-address individual requests for every address in the batch chunk (not just the invalid one), landing on `recordFailClosed(ctx, 'utxo_fetch_failed')` (`fetchUtxos.ts:145`) rather than `missing_utxo_result` (`:120`). Only the "absent from map" contract reaches the `missing_utxo_result` branch the evidence calls out as dead code, so pick that contract, not the throwing one; the two are not interchangeable here despite the sibling's behavior.

Failing tests first: electrum methods unit test — one batch item `null` → the address is absent from the map instead of `[]`; the fetchUtxos phase test that the `missing_utxo_result` fail-closed branch (`:120`) is reached for that address only, with the rest of the batch unaffected.

Verification: server gates.

## Phase 3 — resubscribe failure re-arms reconnect (server)

Finding: `electrum-reconnect-resubscribe-failure-leaves-network-silently-unsubscribed`.

Evidence: `server/src/worker/electrumManager/reconnection.ts:64-99` — connect and `subscribeNetworkAddresses` share one try; the catch only logs; state stays `connected: true` with empty `subscribedAddresses` and no timer.

Contract: if `subscribeNetworkAddresses` throws after a successful connect, log at error, mark the network as not subscribed (`connected` stays whatever the socket state is, but a `subscribed`/`needsResubscribe` marker is set) and re-arm `scheduleReconnect` (bounded by the existing backoff) so the subscription is retried; the connect failure path keeps its current behavior.

Failing tests first: reconnection unit test — connect succeeds, subscribe rejects once → a reconnect timer is scheduled (or the resubscribe is retried) and the state is not left `connected && subscribedAddresses.size === 0 && reconnectTimer === null`.

Verification: server gates.

## Phase 4 — RBF change-adjustment errors map to 400 (server)

Findings: `rbf-change-adjustment-user-conditions-surface-as-500`; folds in P3 `stryker-fee-policy-truncates-pinned-batch-insufficient-funds-throw`.

Evidence: `rbf.ts:368-369` and `:373-376` plain `Error` in `adjustChangeOutputForFeeDelta`; `stryker.fee-policy.config.mjs:12` range `412-457` and the `standard-batch-pinned-selection-spends-full-set` invariant (418-447) exclude the pinned insufficient-funds throw at `createBatchTransaction.ts:458-466`.

Contract: both throws become `InvalidInputError` (fields `txid` for "no change output" and `newFeeRate` for "change would be dust"), messages unchanged. Extend the stryker range and the invariant/canary window to cover the pinned throw. Re-pin `rbf.ts` invariants if lines shift; prove with the fee-policy profile and the `serverFeePolicy` evidence validation.

Failing tests first: RBF creation contracts asserting `InvalidInputError` for both conditions; a route supertest asserting 400 for the no-change case.

Verification: server gates + mutation evidence.

## Phase 5 — CPFP modal sends real inputs; server resolves the parent output and destination (server + frontend)

Finding: `cpfp-modal-hardcoded-vout-and-empty-recipient`.

Evidence: `useTransactionActions.ts:109-115` sends `parentVout: 0, recipientAddress: ''`; `cpfp.ts:103` looks up that outpoint; `:123` parses the empty address; `tests/components/TransactionActions.test.tsx:554-558` pins the payload.

Contract: the CPFP request schema (shared + OpenAPI + server route) makes `parentVout` and `recipientAddress` optional. When `parentVout` is omitted the server resolves the wallet's spendable, unspent, non-locked outputs of `parentTxid` and uses the largest; none → `NotFoundError`. No existing repository function returns the needed shape for this — `utxoRepository.findByTxidsUnspent` (`utxoRepository.ts:295-320`) takes a single wallet+txid but selects only `walletId`/`txid`/`frozen`/`draftLock`, not `vout`/`amount`, so it cannot pick "the largest"; add a new repository function and inventory it if CPFP's sync-path status requires it. When `recipientAddress` is omitted the server derives a fresh change/receive address for the wallet with `prepareChangeOutputs` (`outputBuilder.ts:237`) — the helper `createBatchTransaction.ts:110` and `advancedTx/batch.ts:216` use for change. Note this is a batch-only precedent: RBF (`rbf.ts`) never derives a fresh change address — it reuses the original transaction's existing change output found via `addressRepository.findCanonicalEvidenceForPsbt` (branch === 1), so "the same helper the batch/RBF paths use for change" overstates RBF's involvement. The modal sends `{ parentTxid, targetFeeRate, walletId }` only; explicit values remain accepted for API consumers. `cpfp.ts` is wallet-safety pinned: re-pin and re-prove.

Failing tests first: server CPFP contract — omitted vout resolves the wallet's output, omitted address derives one, unknown parent → 404; route/OpenAPI/shared parity; frontend `useTransactionActions` test asserting the new payload (replace the pinned literal assertion).

Verification: server gates + mutation evidence + frontend gates + `arch:check`.

## Phase 6 — Telegram saves are ordered per wallet and revert to the last confirmed state (frontend)

Finding: `wallet-telegram-toggle-out-of-order-response-reverts-committed-change`.

Evidence: `useWalletTelegramSettingsController.ts:72-79` (`handleToggle`) captures `previousSettings = settings` and the mount-level request id (`currentRequestIdRef.current`, bumped only in the mount/walletId effect at `:37`, not per save); the revert itself is at `:143-144` (`setSettings(previousSettings); setError(...)`), reached whenever `isStale()` at `:139` is false, i.e. the id still matches.

Contract: every save bumps the request id (so an earlier save is stale once a later one starts); a stale save's success/failure never touches state; the latest save's failure reverts to a `confirmedSettingsRef` (updated on load and on each successful save) rather than the toggle's captured snapshot; `handleToggle` computes `nextSettings` from a settings ref so rapid toggles do not read a stale closure. The wallet-switch behavior from #1132 is unchanged.

Failing tests first: controller test — two toggles on one wallet; the first PATCH rejects after the second resolved → state shows the second (server-persisted) settings and no error; both fail → state reverts to the last confirmed settings; rapid toggles of two fields both apply. Prove red against `origin/main`.

Verification: frontend gates.

## Phase 7 — webhook list load is wallet-scoped (frontend)

Finding: `wallet-webhooks-list-overwritten-by-stale-wallet-response`.

Evidence: `WalletWebhooks.tsx:36-63` no cancellation/ownership guard; sibling hooks in the directory use a route-ownership token; no `key` at the call site.

Contract: `loadWebhooks` runs under the effect's cancelled flag (or the directory's ownership token pattern); a stale response neither sets the list nor the error/loading state; the list is cleared when walletId changes so B never renders A's rows.

Failing tests first: component test — mount A, rerender B, resolve B then A late → list shows B's endpoints. Prove red against `origin/main`.

Verification: frontend gates.

## Phase 8 — network sync results are scoped to the network they were requested for (frontend)

Finding: `network-sync-actions-cross-network-state-leak`.

Evidence: `useNetworkSyncActions.ts:183-219` settle state after await without a network check; auto-clear timers unconditional; `WalletListHeader.tsx:76` renders without `key`.

Contract: handlers capture the `network` they ran for and apply `setResult`/`setSyncing`/`setResyncing`/the auto-clear only while it is still the current network (ref); a network change clears `result` and the pending timer. (Keying the component per network is acceptable in addition, not instead.)

Failing tests first: hook test — trigger Sync All on mainnet, rerender with testnet before it resolves, resolve → no mainnet banner under testnet, and the spinner state is not leaked. Prove red against `origin/main`.

Verification: frontend gates.

## Delivery

One PR per phase, serial merges on `main`, each rebased only when it is next; target-branch CI verified after each merge; branches deleted only after the merge-commit ancestry gate. PR order: 1, 2, 3, 4 (server), 6, 7, 8 (frontend), 5 (cross-cutting, last). No container rebuild until the loop's clean pass (`--deploy final`).

## Completion criteria

All eight findings resolved in run state with a target-CI-verified attempt record; a fresh full scrub (iteration 21) of the resulting main SHA finds zero P0–P2.
