# Bug scrub loop iteration 12: push delivery, timeframe contracts, and request ownership

## Run identity

- Iteration: 12
- Source target branch: `main`
- Source SHA: `9e3258201bf788a47ce92cb6f1144e656340dc42`
- Scope: whole repository, with emphasis on the seven confirmed findings from the complete eight-domain rescrub
- Deployment policy: defer all rebuilds until a later rescrub reaches zero P0-P2 findings

## Goal

Restore the configured mobile push path, drain accepted gateway push work during shutdown, make balance-history timeframe behavior match its API contract, and fence three frontend request owners so late results cannot replace current state.

## Non-goals

- Do not add durable or exactly-once push delivery, cross-process event acknowledgements, or retry storage.
- Do not merge the browser WebSocket and gateway push contracts.
- Do not redesign notification preferences or enable both backend and gateway push providers in one deployment.
- Do not change chart sampling, transaction accounting, audit-log filters, backup validation rules, or provider selection policy beyond the confirmed defects.
- P3 backlog remains outside the blocking fix set.

## Confirmed findings and evidence

### `gateway-push--missing-production-recipient` — P1

Normal transaction and first-confirmation events contain `walletId` and data but no recipient identity. `server/src/websocket/broadcast.ts` forwards that envelope unchanged, while `gateway/src/services/backendEvents/eventHandler.ts` rejects push events without `userId`. Worker events take the Redis path, whose API-process handler only rebroadcasts locally and never forwards to the gateway. Compose supplies FCM and APNs credentials only to the gateway, so the configured production path cannot deliver these events.

### `gateway-shutdown--inflight-push-drain` — P2

`gateway/src/services/backendEvents/index.ts` starts `handleEvent` without tracking its promise. `gateway/src/index.ts` stops the socket, shuts push providers, and exits after HTTP close without waiting for accepted device lookup or provider sends. The backend-to-gateway socket has no acknowledgement or replay.

### `aggregate-balance-history--invalid-timeframe-all-history` — P2

`server/src/api/transactions/crossWallet.ts` reads the raw timeframe. An unknown value falls through to an epoch start date and daily buckets even though OpenAPI permits only `1D`, `1W`, `1M`, `1Y`, and `ALL` with default `1W`. The sibling activity-summary route already uses the canonical schema fallback.

### `wallet-balance-history--all-truncated-five-years` — P2

`server/src/api/wallets/analytics.ts` maps `ALL` to five years and the repository applies that as a hard lower bound. A long-lived or imported wallet therefore loses older retained history although the endpoint advertises `ALL`.

### `audit-logs--stale-query-response` — P2

`src/components/AuditLogs/AuditLogs.tsx` applies every logs request completion to the table and total. A response for an older filter or page can overwrite the current query and can clear loading or install an error owned by a newer request.

### `backup-restore--stale-validation-result` — P2

`src/components/BackupRestore/hooks/useBackupHandlers.ts` does not associate validation with the uploaded file. Clearing A and uploading B while A remains pending lets A attach its result to B and clear B's spinner, enabling the destructive confirmation with the wrong validation result.

### `currency-providers--stale-list-persistence` — P2

`src/contexts/CurrencyPreferencesContext.tsx` has independent mount and reload requests with no common owner. A late old list can replace the current list and persist the `auto` fallback when it omits the selected provider.

## Assumptions and invariants

- Wallet push candidates are the distinct union of direct `WalletUser` users and members of the wallet's group, matching the established wallet-access union. The final audience contains only candidates whose stored per-wallet notification settings enable that exact transaction direction; confirmation enrichment resolves the persisted transaction direction before applying the same rule.
- Browser WebSocket payloads remain unchanged. Recipient enrichment exists only on the server-to-gateway path.
- The gateway accepts both the new `userIds` array and legacy singular `userId` during rollout.
- Redis delivery remains at most once. The API process forwards a received worker broadcast once and never republishes it.
- Accepted gateway push work drains before providers close; the existing ten-second forced-exit deadline remains the upper bound.
- Current public behavior for an invalid timeframe is fallback, not HTTP 400: aggregate defaults internally to `1W`; wallet-specific defaults to `1M` and reports that normalized value. The aggregate response remains its existing chart array and gains no timeframe field.
- `ALL` uses epoch as the repository lower bound so existing repository signatures and indexes remain compatible.
- Request generations own success, failure, loading, and teardown state. Clearing, replacing, or unmounting invalidates the prior generation.

## Phase 1 — Restore the gateway push recipient contract and worker bridge

### Production changes

- Factor the existing per-wallet notification eligibility check from `server/src/services/push/pushService.ts` into a pure shared server helper so the legacy backend channel and gateway producer cannot diverge on `enabled`, `notifyReceived`, `notifySent`, or `notifyConsolidation` semantics.
- Add a purpose-built repository read that selects wallet name, direct users and group members with their preferences, plus the persisted transaction direction needed by confirmation events. Return a deduplicated candidate set; do not send private preferences across the gateway boundary.
- Add a gateway-only event mapper under `server/src/websocket/` that filters candidates through the shared eligibility helper and enriches `transaction` and `confirmation` events with `walletName` and distinct eligible `userIds`. For confirmation events, also supply the persisted transaction type and amount required for eligibility and accurate formatting. A missing wallet or transaction produces an empty audience and an observable log entry.
- Make `GatewayWebSocketServer.sendEvent` asynchronous and serialize enrichment and sends on a private promise tail. Recheck authenticated/open connection state at send time and contain mapper failures without poisoning later sends.
- Update `server/src/websocket/broadcast.ts` to dispatch local-origin events through the asynchronous gateway method with an owned rejection log.
- Update the Redis broadcast handler in `server/src/websocket/server.ts` to send the normalized remote event to the gateway once after local broadcast. Do not republish it.
- Extend `gateway/src/services/backendEvents/types.ts` with optional `userIds`, retaining optional `userId` for compatibility.
- Update `gateway/src/services/backendEvents/eventHandler.ts` to normalize and deduplicate audience IDs, fetch each user's devices, deduplicate devices by stable ID, format once, send one batch, and remove each invalid device once. Empty audiences return without provider work.

### Regression tests first

- Repository and eligibility tests prove direct and group candidates are combined and deduplicated, disabled wallets are excluded, each disabled transaction direction is excluded, and missing-wallet, missing-transaction, and empty-audience cases fail closed.
- Gateway-server tests capture exact transaction and confirmation payloads, prove `walletName` and distinct `userIds`, preserve acceptance order through deferred audience reads, and prove a failed read does not block later events.
- Server Redis-handler tests prove a worker transaction reaches local clients and the gateway exactly once with no Redis republish; rejected gateway dispatch is logged and handled.
- Broadcast tests prove local-origin dispatch occurs once and an asynchronous dispatch rejection is contained.
- Gateway handler tests prove multi-user fanout, legacy singular compatibility, duplicate audience/device suppression, empty-audience behavior, and single invalid-token removal.

### Acceptance criteria

- An exact event emitted by production transaction code reaches every distinct eligible user's registered devices through the configured gateway and reaches no user whose wallet or matching transaction-direction notification is disabled.
- Worker-originated transaction and confirmation events use the same gateway mapping without looping through Redis.
- Browser clients receive the existing event shape.
- Event ordering is preserved across asynchronous audience lookup.

## Phase 2 — Drain accepted gateway event work on shutdown

### Production changes

- Track every accepted `handleEvent` promise in a backend-events in-flight set; remove it in `finally` and refuse new event work after shutdown begins.
- Make `stopBackendEvents` asynchronous: set shutdown state, clear reconnect ownership, close the socket, then await an all-settled snapshot of accepted work.
- Make the HTTP server-close cleanup path await backend-event drain before shutting push providers and exiting.
- Keep the force-exit timer armed until drain and provider cleanup complete so hung external work remains bounded by ten seconds.

### Regression tests first

- Defer device lookup and provider delivery and assert `stopBackendEvents` remains pending until each settles.
- Prove events received after shutdown admission closes are ignored.
- Prove a rejected handler is logged, removed from the registry, and does not block shutdown.
- Prove reconnect remains suppressed and provider shutdown/exit occurs after the drain. Extract a small cleanup helper only if direct index testing otherwise requires process-global coupling.

### Acceptance criteria

- Accepted push work settles before provider shutdown during normal graceful termination.
- New work is rejected after shutdown starts.
- A hung task still reaches the existing force-exit behavior.

## Phase 3 — Normalize balance-history timeframe contracts

### Production changes

- Use the existing `TimeframeSchema` for aggregate balance history so omitted or invalid values normalize to `1W` before start-date and bucket selection.
- Add equivalent typed parsing to wallet analytics with its documented `1M` default; return the normalized timeframe and use it in the cache key.
- Map wallet `ALL` to epoch rather than five years while leaving other ranges unchanged.
- Tighten the wallet balance-history OpenAPI parameter to the exact enum and default.

### Regression tests first

- Aggregate route: an invalid timeframe with an accessible wallet uses a roughly seven-day start date and day buckets.
- Wallet route: invalid input returns `1M`, uses the one-month cache identity and lower bound, and does not retain `INVALID` in the response.
- Wallet route: frozen-time `ALL` passes epoch to the repository and includes retained history older than five years in the integration boundary where practical.
- OpenAPI contracts assert the exact enum and default for both endpoints.

### Acceptance criteria

- Invalid and omitted values follow documented defaults consistently.
- `ALL` queries all retained wallet history.
- Existing valid timeframe cache keys and response shapes remain compatible.

## Phase 4 — Fence frontend request and file ownership

### Audit logs

- Replace the logs use of shared `useLoadingState` with component-local loading/error plus a logs request generation. Guard success, failure, and `finally` writes.
- Give stats its own generation because logs and stats run concurrently.
- Invalidate both generations during unmount cleanup; keep effect and refresh call sites stable.
- Add deferred reverse-success, reverse-error, and unmount tests in `tests/components/AuditLogs.test.tsx`.

### Backup restore

- Add an upload generation incremented before each non-empty file read and invalidated by clear and unmount.
- Clear filename, backup, validation, error, success, and validating state when a new owner begins.
- Guard file-read completion, parsed-file writes, validation success/failure/finally, and file-input reset with the captured generation.
- Guard both the upload read/parse catch and the validation catch so stale failures cannot install an error or emit a current-operation log.
- Add A-to-B reverse completion, stale rejection, clear-while-validating, and unmount tests in `tests/components/BackupRestore/useBackupHandlers.branches.test.tsx`.

### Currency providers

- Make `reloadAvailableProviders` the sole request path and give it one shared generation across mount, provider-change events, and manual reloads.
- Guard successful list application and failure fallback/logging; invalidate on unmount.
- Add reverse success and stale rejection tests in `tests/contexts/CurrencyContext/providerInit.test.tsx`, asserting the selected provider and persisted preference remain current.

### Acceptance criteria

- Only the current audit query owns rows, totals, errors, and loading.
- Only the current uploaded file owns validation and restore admission.
- Only the current provider request may apply a list or persist a fallback.
- Late completions after clear, replacement, or unmount produce no state mutation.

## Delivery sequence

1. Phase 1 server and gateway recipient contract in one PR because producer and consumer must remain rollout-compatible and the worker bridge depends on the mapper.
2. Phase 2 gateway drain in a separate PR after Phase 1 establishes all accepted work that must be tracked.
3. Phase 3 timeframe contract in an independent server PR.
4. Phase 4 frontend ownership in one PR because the fixes share the same generation-ownership pattern and frontend full-coverage gate.

Each phase branches from the latest verified `origin/main`, includes the exact reviewed plan revision, uses `$pr-delivery`, waits for all required PR checks, verifies squash ancestry/tree identity, and verifies exact landed target-branch CI before the next phase. Deployment remains deferred.

## Verification

Every Node command begins with `source "$HOME/.nvm/nvm.sh" && nvm use --silent`.

### Focused

- Phase 1: affected server websocket/repository tests and gateway backend-event transaction tests.
- Phase 2: gateway backend-event lifecycle and shutdown-order tests.
- Phase 3: `server/tests/unit/api/transactionsCrossWallet.test.ts`, wallet analytics contracts, and OpenAPI wallet contracts.
- Phase 4: `tests/components/AuditLogs.test.tsx`, `tests/components/BackupRestore/useBackupHandlers.branches.test.tsx`, and `tests/contexts/CurrencyContext/providerInit.test.tsx`.

### Broad gates before each push

- Relevant package typecheck and full tests for server or gateway phases.
- Root `npm run lint`, `npm run typecheck:app`, `npm run typecheck:tests`, and `npm run typecheck:all` for frontend or shared-import changes.
- Root full frontend tests and literal 100% coverage after Phase 4.
- `npm run check:architecture`, cycle, complexity, large-file, and generated architecture checks whenever imports or production file structure change.
- `git diff --check` and a final adversarial review for every phase.

### Final gates

- All required exact-commit Forgejo workflows green after every merge, including funds-safety vector and hardware emulator jobs selected for the change.
- A new complete eight-domain whole-repository rescrub at the final target SHA.
- Rebuild the already-running Sanctuary stack only after that scrub reports zero P0-P2 findings, then verify deployed commit labels, service health, and browser-routed readiness.

## Compatibility, rollback, and operational concerns

- No database migration is required.
- The new plural recipient field is additive; legacy `userId` remains readable through rollout and rollback.
- Audience enrichment is gateway-only, so browser WebSocket clients need no migration.
- The worker bridge forwards but never republishes Redis messages, preventing a loop. Gateway-side audience and device deduplication prevents duplicate delivery within one event.
- Push remains at most once and non-durable. This plan fixes deterministic recipient loss and graceful-drain loss without claiming replay guarantees.
- Backend and gateway provider credentials must retain one production owner. Current compose mounts them only into the gateway; the backend notification channel remains a separately configured fallback.
- Timeframe normalization changes invalid cache keys to their documented default and intentionally abandons any ten-second cache entries under invalid keys.
- `ALL` can read more history; repository filtering and the existing 100-point response sampling bound response size. Query cost is limited to one authorized wallet and indexed transaction history.
- Each phase can be reverted independently in reverse delivery order. Reverting Phase 1 requires reverting both producer enrichment and consumer plural-audience handling together; legacy singular compatibility reduces rolling-restart risk.

## Completion criteria

- All seven findings have failing-before and passing-after behavioral proof.
- The four phases are merged with exact target CI verified.
- The plan records final reviewed revisions, implementation commits, PRs, merge SHAs, and verification evidence.
- A later complete rescrub finds no P0, P1, or P2 defect across all eight required domains.
- Final deployment and loop-owned resource cleanup complete under repository custody rules.
