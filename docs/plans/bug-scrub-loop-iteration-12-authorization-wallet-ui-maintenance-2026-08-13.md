# Bug Scrub Loop Iteration 12: Authorization, Wallet UI, and Maintenance Correctness

## Objective

Resolve every P0-P2 defect confirmed by the fresh whole-repository scrub at
`ca7d53792392fa07e0901a84260b60abadc129c3`. Deliver three independently
releasable phases through reviewed head CI, merge verification, and exact
target-SHA CI, then return control to the loop for another locked-scope scrub.

## Scope and Confirmed Findings

1. **P1 — websocket-wallet-authorization-revocation-not-enforced.** A client
   authorized only at subscribe time keeps receiving private wallet events after
   direct/group access removal, user/session invalidation, or access-token expiry.
2. **P1 — admin-final-administrator-demotion-lockout.** Concurrent or ordinary
   admin updates can demote the final administrator and leave no supported route
   to restore administration.
3. **P2 — wallet-sparkline-stale-after-balance-change.** Balance history is
   reconstructed with each wallet's current balance, but the query identity
   includes only wallet IDs and may show the previous balance for two minutes.
4. **P2 — wallet-sparkline-fabricated-on-history-error.** Failed or insufficient
   history is rendered as a deterministic invented trend derived from the current
   balance, misrepresenting financial history.
5. **P2 — wallet-import-network-change-retains-preview.** Changing the active
   Bitcoin network preserves chain-bound import state, and an older validation
   completion can advance or populate the new-network workflow.
6. **P2 — maintenance-weekly-reindex-physical-table-name-mismatch.** The default
   weekly job quotes Prisma model names `Transaction` and `UTXO`, while the
   physical PostgreSQL tables are `transactions` and `utxos`.

The three accepted P3 findings from this scrub remain recorded backlog and do
not block this iteration: sync live-owner reset at API startup, stuck-sync start
time semantics, and repeated price currencies producing a 500 response.

## Non-Goals

- Redesigning WebSocket event payloads, adding new client-visible channels, or
  replacing Redis pub/sub.
- Changing wallet-sharing role semantics, administrator creation policy, wallet
  balance-history calculation, or the import API contract.
- Broad maintenance-job/repository consolidation beyond removing the incorrect
  physical table identifiers.
- Addressing the accepted P3 backlog in this implementation cycle.

## Required Invariants

- A private event is sent only to a currently authenticated client with current
  authorization for its wallet. Access-token expiry, JTI/session revocation,
  user deletion, role/security updates, direct unshare, group unshare, and group
  membership loss invalidate affected local and remote-instance subscriptions.
- Every private fanout revalidates the stored access-token claims and, for
  wallet events, the current wallet access set before sending. Revocation
  control eagerly closes/removes stale clients, but Redis delivery is only an
  optimization: a lost control message cannot authorize the next private event.
  A database/revocation lookup failure suppresses that event for the affected
  client rather than failing open.
- Revocation messages contain identifiers only, use a versioned validated
  envelope, ignore self-publication exactly once, and cannot be confused with
  user-facing broadcast events.
- No successful admin role update or user deletion can commit a database state
  with zero admins. Both mutations use the same serializable, bounded-retry
  admin-floor protocol, so demotion/demotion and demotion/deletion races cannot
  pass stale counts. A failed guard does not revoke sessions, mutate/delete the
  user, disconnect sockets, or emit a success audit.
- Sparkline cache identity covers every input consumed by its query function.
  A missing, short, or failed history is represented as unavailable and never
  converted into invented movement.
- Import state that is meaningful only for one network is reset synchronously
  when network ownership changes. An older validation/import/hardware result or
  `finally` path cannot mutate the new generation or submit old data under the
  new network. The user-entered wallet name may remain only if it has not been
  replaced by an old validation suggestion.
- Weekly maintenance uses only an allowlist of real physical table names and
  preserves timeout reset, progress, cancellation, audit, and injection-safety
  behavior.
- New or edited production functions remain at `CCN <= 15`; growing modules are
  split into focused helpers before crossing repository size thresholds.

## Phase 1 — WebSocket Revocation and Administrator Safety

### Regression tests first

- [ ] Add WebSocket unit/Redis bridge tests proving that a versioned control
  message reaches other instances but is not exposed as a client event, self
  messages are deduplicated, malformed/unknown controls fail closed, and bridge
  shutdown removes both broadcast and control handlers. Because an invalid
  envelope has no trustworthy target, fail closed means reject it, increment an
  error metric/log safe metadata, and rely on mandatory send-time revalidation;
  it must not disconnect arbitrary clients.
- [ ] Add client-server tests proving every private fanout revalidates current
  token claims and wallet authorization before send, batches wallet/user reads
  per event, and suppresses delivery on lookup failure. Prove wallet invalidation
  removes only the affected user's unauthorized wallet channels, decrements
  subscription metrics once, preserves authorized/global subscriptions, and
  handles repeated control messages idempotently. Cover user-wide and JTI-specific
  disconnect controls, close/error races, and access-token expiry timers.
- [ ] Add route/service tests for direct user unshare, wallet group replacement,
  and group membership removal. Commit the database mutation first, then attempt
  eager local subscription invalidation and publish remote invalidation before
  returning the committed result.
  A post-commit eager-invalidation failure is observable but does not misreport
  the committed mutation or weaken the next fanout's fail-closed gate. Enumerate
  all repository/service callers that can remove
  wallet access and prove each invokes the shared post-commit invalidator. Cover
  ownership-transfer confirmation with `keepExistingUsers` both true and false.
- [ ] Add auth/session tests for logout, logout-all, targeted session revoke,
  password/admin security changes, and user deletion. Prove the exact JTI or
  user disconnect is issued only after durable revocation/update succeeds and
  all other users/sessions remain connected.
- [ ] Add real-database or barrier-controlled repository tests showing one-admin
  demotion is rejected, a demotion succeeds when another admin exists, two
  concurrent demotions and a concurrent demotion/deletion cannot leave zero
  admins, retry exhaustion is a conflict, and unrelated profile updates remain
  unchanged. Route tests must prove rejected demotion/deletion has no token
  revocation, socket control, or success audit. Add a barrier race where
  the route's preflight user snapshot becomes stale before the transaction; the
  committed role/password transition must still drive the correct post-commit
  session revocation and WebSocket control.

### Implementation

- [ ] Extend `AuthenticatedWebSocket` with the minimum verified access-token
  identity required for lifecycle enforcement (`jti`, expiry, and session
  version). Populate it for upgrade and message authentication, arm one expiry
  timer per authenticated connection, clear it during centralized disconnect,
  and close at the signed expiry before any later private send.
- [ ] Add a private, versioned Redis control envelope alongside the existing
  broadcast envelope, with explicit controls for disconnecting a user,
  disconnecting one access JTI, and revalidating one wallet's subscriptions.
  Keep parsing/type guards and handler registration in `redisBridge.ts`; keep
  socket/map/metric mutation in `clientServer.ts`; wire both handlers in
  `websocket/server.ts` and make async handler errors observable.
- [ ] Extract idempotent subscription removal and client close helpers in
  `clientServer.ts`. Make local fanout async: validate each distinct client's
  current token claims once per event, load the canonical wallet access set once
  per wallet event, and send only to the intersection. Wallet controls use the
  same validator to eagerly remove unauthorized subscribers and never enter the
  ordinary event channel. User/JTI controls close matching clients through normal
  cleanup. Redis callbacks and direct broadcasters must await or explicitly
  observe rejected fanout promises so no unhandled rejection is introduced.
- [ ] Introduce a small WebSocket authorization invalidation service that first
  applies the control to the initialized local server and then publishes it to
  Redis. Use it post-commit from `api/wallets/sharing.ts` direct unshare and group
  reassignment, plus `adminGroupService.ts` member replacement/removal and group
  deletion. Repository/service results must return the affected wallet IDs and
  removed user IDs from the same committed intention so invalidation does not
  rediscover a now-deleted relation. `transferService/confirm.ts` must likewise
  return the previous owner/access change from its serializable commit and
  invalidate post-commit. Wire JTI controls from refresh-token rotation,
  `refreshTokenService.revokeSession`, and `revokeLogoutCredentials`, and user
  controls from `tokenRevocation.revokeAllUserTokens`, admin security updates,
  and user deletion. Rotation closes only the consumed access JTI, not the newly
  issued or sibling session sockets.
  Preserve background processes where no client WebSocket server is initialized.
  Publication failure is observable but does not weaken the per-event
  authorization gate.
- [ ] Add a serializable, bounded-retry user-repository operation for the full
  admin user update when it contains an admin-role change. Read the target and
  current admin count inside each transaction, reject a transition that would
  leave zero, update with the caller's select,
  and classify serialization conflicts with the existing Prisma helper. Apply
  the prepared username/email/password/role update together inside the guarded
  transaction and return both the selected user and security transitions computed
  from the target reread in the successful transaction. Keep uniqueness/password
  preparation outside, but derive the post-commit revocation reason from that
  committed result—not the route's preflight snapshot—and perform token revocation
  and audit only after the guarded update commits.
  Route administrator deletion through the same protocol: reread the target and
  count administrators inside the transaction, reject deleting the final admin,
  and return committed identity for post-commit logging/audit. Delete first so
  foreign-key cascades durably invalidate refresh state, then issue the eager
  user WebSocket disconnect; a rejected/failed delete has no security side
  effects or success audit.
- [ ] Run focused WebSocket, Redis, sharing, auth/session, admin-user, repository,
  integration, metric, and architecture-boundary tests; server source/test
  typechecks; lint; targeted coverage; complexity checks; and an adversarial
  review of cross-instance, expiry, repeated-message, and failure ordering.

### Compatibility, rollout, and rollback

- No schema or public API migration is expected. Redis control envelopes are
  additive and versioned; older instances ignore their separate channel during a
  rolling deploy, so deployment must drain/restart all backend replicas before
  claiming immediate cross-instance revocation. Rollback restores the prior
  behavior without data conversion. Logs/metrics must distinguish local control
  failure, remote publication failure, and ordinary client closure without
  logging JWTs.

## Phase 2 — Truthful Sparkline and Network-Owned Import State

### Regression tests first

- [ ] Extend `useWalletSparklines` tests with a deferred rerender whose wallet ID
  is unchanged and balance changes. Prove the old request/cache cannot populate
  the new balance key and that reordering wallets has deterministic identity.
- [ ] Add hook/component tests that distinguish success, fewer than two real
  points, and request error. Only successful histories render real paths; missing
  and failed histories render an accessible unavailable/empty treatment with no
  synthetic SVG path or implied direction.
- [ ] Add deferred import tests that change mainnet/testnet while validation is
  pending, after validation succeeds, on the review step, and while hardware/QR
  work is pending. Prove chain-bound state resets, old resolve/reject/finally
  paths cannot advance or set errors/loading, and import cannot submit retained
  old-network data. Cover rapid A-B-A changes and unmount. Exercise stale
  resolve/reject/finally commits from both `steps/useHardwareImportActions.ts`
  and `steps/useQrScanHandlers.ts`.

### Implementation

- [ ] Build the sparkline query key from a stable sorted list of wallet ID and
  current balance pairs, matching every closure input while avoiding a refetch
  on presentation-only reorder. Return an explicit per-wallet discriminated
  result (`ready` with at least two values, `unavailable`, or `error`) instead of
  omitting failures from a number-array map.
- [ ] Update wallet-list data/card contracts and `WalletGridCardSparkline.tsx`
  to render a real line only for `ready`. Remove `DecorativeSparkline`; keep card
  layout stable with a neutral non-directional empty state and a concise
  accessible label. Do not retain prior-wallet/balance placeholder data under a
  changed query identity.
- [ ] Give `useImportState` a monotonic network generation and a centralized
  network-change reset for step, format/data, validation, import, hardware, QR,
  decoder, errors, and loading ownership. Refactor import actions/helpers to
  snapshot `{network, generation}` before awaits and commit state only when the
  owner remains current; abort network-capable requests where supported and use
  generation checks for APIs that cannot abort. Disable final import while a
  transition or validation owner is stale. Thread the same owner explicitly
  through `steps/useHardwareImportActions.ts` device connection/xpub callbacks
  and `steps/useQrScanHandlers.ts` dynamic import, decoder, resume, and error
  callbacks; unmount invalidates both paths.
- [ ] Run focused wallet-query/list/sparkline/import tests, frontend typechecks,
  lint, full frontend tests, targeted coverage, complexity checks, and an
  adversarial review of cache identity, stale promises, A-B-A transitions, and
  truthful empty/error rendering.

### Compatibility, rollout, and rollback

- Query cache shape changes are internal and ephemeral; no persistent cache or
  API migration is required. Network changes intentionally discard an in-flight
  import draft because its descriptor/preview is chain-bound. Rollback requires
  no data conversion. The UI must not emit noisy logs for expected ownership
  cancellation, while genuine current-owner validation/import failures retain
  existing user-facing errors.

## Phase 3 — Physical-Table Maintenance Correctness

### Regression tests first

- [ ] Add a weekly-job regression that captures every raw SQL template for the
  default path and asserts `audit_logs`, `transactions`, and `utxos` are the only
  reindexed physical tables. Explicitly reject quoted Prisma model identifiers.
- [ ] Cover a caller-supplied subset, an unknown table, cancellation between
  tables, a REINDEX failure, timeout restoration in `finally`, progress, and
  successful audit contents. Unknown input must reject before any progress,
  `SET statement_timeout`, `VACUUM`, REINDEX, or audit side effect.

### Implementation

- [ ] Define one typed allowlist mapping accepted physical table names to static
  `$executeRaw` statements and make the default list use lowercase mapped names.
  Reject unknown caller-supplied names before executing maintenance rather than
  silently skipping them. Reuse the same canonical list in
  `maintenanceRepository.reindexHeavyTables` or remove its duplicate list if all
  callers can preserve the job's per-table progress/cancellation contract.
- [ ] Preserve `SET statement_timeout`, unconditional timeout reset, job abort
  checks, progress percentages, attempts policy, audit details, and static SQL
  injection safety.
- [ ] Run focused maintenance job/repository tests, server source/test
  typechecks, lint, full server unit tests, targeted coverage, complexity checks,
  and an adversarial review of defaults, custom subsets, empty input, unknown
  input, failure cleanup, and physical-schema mappings.

### Compatibility, rollout, and rollback

- No database migration is required. Existing explicit callers using the broken
  Prisma model strings receive a validation error and must move to physical names;
  repository-wide caller search is required before merge. Rollback has no data
  conversion. Maintenance logs and audit details continue to report the exact
  physical tables attempted.

## Delivery Sequence and Verification Gates

1. Commit this recursively reviewed plan as the immutable implementation input.
2. Deliver Phase 1 in one PR based on the then-current `origin/main`; require
   focused regression tests, server/test typechecks, lint, architecture checks,
   full server unit tests, review resolution, merge verification, and exact
   target-SHA CI before starting Phase 2.
3. Refresh stale context and deliver Phase 2 in one PR from the new target;
   require focused tests, app/test typechecks, lint, full frontend tests, review
   resolution, merge verification, and exact target-SHA CI.
4. Refresh stale context and deliver Phase 3 in one PR from the new target;
   require focused tests, server/test typechecks, lint, full server unit tests,
   review resolution, merge verification, and exact target-SHA CI.
5. Run repository-wide typechecks and policy checks, then a fresh whole-repo
   bug scrub at the exact merged target SHA. Any confirmed P0-P2 finding starts
   another reviewed iteration; zero blockers advances to final deployment.
6. Because Sanctuary containers were running at loop start and deployment policy
   is final, run `./start.sh --rebuild` only after the terminal clean scrub.
   Verify container health and a representative application/API smoke path,
   reconcile run-state branches/worktrees, and close the durable goal/state.

## Plan Review Checklist

- [x] Every confirmed P0-P2 finding maps to at least one regression and one
  implementation item.
- [x] All authorization-losing callers and session revocation callers are
  enumerated from fresh source before Phase 1 implementation.
- [x] Concurrency, failure ordering, cross-instance rollout, cache ownership,
  async stale completions, migration/compatibility, rollback, observability,
  cleanup, and deployment are explicitly covered.
- [x] Each phase is independently mergeable and contains no unrelated P3 work.
- [x] A complete recursive review pass returns no actionable comments.
