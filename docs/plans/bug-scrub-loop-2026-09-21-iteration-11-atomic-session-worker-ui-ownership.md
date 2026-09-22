# Bug Scrub Loop Iteration 11: Atomic Sessions and Async Ownership

## Provenance

- Iteration: 11
- Source target: `main` at `f412003ef62bcf9a7d8db97fbfbb8742d09ca801`
- Scope: whole repository
- Blocking findings:
  - `admin-users--password-session-split-commit` (P2)
  - `worker-shutdown--subscription-checkpoint-drain` (P2)
  - `ownership-transfer--former-owner-stale-detail` (P2)
  - `block-height--cross-network-stale-response` (P2)
  - `layout-connection--cross-network-stale-response` (P2)
- Deployment policy: defer all rebuilds to the outer loop's final clean pass.
- P3 backlog is outside this plan's blocking fix set.

## Goal

Make administrator credential changes atomic with session invalidation, drain accepted subscription checkpoint work before worker resource teardown, and prevent stale ownership or network responses from remaining authoritative in the UI.

## Non-goals

- No database schema, wire API, transfer state-machine, notification model, or product-policy changes.
- No redesign of the admin user, transfer, wallet, device, or layout UI.
- No attempt to drain unrelated worker timers without a demonstrated resource-ownership gap.
- No broad async-hook abstraction or unrelated repository refactor.
- No deployment between phases.

## Assumptions and evidence

### Admin credential/session atomicity

`server/src/api/admin/users.ts` commits `updateFromAdmin` and only then calls `revokeAllUserTokens`. Password-only updates in `server/src/repositories/userAdminUpdate.ts` use a standalone user update, while `server/src/services/tokenRevocation.ts` later increments `sessionVersion` and deletes refresh tokens. Failure of that second operation leaves the new password durable while old access and refresh credentials remain valid. `server/src/repositories/passwordSecurityRepository.ts` already demonstrates the required transaction boundary. Admin-role updates must preserve their serializable final-administrator guard and retry behavior.

### Worker subscription checkpoint shutdown ownership

`server/src/worker.ts` serializes address activity in per-script-hash promise tails, but the Electrum callback deliberately does not await `recordSubscriptionStatus`. Shutdown clears the tail map before stopping Electrum, Redis, and Prisma and can exit while an accepted checkpoint is still using those resources. The worker also lacks the hard graceful-shutdown deadline used by other process entry points. Existing worker entry and integration tests exercise serialization and shutdown separately, but do not defer a checkpoint across SIGTERM.

### Former-owner transfer reconciliation

Transfer confirmation can remove the former owner's access when `keepExistingUsers=false`. The wallet and device detail GET routes run their access middleware first, so the former owner's post-confirm read returns the canonical 403 denial before a handler-level 404 is reachable. Both completion callbacks return the generic `failed` result, so `useTransferActions` removes the committed transfer but leaves the detail route and its old data visible. The completion contract needs an explicit access-loss outcome, narrowly recognized only inside the still-owned successful-confirmation callback, so route owners can evict the inaccessible detail/list data and navigate to the collection. Other 403s and post-commit refresh failures must retain their current handling.

### Network request ownership

`BlockHeightIndicator` clears its height when the selected network changes but lets the previous request write afterward. `useLayoutNotifications` similarly lets a late connected response for network A remove the critical connection notification created for current network B. Interval cleanup stops future polls but does not revoke an already-running request. Existing tests cover ordinary polling and status outcomes, not reverse completion across a network change.

## Phase 1: Commit admin security updates atomically

### Production changes

- [x] Move password- or role-triggered durable session invalidation into the same Prisma transaction as the admin user update in `server/src/repositories/userAdminUpdate.ts`.
- [x] Increment `sessionVersion` and delete refresh tokens only when the committed transition changes the password or administrator role; return the transition metadata needed for logging and WebSocket cleanup without running a second database mutation.
- [x] Preserve one serializable transaction and the existing bounded conflict retry when `isAdmin` is present, including combined password-and-role changes and the final-administrator guard.
- [x] Keep non-security profile updates on the smallest existing path and avoid unnecessary session invalidation.
- [x] Update `server/src/api/admin/users.ts` to perform only post-commit side effects such as logging and `disconnectWebSocketUser`; do not call the database-backed `revokeAllUserTokens` after the repository commit.
- [x] Preserve the current response, audit, error, and revocation-reason contracts.

### Regression tests

- [x] Inject a refresh-token deletion failure and prove the password hash and `sessionVersion` update roll back together and the route does not audit or disconnect a change that did not commit.
- [x] Prove a password-only update commits the password, increments `sessionVersion`, deletes refresh tokens, and performs post-commit WebSocket cleanup once.
- [x] Prove a combined password/demotion update uses the guarded serializable transaction and cannot bypass the final-admin rule.
- [x] Prove a role no-op and ordinary profile changes do not invalidate sessions, while a real role-only transition does.
- [x] In the database integration contract, retain credentials minted before the reset and prove the old access token is rejected, refresh rows are gone, `sessionVersion` advanced, and login with the new password succeeds.

### Verification and acceptance

- [x] `cd server && npx vitest run tests/unit/repositories/userAdminUpdate.test.ts tests/unit/api/admin-routes.test.ts tests/unit/repositories/userRepository.test.ts tests/unit/services/tokenRevocation.test.ts`
- [x] `./scripts/run-integration-tests.sh tests/integration/flows/admin.integration.test.ts`; require the isolated database test to run rather than report a skipped suite, and require the guarded cleanup receipt to finish `cleaned`.
- [x] `npm run typecheck:all`
- [x] `npm run typecheck:server:tests`
- [x] Phase 1 acceptance: no observable database state can contain a newly committed admin-set password with the prior session version or refresh tokens, and the final-admin concurrency guard remains intact.
- [x] Deliver as one server security/persistence PR and verify exact head and squash-merge target CI before Phase 2.

### Phase 1 evidence

- Focused regression runs passed, including 244 tests in the final admin/repository audit set.
- The guarded admin integration suite ran 57 tests, including a real database-triggered refresh-token deletion failure that proved transaction rollback, and finished with cleanup state `cleaned`.
- Full frontend and server suites passed: 8,883 frontend tests and 16,453 server tests.
- Backend unit coverage passed at 100% for 41,006 statements, 23,127 branches, 8,736 functions, and 38,203 lines.
- Build, lint, both TypeScript checks, architecture boundaries, cycle baseline, complexity, large-file classification, diff check, adversarial review, and simplify/edge-case review passed.

## Between-phase reset

After every phase:

- [ ] Verify the phase merge commit is a real ancestor of refreshed `origin/main` and all exact target workflows are green.
- [ ] Re-read repository instructions and this plan from disk.
- [ ] Refresh open PRs and target SHA, then revalidate every remaining finding and caller against the new target.
- [ ] Start the next phase from refreshed `origin/main`, never from the prior topic head.

## Phase 2: Drain accepted subscription checkpoints on shutdown

### Production changes

- [x] Give `server/src/worker.ts` explicit ownership of every accepted address-activity checkpoint promise, including queued per-script-hash tails; the latest tail for a key must represent its complete predecessor chain.
- [x] Stop admission before beginning the drain so Electrum callbacks cannot add new checkpoint work after the drain snapshot.
- [x] Await all accepted checkpoint tails with `Promise.allSettled` before closing Electrum-dependent, Redis, or database resources; log failures without skipping the remaining teardown.
- [x] Add one named 30-second worker-wide hard shutdown deadline at shutdown start, following the API server's process-entry pattern; unref it, clear it on graceful completion, and force a failing exit if any teardown stage, including the drain, exceeds the bound.
- [x] Keep the normal drain unbounded inside that worker-wide deadline. Do not time out the drain and continue closing its dependencies while checkpoint code can still run.
- [x] Clear tail bookkeeping only after settlement, while preserving normal per-script-hash serialization and error recovery.
- [x] Keep unrelated interval work outside this change unless implementation evidence shows it shares the same accepted-work promise boundary.

### Regression tests

- [x] Defer a multi-page `recordStatusPage`, invoke `onAddressActivity`, signal shutdown, and prove Electrum stop, Redis/database teardown, and process exit all wait for the checkpoint to settle.
- [x] Queue two updates for one script hash and prove shutdown drains the full serialized tail, not only the currently running operation.
- [x] Reject a checkpoint and prove shutdown logs/settles the failure and still performs teardown exactly once.
- [x] Hold a checkpoint past the new worker-wide deadline and prove it logs the timeout and forces exit 1 without beginning dependency teardown beneath the active checkpoint.
- [x] Prove callbacks arriving after admission closes cannot start persistence work.

### Verification and acceptance

- [x] `cd server && npx vitest run tests/unit/worker/worker.entry.test.ts tests/integration/worker/worker.integration.test.ts`
- [x] Run the focused subscription-checkpoint runtime suite when shared helpers change.
- [x] `npm run typecheck:all`
- [x] `npm run typecheck:server:tests`
- [x] Phase 2 acceptance: shutdown never tears down dependent resources while accepted address-activity checkpoint work is still eligible to complete, and a stuck operation remains bounded by the documented shutdown deadline.
- [x] Deliver as one worker lifecycle PR and verify exact head and squash-merge target CI before Phase 3.

### Phase 2 evidence

- Five failing-before worker entrypoint regressions demonstrated multi-page truncation, queued-tail truncation, rejection escape, the missing deadline, and post-shutdown admission; all pass after the lifecycle fix.
- The focused worker entrypoint and integration suites pass 47 tests, and the extracted shutdown lifecycle module keeps the production entrypoint below the repository's 1,000-line limit.
- Backend unit coverage passes at 100% for 41,017 statements, 23,127 branches, 8,738 functions, and 38,212 lines.
- Full frontend and server suites pass 8,883 and 17,230 tests respectively; the server total includes 16,462 passed tests, 767 guarded skips, and one existing todo.
- Build, lint, both TypeScript checks, architecture boundaries and generated graphs, cycle baseline, complexity, large-file classification, independent adversarial review, and simplify/edge-case review pass.

## Phase 3: Reconcile former-owner access loss after transfer

### Contract and production changes

- [x] Extend `TransferCompletionResult` with one explicit access-removed outcome that is distinct from `committed`, `superseded`, and generic refresh `failed`.
- [x] Recognize the repository's canonical 403 access denial as access removal only after a successful transfer confirmation and while the initiating resource route still owns the callback; preserve generic handling for every other context and for network, server, parsing, and other refresh failures.
- [x] Keep the data hooks responsible for API/state reconciliation: after their existing route-ownership check inside the successful-confirm callback, classify `ApiError` 403 as `access-removed`; do not create a global rule that interprets arbitrary 403 responses as resource removal.
- [x] Add a small shared transfer-access cache helper so the near-400-line wallet and device detail hooks do not absorb duplicate cache logic. It must synchronously filter the inaccessible ID from `walletKeys.lists()` or `deviceKeys.lists()`, remove the detail query, then invalidate the list for server truth.
- [x] Keep navigation in the existing route-owning boundaries: wrap the wallet completion callback in `useWalletDetailController` and the device callback in `DeviceDetailContent`, await the cache reconciliation, recheck current route ownership, then replace-navigate to `/wallets` or `/devices` before returning `access-removed`.
- [x] Keep cache cleanup on the existing React Query keys and client; do not introduce a second global cache system. Safe cache eviction may finish after route supersession, but a stale callback must never navigate the newer route.
- [x] Teach `useTransferActions` to treat access removal as a successful terminal reconciliation: remove the transfer locally, close the modal, release loading, avoid the generic access-refresh error, and skip the now-irrelevant transfer-list refetch on the route that is leaving.
- [x] Preserve the current committed, superseded, rejected-callback, transfer-list-refresh, and route A→B→A ownership behavior.

### Regression tests

- [x] Confirm a wallet transfer, seed its list/detail query data, make the post-confirm wallet read return the canonical 403 denial, and prove the ID is absent from cache at navigation time, stale detail is no longer rendered, and replacement navigation goes to `/wallets` only while the initiating route still owns the action.
- [x] Cover the equivalent device path and `/devices` navigation.
- [x] Prove 403 outside the successful-confirm callback and non-access refresh failures stay on their existing paths and do not trigger access-removal navigation.
- [x] Switch routes before the inaccessible response settles and during list invalidation; prove safe cache eviction may complete but the stale callback cannot clear or navigate the newer route.
- [x] Prove `useTransferActions` handles the access-removed result without retrying the committed mutation or retaining an actionable transfer card.

### Verification and acceptance

- [x] Run focused `PendingTransfersPanel`, wallet sharing/detail, device data/detail, and collection-state tests selected from changed files with `config/tooling/vitest.config.ts`.
- [x] `npm run typecheck:app`
- [x] `npm run typecheck:tests`
- [x] Phase 3 acceptance: a successful transfer that removes the initiating user's access cannot leave stale resource detail or collection state visible, while unrelated reconciliation failures and superseded routes keep their current semantics.
- [ ] Deliver as one frontend transfer-ownership PR and verify exact head and squash-merge target CI before Phase 4.

## Phase 4: Fence network-specific status responses

### Production changes

- [ ] Add effect-local activity and a monotonic request generation in `BlockHeightIndicator` so only the newest poll in the current selected-network effect may update height or tick state.
- [ ] Track the effect's current height outside the state updater, own and clear the tick-reset timeout as well as the polling interval, and prevent an older timeout from ending a newer animation.
- [ ] Fence both successful and failed connection checks in `useLayoutNotifications` with effect activity plus a per-poll generation so a settled request may add or remove `connection_error` only while it is the newest request in the current user/network effect.
- [ ] Preserve the exported `checkBitcoinConnection` helper's direct behavior where tests or callers rely on it; pass an explicit ownership predicate rather than adding hidden global state.
- [ ] Preserve polling intervals, admin action metadata, fallback messages, and draft-notification behavior.

### Regression tests

- [ ] Defer block-height request A, switch to B, resolve B, then resolve A and prove B's height and title remain paired.
- [ ] Start overlapping polls on one network, resolve the newer one first, and prove the older response cannot replace it.
- [ ] Switch networks while the tick animation timeout is active and prove the old timeout cannot alter the new effect's tick state; unmount with all timers owned and cleared.
- [ ] Defer connection request A, switch to B, resolve B disconnected, then resolve A connected and prove B's critical notification remains.
- [ ] Cover the inverse stale failure, overlapping same-network polls, and unmount paths so an old request can neither add nor remove a current notification.
- [ ] Preserve ordinary initial checks, interval polls, connected/disconnected outcomes, and admin/non-admin actions.

### Verification and acceptance

- [ ] `npx vitest run --config config/tooling/vitest.config.ts tests/components/Layout/BlockHeightIndicator.test.tsx tests/components/Layout/useLayoutNotifications.test.tsx tests/components/Layout.test.tsx tests/components/Layout.branches.test.tsx`
- [ ] `npm run typecheck:app`
- [ ] `npm run typecheck:tests`
- [ ] Phase 4 acceptance: only the current network effect can write height, animation, or connection-notification state, including reverse completion and unmount.
- [ ] Deliver as one frontend layout-ownership PR and verify exact head and squash-merge target CI.

## Broad verification after each phase

- [x] `npm run typecheck:all`
- [x] `npm run test:run`
- [x] `npm --prefix server run test:run`
- [x] `npm run typecheck:server:tests`
- [x] `npm run build`
- [x] `npm run lint`
- [x] `npm run check:architecture-boundaries`
- [x] `npm run check:server-cycle-baseline`
- [x] `npm run quality:lizard`
- [x] `node scripts/quality/check-large-files.mjs`
- [x] Run changed-package coverage and preserve the repository's literal 100% thresholds.
- [x] For frontend phases, build and run the fully mocked Playwright render regression against a temporary static server; never start a host development server.
- [x] Run an adversarial implementation review and a simplify/edge-case review before each delivery.

### Phase 3 evidence

- Focused transfer, wallet, device, query-key, and route-ownership suites pass 192 tests; the final extracted wallet wrapper and StrictMode device lifecycle regressions pass their focused 16-test and 3-test suites.
- Full frontend and server suites pass 8,894 and 17,230 tests respectively before the final no-behavior extraction; the final full frontend coverage run passes 8,896 tests at literal 100% statements, branches, functions, and lines.
- TypeScript app/test/all gates, build, lint, architecture boundaries and generated diagrams, server cycle baseline, complexity, and large-file classification pass.
- The fully mocked Chromium render regression passes all 44 routes against the production preview server.
- Independent adversarial review found and verified the StrictMode mounted-flag correction, then completed a clean re-review of the final diff.

No phase adds an endpoint, so OpenAPI coverage and Playwright API mock maps should not require new routes. Exact PR-head and landed-target CI remain mandatory for every phase.

## Compatibility, rollback, and cleanup

- Database/API compatibility: no schema, migration, response shape, or external wire change. The admin update refactor changes only transaction ownership and post-commit side effects.
- Concurrency: admin role/password combinations must share one guarded transaction; worker drain admission must close before its promise snapshot; UI callbacks must recheck route/effect ownership after every await.
- Cache/state: use existing wallet/device collection refresh or invalidation facilities and clear only the inaccessible resource's current detail state.
- Rollback: each phase is independently revertible after its target CI passes. Reverting Phase 1 restores the split security update and therefore requires immediate redelivery rather than operational acceptance.
- Cleanup: do not delete loop branches, the worktree, or the safety stash without the exact one-off permission required by `AGENTS.md`. Keep deployment deferred until a later complete whole-repository scrub finds zero P0-P2 defects.

## Completion criteria

- [ ] All five findings have failing-before and passing-after behavioral regressions.
- [ ] All four phase PRs are merged serially and their exact target-branch workflows pass.
- [ ] The reviewed implementation plan revision, PR heads, merge commits, and target CI evidence are recorded in durable loop state.
- [ ] A fresh complete eight-domain scrub runs against the final target SHA; deployment occurs only after a zero P0-P2 pass.
