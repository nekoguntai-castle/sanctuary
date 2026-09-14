# Iteration 22 — P2 remediation plan

- Iteration: 22 (bug-scrub-loop run `bug-scrub-loop-20260912t210000z-p2-backlog`)
- Source target-branch SHA: `80889c3e625dfb99479fda3afeebedfbb4269fd7` (main after PR #1158; main `e3045a43` differs only by the iteration-21 delivery record in `docs/plans/`)
- Scope: whole repository
- Blocking findings (coordinator-reconfirmed at source, all P2):
  `advancedtx-cpfp-batch-recipient-address-unvalidated-500`,
  `telegram-draft-notify-partial-failure-still-reports-success`,
  `ai-insights-telegram-send-result-ignored-reports-success`,
  `rbf-fee-bump-double-reserves-policy-usage-window`,
  `dead-letter-tombstone-suppresses-write-but-logs-success`,
  `electrum-connect-timeout-orphans-late-arriving-socket`,
  `psbt-broadcast-missing-extended-timeout`,
  `hardwarewallet-hook-connect-resurrects-after-disconnect`,
  `trezor-adapter-connect-disconnect-interleave-resurrects-session`,
  `ai-label-suggestion-cross-transaction-stale-overwrite`,
  `pending-transfers-panel-cross-resource-stale-overwrite`.
- P3 backlog (outside the blocking fix set; `advanced-batch-noninteger-amount-bigint-crash` is folded into Phase 1 because it is the same request schema): `transfer-ownership-modal-search-out-of-order`, `electrum-pool-single-mode-acquire-typeerror-after-reconnect-exhaustion`, `block-height-indicator-stale-network-overwrite`, `telegram-settings-global-toggle-out-of-order-revert`, `check-provider-leaks-detection-guard-is-line-scoped-not-match-scoped`, `check-shared-deps-orphaned-not-wired-into-any-gate`, `release-candidate-jobs-missing-timeout-minutes`, `server-stryker-fee-policy-createBatchTransaction-second-stale-range`, `check-supply-chain-locks-docker-only-image-scanner`, plus the earlier P3 items in run state.

## Goal, non-goals, assumptions

Goal: fix the eleven blocking findings with a failing regression test per finding, in ten independently mergeable phases, without schema migrations.

Non-goals: a generic frontend cancellation layer; redesigning the dead-letter store; changing Electrum transport behavior beyond the connect-timeout cleanup; changing what policy usage a fresh (non-RBF) broadcast reserves.

Assumptions: main is green (target CI verified through `254550f8`; `80889c3e` pending at plan time); repository rules apply (tests-first; no `catch (error: any)`, `console.log`, `@ts-ignore`, empty catch; backend coverage scoped to `tests/unit`; lizard exactly 86; `check-large-files.mjs`; `arch:check` output committed; server `typecheck:tests`; `prisma.*` only in repositories; no new migrations). Sync-path repository calls stay inventoried in `config/wallet-sync-mutation-boundaries.json`. Wallet-safety pins: `advancedTx/{batch,cpfp}.ts` are pinned; Phase 1 must re-pin and re-prove (fee-policy stryker profile + `validateMutationEvidence` for `serverFeePolicy`) if lines shift.

## Phase 1 — advancedTx CPFP/batch validate recipient addresses and integer amounts (server)

Findings: `advancedtx-cpfp-batch-recipient-address-unvalidated-500`; folds in P3 `advanced-batch-noninteger-amount-bigint-crash`.

Evidence: `server/src/api/bitcoin/transactions.ts:45-65` — `CpfpBodySchema.recipientAddress` is `z.string().min(1).optional()` and `BatchTransactionBodySchema.recipients[].address` is `z.string().min(1)`, `amount` is `z.number().positive()` without `.int()`; `advancedTx/cpfp.ts:141-143` and `advancedTx/batch.ts:94-95` call `addressToOutputScript` unguarded (`utils.ts:55-86` throws a plain error); `batch.ts:206-211` does `BigInt(recipient.amount)`.

Contract: both routes resolve the wallet network first and validate every supplied recipient address with `validateAddress(address, network)` (400 `ValidationError`, same shape as the wallet routes); `amount` gains `.int()`; the services additionally map an `addressToOutputScript` failure to `InvalidInputError(..., 'recipientAddress' | 'recipients')` so any other caller also gets 400. OpenAPI `CpfpRequest`/batch request schemas updated (`integer` for amount). Re-pin `cpfp.ts`/`batch.ts` invariants if lines shift; prove with the fee-policy profile and the `serverFeePolicy` evidence validation.

Failing tests first: route supertests — CPFP with a malformed explicit `recipientAddress` → 400; batch with a malformed recipient → 400; batch with a fractional amount → 400 (currently 500/RangeError); service contracts → `InvalidInputError`. OpenAPI parity tests.

Verification: server gates + mutation evidence.

## Phase 2 — notification channels report per-send failures (server)

Findings: `telegram-draft-notify-partial-failure-still-reports-success`, `ai-insights-telegram-send-result-ignored-reports-success`.

Evidence: `telegram/notifications.ts:303-312` only the all-failed branch returns `success: false`; `channels/aiInsights.ts:90-111` awaits `sendTelegramMessage` without checking its `{ success: false }` result and counts the user as notified; `telegram/api.ts:94,176` shows the result shape.

Contract: `notifyNewDraft` returns `success: false` whenever at least one attempted send failed, with `error` naming the failed count (delivered count stays in `usersNotified`), matching `notifyNewTransactions`' any-failure semantics; the AI-insights channel checks `sendTelegramMessage`'s result, counts only successful sends, collects failures into `errors`, and returns `success: false` when any attempted send failed (with `recorded: false`). Zero eligible recipients stays `success: true, usersNotified: 0`.

Failing tests first: `notifyNewDraftResult.test.ts` — two recipients, one fails → `success: false`, `usersNotified: 1`, error names one failure; `channels/handlers` (or the aiInsights channel test) — a rejected send result → `success: false`, `usersNotified` excludes it; the job helper records both.

Verification: server gates + `arch:check` (notifications call graph may change; commit the regenerated doc).

## Phase 3 — RBF replacements reserve only the incremental usage (server)

Finding: `rbf-fee-bump-double-reserves-policy-usage-window`.

Evidence: `server/src/api/transactions/broadcasting.ts:405/432` reserve on every non-replay broadcast including ones carrying `replacesTxid`, by calling `reservePolicyUsage` (`:267-289`), which does not currently receive `body.replacesTxid` at all; the original's reservation is never released (only `DefiniteBroadcastRejectionError` releases, and `assertReplacementLink` throws `InvalidInputError`, not that class); `assertReplacementLink` (`server/src/services/bitcoin/transactions/broadcasting.ts:196`, deep inside `broadcastAndSave`, which runs after `reservePolicyUsage`) is the only path that verifies a claimed `replacesTxid` shares an input with the new transaction, via a private, unexported `findVerifiedReplacement` helper in `replacementLink.ts:57-69`; the bare repository lookup it wraps, `findUnconfirmedTransactionForReplacement` (`transactions/core.ts:68-83`), performs no such check and selects only `{ id, label }` — it does not select `amount`.

Contract: when the broadcast carries a verified `replacesTxid`, the reservation input carries `replacedAmount` (the original transaction's external amount) and the engine reserves only `max(0, amount − replacedAmount)` against spending-limit windows and does not increment `txCount` for velocity windows (a bump is the same logical transaction); a bump that does not raise the amount reserves nothing and cannot be blocked by usage limits. Fresh broadcasts are unchanged. The original's reservation stays (it represents the spend that the replacement continues). `reservePolicyUsage` must resolve `replacedAmount` through the same shared-input verification `assertReplacementLink` uses — exporting `findVerifiedReplacement` (or an equivalent helper) — not a bare `findUnconfirmedTransactionForReplacement` lookup, so a `replacesTxid` claim that only the reservation step would accept cannot shrink a reservation for an unrelated spend; this requires threading `replacesTxid` into `reservePolicyUsage`'s signature, which does not receive it today. Repository: add `amount` to `findUnconfirmedTransactionForReplacement`'s `select` in `transactions/core.ts` — confirmed not already selected — a read, no inventory needed unless called from a sync-path file. Engine: `reserveUsageWindow` (`server/src/repositories/policyRepository.ts:513-529`) unconditionally increments both `totalSpent` and `txCount` on every call with no option to skip either, and `reserveVelocityWindows` (`policyEvaluationEngine.ts`) calls it for every configured velocity check regardless of `amount`; not incrementing `txCount` for a bump therefore needs a new signal threaded through `reserveEnforcedUsage`/`ReserveUsageInput` (e.g. a `skipVelocity`/`isReplacementBump` flag checked in `reservePolicyWindows` before it calls `reserveVelocityWindows` at all) — subtracting `replacedAmount` from `amount` alone does not suppress the velocity branch, which is amount-independent.

Failing tests first: engine contract — replacement with equal amount reserves nothing; higher amount reserves the delta only; velocity window untouched; broadcast route contract — an RBF broadcast under an exhausted daily limit is not blocked when its amount does not exceed the original's. Prove red against `origin/main`.

Verification: server gates.

## Phase 4 — dead-letter writes are never falsely reported as recorded (server)

Finding: `dead-letter-tombstone-suppresses-write-but-logs-success`.

Evidence: `redisDeadLetterStore.ts:20-21` `UPSERT_SCRIPT` returns 0 while the tombstone key exists; `:198` returns `entry.id` regardless; `memoryDeadLetterStore.ts` mirrors (`:31` returns `entry.id` under a live tombstone); `deadLetterQueue.ts:348` logs "Dead letter entry recorded" unconditionally. The two call paths are `worker/workerJobQueue/eventHandlers.ts:79` (the real-time `worker.on('failed', ...)` path, via the injectable `recordExhaustedJob` default) and `worker/workerJobQueue/deadLetterReconciler.ts:68` (the repair sweep) — both call the identical `deadLetterQueue.addExhaustedJob(category, sourceQueue, job, error, failedAt?)` signature today, so distinguishing them requires a new parameter on that call; `DeadLetterStore.upsert(entry): Promise<string>` (`deadLetterQueueTypes.ts:64-73`) also takes no such option in either implementation.

Contract: `upsert` returns `{ id, written: boolean }` (both stores); `deadLetterQueue.add`/`addExhaustedJob` log at warn "suppressed by tombstone" and return a result the caller can distinguish; a FRESH exhausted-job failure (the `eventHandlers.ts:79` path, not the `deadLetterReconciler.ts:68` repair sweep) clears the tombstone before writing so a job that fails again after being acknowledged is recorded; the repair sweep keeps respecting tombstones (its purpose) — this requires a new parameter distinguishing the two `addExhaustedJob` call sites (and, underneath, `upsert`), since nothing does today. Existing tombstone tests stay green.

Failing tests first: store tests — upsert under a live tombstone reports `written: false`; queue tests — the failed-handler path after an acknowledge writes a new entry, the reconciler path does not; the log line reflects suppression.

Verification: server gates.

## Phase 5 — Electrum connect timeout destroys a late-arriving socket (server)

Finding: `electrum-connect-timeout-orphans-late-arriving-socket`.

Evidence: `electrumClient.ts:163-192` settled flag; `:238` / `:252` assign `this.socket` before `handleSuccess`, which returns early once settled, so a socket that connects after the timeout stays open and referenced.

Contract: once the connect attempt has settled by timeout (or error), a later connect/secureConnect destroys that socket, does not assign it to `this.socket` (or clears it), and logs at debug; the successful path is unchanged.

Failing tests first: electrum client unit test — connect timeout fires, then the socket emits connect → the socket is destroyed and `client.socket` is not the late socket. Prove red against `origin/main`.

Verification: server gates.

## Phase 6 — psbt/broadcast gets the broadcast timeout (server)

Finding: `psbt-broadcast-missing-extended-timeout`.

Evidence: `requestTimeout.ts:28-67` lists `/transactions/broadcast` but not `/psbt/broadcast`; both routes share `broadcastValidated` (`broadcasting.ts:440-452`).

Contract: the extended-timeout table matches `/api/v1/wallets/:id/psbt/broadcast` with the same timeout and reason as `/transactions/broadcast`.

Failing tests first: requestTimeout unit test — the psbt/broadcast path resolves the extended timeout (currently the default).

Verification: server gates.

## Phase 7 — hardware-wallet hook connect is generation-guarded (frontend)

Finding: `hardwarewallet-hook-connect-resurrects-after-disconnect`.

Evidence: `useHardwareWallet.ts:87-122` `connect` sets the device after its await unconditionally; `disconnect` nulls it synchronously and tears down in a detached promise.

Contract: a connect generation ref bumped by every `connect` and `disconnect`; a connect that resolves after a newer generation started does not set the device and disconnects the service-level session it created (so the device is not left connected underneath); loading/error state is applied only for the current generation.

Failing tests first: hook test — connect pending, disconnect, connect resolves → `device` stays null and the service disconnect was called for the late session. Prove red against `origin/main`.

Verification: frontend gates.

## Phase 8 — Trezor adapter connect/disconnect interleaving (frontend)

Finding: `trezor-adapter-connect-disconnect-interleave-resurrects-session`.

Evidence: `trezorAdapter.ts:196-220` three awaited round-trips then `setConnectedDevice` unconditionally; `:322-328` disconnect only clears the session; `ledgerAdapter.ts:136,200,259` shows the `connectGeneration` pattern.

Contract: mirror the Ledger adapter — a `connectGeneration` captured at connect start and checked before `setConnectedDevice`; a disconnect (or a newer connect) during the popups makes the stale connect return without setting the connection (throw the adapter's existing cancelled/disconnected error type, as Ledger does).

Failing tests first: adapter test — start connect, disconnect before `getPublicKey` resolves → `connection.connected` stays false. Prove red against `origin/main`.

Verification: frontend gates.

## Phase 9 — AI label suggestions are scoped to the selected transaction (frontend)

Finding: `ai-label-suggestion-cross-transaction-stale-overwrite`.

Evidence: `useAILabelSuggestion.ts:21-35`; `AILabelSuggestion.tsx:8-25`; `EditingLabelsPanel.tsx:14-30` (no key).

Contract: the hook keeps a ref of the current `transactionId`; a suggestion, error or loading update from a request whose id no longer matches is ignored; changing the transaction clears suggestion/error.

Failing tests first: hook test — request for A, switch to B, A resolves → no suggestion shown for B. Prove red against `origin/main`.

Verification: frontend gates.

## Phase 10 — pending transfers are scoped to the mounted resource (frontend)

Finding: `pending-transfers-panel-cross-resource-stale-overwrite`.

Evidence: `useTransferActions.ts:57-91`; `TransfersSection.tsx:13` (no key).

Contract: `fetchTransfers` and the action follow-ups apply state only while `resourceId`/`resourceType` are still current (ref or the directory's ownership-token pattern); switching resources clears the list synchronously.

Failing tests first: hook/component test — mount A, switch to B, resolve B then A late → list shows B's transfers only. Prove red against `origin/main`.

Verification: frontend gates.

## Delivery

One PR per phase, serial merges on `main`, each rebased only when it is next; target-branch CI verified after each merge; branches deleted only after the merge-commit ancestry gate. PR order: 3, 1, 2, 4, 5, 6 (server), 7, 8, 9, 10 (frontend). No container rebuild until the loop's clean pass (`--deploy final`).

## Completion criteria

All eleven findings resolved in run state with a target-CI-verified attempt record; a fresh full scrub (iteration 23) of the resulting main SHA finds zero P0–P2.
