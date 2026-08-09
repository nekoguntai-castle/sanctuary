# Bug Scrub Loop Iteration 10: Session, UI, and Grafana Portability

## Objective

Resolve every P0-P2 defect confirmed by the fresh whole-repository scrub at
`78dbce1da19b912859ba5a1578fe682b54ec82e1`, preserve existing external
contracts, and deliver each independently releasable phase through reviewed
head CI, byte-identical squash merge, and exact target-SHA CI.

## Confirmed Findings

1. **P1 — password-change-session-revocation-nonatomic.** Password replacement
   commits before the session version is advanced. A failure between those
   writes leaves the new password committed while old access and refresh
   sessions remain valid.
2. **P2 — wallet-pagination-refresh-cross-contamination.** Same-wallet refresh
   advances base-fetch ownership but an older offset request owns only the
   route, so it can append a shifted page onto the refreshed first page.
3. **P2 — ai-status-invalidation-stale-mounted-consumer.** Cache invalidation
   clears module globals without notifying the persistent Layout consumer, and
   a transient status error is retained as disabled for the mounted session.
4. **P2 — send-btc-bare-decimal-submits-nan.** A dot-only BTC display value
   reaches review because every guard treats `NaN <= 0` as false, then the API
   payload serializes `NaN` as `null`.
5. **P2 — grafana-quiescence-host-proc-nonportable.** Grafana migration binds
   client-host `/proc/<pid>` into the daemon. Native macOS has no `/proc`, and
   Docker Desktop or remote daemons use a different PID/filesystem namespace.

## Non-Negotiable Invariants

- Password replacement, `sessionVersion` advancement, and refresh-token
  deletion are one database transaction. No successful credential mutation may
  preserve a pre-change session.
- Password replacement is compare-and-swap owned by the exact password hash
  that the route verified. Two concurrent requests using one old credential
  cannot both commit or let a stale request overwrite the winner.
- Same-route list continuations may commit only while the base-fetch generation
  they captured still owns the list. Each collection permits at most one atomic
  continuation claim for an offset at a time, and list-coupled metadata shares
  that collection's ownership.
- AI capability state is an observable external store. Invalidation updates
  already-mounted consumers and starts one shared refresh; transient failures
  have a bounded recovery path and never create request storms.
- Every non-`sendMax` output crosses one canonical strict positive-safe-integer
  satoshi parser before step completion and again before API mapping. `NaN`,
  infinity, fractional sats, zero, negative, and unsafe integers are rejected.
- Grafana quiescence coordination is Docker-daemon-visible and independent of
  client `/proc`, `$HOME`, host PID namespaces, and client/daemon filesystem
  identity. The canonical migration container remains the daemon-side mutex.
- A running or indeterminate migration sentinel blocks every supported start.
  A terminal sentinel is removable only after a daemon-visible `success` or
  `rolled-back` outcome. Every token-bearing canonical zero-exit path publishes
  a fully scoped `success` outcome only after its marker or no-mutation result is
  durable. Existing Grafana database bytes are never touched before a scoped,
  unexpired, single-use lease is claimed.
- Functions edited or introduced in production remain at `CCN <= 15`; changed
  production files should remain below the repository size thresholds.

## Phase 1 — Atomic Password Security Mutation

- [x] Add one repository operation that accepts the exact verified old hash and
  uses a single Prisma transaction to conditionally update `WHERE id +
  password`, replace the hash, increment `sessionVersion`, and delete all
  refresh tokens for the user. Require exactly one updated row before deletion;
  reject a stale comparison and roll back every session mutation. Return the
  new version and deleted-token count for structured logging.
- [x] Make the password route call only that atomic operation after current
  password verification and hashing. Keep initial-password marker cleanup and
  audit logging after the committed security mutation; neither may weaken the
  transaction or reintroduce a second revocation write.
- [x] Preserve `revokeAllUserTokens` for logout-all/admin callers, but do not
  compose it with the password write.
- [x] Add repository tests proving all three writes use the same transaction,
  refresh deletion failure rejects the operation, stale-hash comparison stops
  before token deletion, and no outside-client write is issued. Add route tests
  for success, atomic-operation failure, marker/audit ordering, and absence of
  the legacy split revocation call. Add a two-deferred concurrent regression in
  which both requests verify one old credential but only one compare-and-swap
  commits; the loser cannot change the password or session state.
- [x] Run focused auth/repository/session tests, server typecheck/lint, coverage
  for the changed repository/route boundary, and an adversarial review.

## Phase 2 — Frontend Ownership and Numeric Boundary

- [x] Add explicit per-collection replacement ownership for transactions,
  UTXOs, and addresses. Starting any page-1/reset replacement advances that
  collection epoch and marks replacement pending before asynchronous work;
  continuations are refused while replacement is pending and may commit only
  against the exact epoch they captured. Give each collection an atomic,
  ref-backed single-continuation claim/request token so same-tick calls cannot
  capture and append the same offset twice; only the owning token may commit or
  clear loading. Finish/cancel replacement and continuation ownership on every
  success, error, route-change, and unmount path without clearing newer loading
  state.
- [x] Apply the collection contract to base `fetchData`, WebSocket/sync refresh,
  address reset actions, and every transaction/UTXO/address continuation. A
  same-wallet replacement, route change, or unmount must invalidate success,
  error, offset, `hasMore`, and loading commits from older pages.
- [x] Fence every list-coupled metadata read with the same collection epoch,
  including address summary totals used to derive address `hasMore`, or return
  that metadata as part of the owned replacement result. An older summary may
  not recompute metadata for a newer address list or mutate its loading/error
  state.
- [x] Add reversed-completion tests in which page 2 is pending, a shifted page 1
  refresh replaces state, and the old page resolves or rejects last. Also
  attempt a continuation after replacement starts but before page 1 commits,
  and race an address reset against an old address continuation. Cover all
  paginated collections plus loading/offset/`hasMore` ownership. Add same-tick
  double-invocation tests for transactions, UTXOs, and addresses proving one
  request and one append, plus delayed pre-replacement address-summary resolve
  and reject tests proving stale metadata cannot affect the new list.
- [x] Replace the AI status globals with a small `useSyncExternalStore`-backed
  store (or equivalent subscription contract) that deduplicates requests,
  publishes immutable snapshots to current subscribers, and makes
  `invalidateAIStatusCache` synchronously publish loading and begin a new shared
  request. Fence old completions by generation.
- [x] Do not terminal-cache status failures. Schedule one bounded retry while
  subscribers remain, cancel it on success/no subscribers/invalidation, and
  prove fake-timer recovery without duplicate concurrent requests. Preserve the
  public `useAIStatus` and invalidation API.
- [x] Introduce exact decimal-string BTC-to-satoshi conversion before state is
  populated: no `parseFloat` or rounding, at most eight meaningful decimals,
  and a safe-integer result. Pair it with one strict positive-integer satoshi
  parser for already-normalized output state.
- [x] Use the canonical boundary in step validation, error generation, action
  preflight, batch mapping, single-output creation, displayed result fallback,
  and draft/effective-amount mapping. Preserve `sendMax` semantics and refuse an
  API call if any invariant is violated even after UI validation.
- [x] Add behavioral tests for `.`, empty, zero, negative, fractional sats,
  `0.000000006`, non-finite, unsafe, maximum-valid BTC/satoshi strings, and the
  adjacent overflow. Assert transaction and draft APIs receive no invalid,
  rounded, or `null` amount.
- [x] Run focused Wallet/AI/Send suites, app and test typechecks, app lint,
  targeted exact coverage, complexity checks, and an adversarial review.

## Phase 3 — Daemon-Visible Grafana Quiescence

- [x] Remove host PID/start-time and `/proc` ownership from the wrapper, lease,
  migration script, environment, and Compose mounts. Do not replace it with a
  caller-selectable host path.
- [x] Add a project-scoped named Grafana quiescence volume. Resolve its physical
  Docker volume name alongside `grafana_data`; use short-lived, exactly scoped
  daemon-side helper containers to write/read lease and outcome files without a
  host bind mount. Bootstrap restrictive ownership/modes through the daemon,
  label and verify helper containers, and clean only the exact token artifacts.
  Validate project, data-volume, control-volume, Grafana container
  ID/generation, token, and expiry before mutation.
- [x] Package the reviewed migration script in a versioned Sanctuary migration
  image (or an equivalently digest-verified daemon-side artifact). Remove the
  `${SANCTUARY_PROJECT_DIR}` script bind entirely, include the image in normal
  build and offline bundle/image-loading flows, and require `--pull never` in
  offline helper/migration calls. No daemon-side operation may require the
  client checkout path to exist.
- [x] Keep the fixed canonical migration container name and labels as the
  daemon-side mutex. Feature-detect host `flock`: when present, retain the
  project/physical-volume lock as an optimization and fail closed on a genuine
  acquisition error; when absent (including stock macOS), enter the daemon
  lock-owner workflow directly. Correctness must never depend on `flock` and
  must survive wrapper/Compose-client death: a running sentinel blocks recovery,
  while an exited sentinel is reconciled only from a daemon-visible `success`
  or `rolled-back` outcome.
- [x] Preserve the single-use atomic claim inside the control volume, exact
  stopped-Grafana identity checks, private SQLite/database-journal/WAL/SHM
  snapshot, forced-failure byte rollback, marker-last publication, offline
  behavior, and direct legacy migration refusal. Make already-marked,
  fresh-volume marker initialization, and existing-database migration publish a
  fully scoped atomic `success` outcome on every token-bearing canonical
  zero-exit path, after marker/no-mutation durability. Preserve tokenless direct
  Compose behavior for fresh/already-marked volumes without creating canonical
  recovery artifacts, and keep tokenless existing-unmarked databases refused.
- [x] Add native-mac/no-`/proc`, Docker Desktop/remote-daemon namespace,
  wrapper-death, running-sentinel, terminal-success, terminal-rollback,
  stale/replayed/mismatched lease, and helper-container failure regressions.
  Refusal cases must prove database sidecars and marker remain byte-identical.
- [x] Run the wrapper under a controlled PATH with its required shell utilities
  and fake Docker but no `flock`; prove a migration succeeds and concurrent
  wrappers are serialized or refused by the canonical daemon container. Keep a
  separate regression proving an available `flock` that cannot acquire its lock
  fails closed before Docker mutation.
- [x] Add client-disconnect terminal-reconciliation regressions for fresh and
  already-marked volumes. Verify marker-before-outcome ordering, exact
  token/project/data-volume/control-volume/container identity in the outcome,
  successful subsequent reconciliation, and byte-identical database sidecars.
- [x] Add a rendered/run contract with a client project path that is absent on
  the daemon; assert no host source bind remains, the packaged script digest is
  the expected artifact, and the daemon control-volume helper works with both
  online and already-loaded offline images.
- [x] Update monitoring Compose and operations docs to describe the named
  control volume and daemon-visible recovery contract. Validate rendered
  Compose on supported profiles without starting the live Sanctuary stack.
- [x] Run shell syntax, Grafana migration/quiescence/Compose/install tests,
  workflow composition, diff checks, and an adversarial portability review.

## Phase 4 — Integrated Verification and Delivery

- [x] Run complete frontend, backend, gateway, and LLM egress test suites.
- [x] Run exact frontend and backend coverage gates, app/test/server typechecks,
  lint/safety/architecture/OpenAPI gates, test hygiene, shell syntax, diff
  checks, and changed-production complexity review.
- [x] Re-read the full diff for correctness, reuse, simplification, rollback,
  and unrelated scope creep. Resolve every verified adversarial P0-P2 comment.
- [x] Deliver the three implementation phases as separate PRs. For each, push
  the exact reviewed head, require every attached head context terminal
  success/skip, squash-merge, verify head/merge tree identity, and require every
  exact target-SHA context terminal success/skip before rebasing the next phase.
- [x] Mark this plan complete only after all three phase deliveries are verified
  and loop-owned branches are cleaned.

## Delivery Evidence

- Phase 1 shipped in PR #776 from reviewed head
  `7e97fec94b0a28e37ec04512f0b0cff28c3b986e`; squash merge
  `c2dead5da5a3805f66e605f0f5bfd7479c98d8a9` has the identical tree and its
  exact target-SHA CI completed with 14 success and 30 skipped contexts.
- Phase 2 shipped in PR #777 from reviewed head
  `42fb73a436462b6b195ed7a0adef5ee1e8179d05`; squash merge
  `d669f8ad23d3fac596703e37d30db0901db946d2` has the identical tree and its
  exact target-SHA CI completed with 17 success and 27 skipped contexts.
- Phase 3 shipped in PR #778 from reviewed head
  `24f4de898e0637a0eab3a88a936ffecd9c66e3fb`; squash merge
  `a175121b4d96b5088d965939a5e8b8a5a44292ca` has the identical tree and its
  exact target-SHA CI completed with 37 success and 19 skipped contexts.
- Focused and broad verification covered the atomic password transaction,
  Wallet/AI/Send ownership and numeric boundaries, Grafana migration and
  quiescence shell contracts, full frontend tests and exact coverage, package
  typechecks/lint/complexity, install helpers, workflow composition, PR CI, and
  exact target-SHA CI. Every adversarial P0-P2 implementation comment was
  resolved before its phase merged.
- Nested deployment was deferred under the loop's `--deploy final` policy. The
  outer loop will rebuild the previously running stack only after a fresh
  whole-repository scrub reaches the zero-P0/P1/P2 termination gate.

**Plan status:** Complete. All implementation PRs are merged and verified, and
their owned implementation branches/worktrees are cleaned. The fresh rescrub
and final deployment gate remain outer bug-scrub-loop closeout work.

## Rollback

- Phase 1 rollback restores the previous route/repository implementation as one
  unit; never retain the password update without its atomic session mutation.
- Phase 2 rollback is per subsystem, but must not restore raw pagination route
  ownership, non-observable AI cache invalidation, or permissive numeric mapping.
- Phase 3 rollback may preserve the Grafana data and quiescence volumes, but must
  fail closed before existing database mutation. Never restore client `/proc`
  coupling or direct live-database migration.
