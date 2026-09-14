# Iteration 21 — P1/P2 remediation plan

- Iteration: 21 (bug-scrub-loop run `bug-scrub-loop-20260912t210000z-p2-backlog`)
- Source target-branch SHA: `8a3ecccc7a2693f2822b16a585c7735db21cdf1d` (main after PR #1150)
- Scope: whole repository
- Blocking findings (coordinator-reconfirmed at source):
  P1 `spending-limit-velocity-toctou-concurrent-broadcast-bypass`;
  P2 `psbt-create-route-skips-address-validation-before-500`,
  `telegram-draft-notify-always-reports-fabricated-success`,
  `price-context-stale-currency-response-race`,
  `review-address-lookup-out-of-order-overwrite`,
  `draftlist-delete-stale-closure-lost-update`.
- P3 backlog (outside the blocking fix set; `wallet-webhooks-switch-reset-misses-error-and-form` is NOT folded in): `dead-legacy-utxo-selector-bypasses-spendability-source-of-truth`, `transactionactions-rbf-navigate-fires-after-unmount`, `wallet-webhooks-switch-reset-misses-error-and-form`, `prepare-integration-db-migrate-exit-code-ignored`, `npm-ci-callsite-gate-bypassable-via-trailing-comment`, plus the earlier P3 items in run state.

## Goal, non-goals, assumptions

Goal: fix the six blocking findings with a failing regression test per finding, in six independently mergeable phases, without schema migrations.

Non-goals: redesigning policy evaluation beyond the usage-window reservation; a generic frontend cancellation layer; changing the Telegram draft message content.

Assumptions: main is green (target CI verified through `5a3d9265`; `8a3ecccc` pending at plan time); repository rules apply (tests-first; no `catch (error: any)`, `console.log`, `@ts-ignore`, empty catch; backend coverage scoped to `tests/unit`; lizard exactly 86; `check-large-files.mjs`; `arch:check` output committed; server `typecheck:tests`; `prisma.*` only in repositories; no new migrations — `PolicyUsageWindow` already has `totalSpent`/`txCount` and a uniqueness on (policy, wallet, user, windowType, windowStart), so a conditional increment needs no schema change). Sync-path repository calls must stay inventoried in `config/wallet-sync-mutation-boundaries.json` (Phase 1 does not touch sync phases). No wallet-safety pinned file is touched.

## Phase 1 — spending-limit and velocity usage is reserved atomically before broadcast (server, P1)

Finding: `spending-limit-velocity-toctou-concurrent-broadcast-bypass`.

Evidence: `policyEvaluationEngine.ts:503-533` (`evaluateSpendingLimit`) and `:608-639` (`evaluateVelocity`) read the window via `policyRepository.findOrCreateUsageWindow` (`policyRepository.ts:435-488`, plain `findFirst` then `create`) and compare `used + amount > limit`; `broadcasting.ts:306-311` calls `policyEvaluationEngine.recordUsage(...)` without `await`, only after `broadcastAndSave` succeeded; `incrementUsageWindow` (`policyRepository.ts:491-500`) is an unconditional `increment`. Two broadcasts each under the limit but jointly over it both pass.

Contract:
- New repository function `reserveUsageWindow({ windowId, amount, spendLimit, txLimit })` performs a conditional increment, applying only the clause(s) that the calling policy type actually limits (mirroring `evaluateSpendingLimit`, which checks only `totalSpent`, and `evaluateVelocity`, which checks only `txCount`): a `spendLimit`-bearing call passes `totalSpent: { lte: spendLimit - amount }` only, a `txLimit`-bearing call passes `txCount: { lt: txLimit }` only; `updateMany where { id, ...that clause }`, returning `count`. A `count === 0` result means the reservation lost; the caller re-reads the window for the reason text.
- New repository function `releaseUsageWindow({ windowId, amount })` decrements (`totalSpent: { decrement }`, `txCount: { decrement: 1 }`, both floored at 0 via a guarded `updateMany where totalSpent >= amount`). `policyRepository.ts:504-511` already has an unconditional, floor-less `decrementUsageWindow` with zero production callers (only its own unit test exercises it, `policyRepository.usage-export.contracts.ts:212-216`) — reuse/rename that function for the floored release instead of adding a second decrement path; if it is kept as-is, the plan must say why both coexist.
- `assertPolicyAllows` in `broadcasting.ts` becomes `reservePolicyUsage`: evaluation runs as today for monitor/reporting, but for every enforce-mode `spending_limit`/`velocity` policy the engine reserves each window with `reserveUsageWindow` BEFORE `broadcastAndSave`; a lost reservation throws `ForbiddenError('Transaction blocked by vault policy')` and releases any reservations already taken in this request. On broadcast failure (any throw after reservation) the reservations are released in the failure path (awaited, logged on release failure). On success, no post-broadcast `recordUsage` for those windows (the reservation is the record); `recordUsage` stays for monitor-mode policies only and becomes awaited (`await`, errors logged).
- Monitor-mode policies keep read-only evaluation. Approval/other policy types unchanged.
- `getWindowBounds` and the window-record shapes are reused; no schema change.

Failing tests first (red against `origin/main`): engine/broadcast contract — two concurrent broadcasts of 600k against a 1,000,000 daily limit: exactly one is blocked and the window never exceeds the limit (drive the repository mock so the second reservation returns `count 0`); a broadcast that fails after reservation releases it; monitor-mode policies never reserve; repository tests for the conditional shapes of `reserveUsageWindow`/`releaseUsageWindow`. Route supertest: the blocked broadcast returns 403 with the policy message.

Verification: server gates (tsc, `typecheck:tests`, lint, architecture boundaries, unit coverage 100 on `tests/unit`, lizard, large-files, `arch:check`, `git diff --check`). Backout: revert the phase; the schema is untouched.

## Phase 2 — psbt/create validates the address and maps it to 400 (server)

Finding: `psbt-create-route-skips-address-validation-before-500`.

Evidence: `drafting.ts:270-305` has no `validateAddress` call while `:44` and `:96` do; `createTransaction.ts:84-88` throws plain `Error('Invalid recipient address')`.

Contract: the psbt/create route validates the recipient with `validateAddress(address, network)` exactly like its siblings (400 `ValidationError`/`InvalidInputError` with the same message shape); `createTransaction.ts` converts the `addressToOutputScript` failure to `InvalidInputError('Invalid recipient address', 'recipient')` so any other caller also gets 400.

Failing tests first: route supertest — psbt/create with a malformed address → 400 (currently 500); service contract — invalid recipient → `InvalidInputError`.

Verification: server gates. `createTransaction.ts` is not a wallet-safety pinned file (pins: `utxoSelection.ts`, `outputBuilder.ts`, `createBatchTransaction.ts`, `advancedTx/{batch,cpfp,rbf}.ts`); confirm with `rg createTransaction.ts config/wallet-safety-mutation-map.json` before editing and re-pin if that changes.

## Phase 3 — Telegram draft notifications report real outcomes (server)

Finding: `telegram-draft-notify-always-reports-fabricated-success`.

Evidence: `channels/telegram.ts:81-96` returns `{ success: true, usersNotified: 1 }` after `notifyNewDraft`; `telegram/notifications.ts:258-286` catches and logs; `:181-197` `sendDraftNotification` warns on failure without throwing.

Contract: `notifyNewDraft` returns `{ success, usersNotified, error?, recorded? }` mirroring `pushService.notifyNewTransactions` (#1137): lookup failure → `success: false`; per-recipient send failures are counted and the result is `success: false` when zero recipients were delivered (or when any lookup threw), `usersNotified` = delivered count; the channel maps the result through (`recorded: false` unless the Telegram path self-records). Zero eligible recipients → `success: true, usersNotified: 0`.

Failing tests first: `telegram/notifications` unit — all sends fail → `success: false, usersNotified: 0`; partial → counts; lookup throws → `success: false`; channel test → failed result mapped, not fabricated success; job helper already records unrecorded failures (assert with the existing `recordChannelDeliveryFailures` test pattern).

Verification: server gates + `arch:check` (the notifications call graph may change; commit the regenerated doc).

## Phase 4 — price refresh applies only the latest request (frontend)

Finding: `price-context-stale-currency-response-race`.

Evidence: `PriceContext.tsx:53-73` sets price state after `await` with no token; `:77-81` effect plus 60 s interval.

Contract: `refreshPrice` captures a request id (ref incremented per call and per currency/provider change); results, errors and loading from a superseded request are ignored; the effect cleanup bumps the id so an unmounted/re-keyed provider drops in-flight responses.

Failing tests first: PriceContext test — switch currency while the first fetch is pending; resolve the first after the second → `btcPrice` is the second currency's value; a stale rejection does not set `priceError`.

Verification: frontend gates (typecheck app/tests/all, lint, coverage 100%, lizard, large-files, `arch:check`, `git diff --check`).

## Phase 5 — review address lookup is generation-guarded (frontend)

Finding: `review-address-lookup-out-of-order-overwrite`.

Evidence: `useReviewAddressLookup.ts:20-30` `lookupAddresses(...).then(setAddressLookup)` with no cleanup.

Contract: the effect carries a cancelled flag in its cleanup; a superseded lookup's result is ignored; the lookup for the latest address set always wins.

Failing tests first: hook test — first lookup resolves after the second (larger) set's lookup → the displayed lookup is the second; the first result is ignored.

Verification: frontend gates.

## Phase 6 — draft deletion updates from the latest list (frontend)

Finding: `draftlist-delete-stale-closure-lost-update`.

Evidence: `useDraftListController.ts:88-99` filters the closure's `drafts` after `await`; `DraftRowActions.tsx:105` allows confirming another row while a delete is pending.

Contract: `handleDelete` uses a functional update (`setDrafts(prev => prev.filter(...))`) and reports the count from the updated list (derive `onDraftsChange` from a ref or from the functional update's result); the controller's `drafts` dependency drops out of the callback. Optionally disable other rows' confirm while a delete is in flight — in addition, not instead.

Failing tests first: controller test — two deletes confirmed back-to-back; both resolve → neither draft is present and `onDraftsChange` was last called with the correct remaining count (red on `origin/main`: the first-deleted draft reappears).

Verification: frontend gates.

## Delivery

One PR per phase, serial merges on `main`, each rebased only when it is next; target-branch CI verified after each merge; branches deleted only after the merge-commit ancestry gate. PR order: 1 (P1), 2, 3 (server), 4, 5, 6 (frontend). No container rebuild until the loop's clean pass (`--deploy final`).

## Completion criteria

All six findings resolved in run state with a target-CI-verified attempt record; a fresh full scrub (iteration 22) of the resulting main SHA finds zero P0–P2.
