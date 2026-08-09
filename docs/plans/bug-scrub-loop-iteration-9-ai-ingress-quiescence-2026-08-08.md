# Bug Scrub Loop Iteration 9: AI Ownership, Access, and Upgrade Quiescence

## Goal

Resolve every P0-P2 finding accepted by the fresh whole-repository scrub at
`b31df93c69ca39e3187cb05cafb9ea0d2a60ab2b`, preserve the iteration-8
ownership and credential-migration contracts, and deliver each independently
releasable phase through reviewed, byte-identical squash merges with exact
target-SHA CI verification.

## Confirmed findings

- P1 `wallet-ai-query-filter-route-cross-contamination`: a retained wallet-A AI
  transaction filter, or a deferred A query completion, can filter wallet B;
  clearing a pending query does not invalidate its completion.
- P1 `tor-forwarded-ip-rate-limit-bypass`: the supported Tor hidden service
  forwards directly to a backend that trusts one proxy hop, allowing clients to
  rotate `X-Forwarded-For` and evade authentication and Payjoin rate limits.
- P1 `intelligence-group-wallet-recurring-analysis-omitted`: scheduled
  Intelligence selection considers direct wallet links but not effective group
  wallet access.
- P2 `intelligence-settings-concurrent-write-loss`: settings update the entire
  preferences JSON document through an unlocked read-modify-write.
- P2 `intelligence-settings-inaccessible-wallet-accepted`: GET/PATCH settings
  do not enforce wallet view access before reading or persisting wallet-keyed
  preferences.
- P2 `grafana-migration-running-instance-race`: setup/start suppress Grafana
  stop failures and documented direct Compose commands bypass quiescence before
  snapshot/reset/rollback of the shared SQLite volume.

## Phase 1: Wallet AI query ownership

- [x] Make the AI transaction-filter state explicitly owned by the Wallet
  Detail route/user/network ownership key. Store the owner with the filter so a
  route change synchronously exposes `null` before effects run, and expose an
  owner-captured setter that refuses completions after ownership changes. Do not
  weaken the existing `wallet.id === route id` render fence.
- [x] Give `useAIQueryInputController` full route/user/network ownership. Tag or
  synchronously invalidate every rendered field (query, result, error,
  examples, and loading), so B never paints A's local input state before
  effects run. Use the existing request-ownership helper and propagate an
  `AbortSignal` through the already signal-capable API client boundary. Only the
  current generation may commit success, error, or loading-finally state;
  clear, wallet change, and unmount must invalidate the active generation.
- [x] Add behavioral tests for retained filter A→B, deferred query A→B after the
  input unmounts, clear while a same-wallet query is pending, reversed
  same-wallet submissions, stale `finally` ownership, and the immediate B
  render before effects. Assert B remains unfiltered, no A input/result/error/
  examples/loading state paints under B, a cleared/newer result cannot be
  resurrected, and an ownership abort never surfaces as B's error.

## Phase 2: Intelligence authorization and atomic preferences

- [ ] Put GET and PATCH wallet Intelligence settings behind the canonical
  `requireWalletAccess('view')` boundary, using the route parameter shape that
  middleware actually resolves. Add inaccessible-wallet proofs for both routes
  and assert PATCH performs zero preference writes.
- [ ] Replace the direct-only recurring selection with one canonical effective
  wallet association query that includes direct and group-derived access,
  deduplicates by `(userId, walletId)` when a wallet is reachable through both
  paths, and retains wallet name, user ID, and that user's enabled settings.
  Apply the same effective direct-or-group access source to Intelligence
  notification recipients; do not leave group-only users out through the
  direct-only sharing query. Cover group-only, direct-only, duplicate,
  revoked/no-longer-accessible entries, group-only notification delivery, and
  two users on one wallet with disjoint filters.
- [ ] Replace the shared full-document unlocked preferences write with a
  database-backed cross-process concurrency boundary. Introduce one canonical
  transactional updater callback that rereads inside every attempt, uses
  serializable isolation plus the existing bounded conflict retry pattern, and
  returns the committed document/result. Reuse or extract the complete existing
  classifier, including Prisma `P2034` and adapter-wrapped `P2010` with
  `TransactionWriteConflict`; do not recognize conflicts by message text.
  Migrate all current full-document
  writers—profile, Telegram, Autopilot, and Intelligence—to it; serializing only
  Intelligence cannot protect unrelated namespaces. Exhausted conflicts must
  return the repository's normal conflict envelope, not report false success.
- [ ] Add deterministic concurrency tests in which two requests capture one
  baseline before either writes, then both return success and a reload contains
  both changes. Also cover same-wallet different-field updates, different
  wallets, and Intelligence racing profile, Telegram, and Autopilot updates.
  Exercise the repository transaction boundary rather than only mocking
  serialized frontend calls. Cover `P2034`, wrapped-`P2010`, bounded exhaustion
  mapped to the normal conflict/409 response, and immediate propagation of a
  non-conflict error.

## Phase 3: Trusted Tor ingress

- [ ] Stop exposing the complete backend directly through the hidden service.
  Route Tor through a narrowly scoped internal HTTP ingress that accepts only
  supported Payjoin receive paths, rejects other API/auth routes, overwrites
  rather than appends forwarded identity headers, and then proxies to backend.
  Keep the existing onion address volume and outbound SOCKS behavior. Preserve
  ordinary Nginx client-IP behavior and do not trust a variable hop count.
- [ ] Make the ingress allowlist exact: only `POST
  /api/v1/payjoin/{addressId}` is accepted, with query strings preserved and the
  existing `text/plain` request/response and 100-KiB body contract intact.
  Explicitly reject other methods, `/status`, `/attempt`, `/parse-uri`, prefix/
  suffix confusion, encoded separators or traversal, `/api`, `/internal`, and
  authentication routes. Remove or overwrite every client-supplied forwarding
  identity header before proxying, including `Forwarded`, `X-Forwarded-For`,
  `X-Real-IP`, `X-Forwarded-Host`, and `X-Forwarded-Proto`.
- [ ] Add executable Compose/ingress contracts proving an attacker-supplied
  `X-Forwarded-For` cannot affect `req.ip`/rate-limit keys through the Tor path,
  authentication endpoints are unreachable through the onion ingress, valid
  Payjoin paths remain reachable, and normal frontend proxy behavior is
  unchanged. Update setup/start, install/offline image classification, and Tor
  documentation for any added ingress image/configuration.

## Phase 4: Grafana migration quiescence

- [ ] Treat Grafana quiescence as a migration precondition. Setup/start must
  abort if an existing Grafana cannot be stopped. An existing database may be
  read or mutated only after positive proof that the resolved Compose Grafana
  instance is stopped; stop success alone is insufficient. Pass a scoped,
  single-use, non-replayable quiescence lease into the migration container. Bind
  it to the resolved Compose project and Grafana container identity/generation,
  and hold the same exclusion continuously from verified stop through migration
  completion. Every supported Grafana start must acquire the conflicting side
  of that protocol, so a restart cannot enter between inspection and the final
  marker. Direct Compose/migration with a legacy database and no current lease
  must refuse before snapshot creation. Do not rely on `depends_on` to stop an
  already-running container, and do not treat unavailable status inspection as
  safe.
- [ ] Replace direct monitoring `docker compose up ... grafana` instructions and
  executable proof paths with the supported wrapper, or split the documented
  non-Grafana services from a wrapper-managed Grafana start. Add mocked stop
  failure tests that prove no migration/up command runs; also cover stop returns
  success while the container remains running, liveness/status inspection
  failure, and direct migration with an existing database but no quiescence
  proof. Every refusal must leave DB, journal, WAL, SHM, and marker unchanged.
  Add stale/replayed-lease and concurrent-start-after-proof regressions; both
  must refuse before mutation. Re-run direct-start contracts, byte-identical
  rollback, and idempotent-marker proofs.

## Phase 5: Integrated verification and delivery

- [ ] Run focused Wallet AI/controller ownership, Intelligence route/settings/
  repository/worker, Tor proxy/rate-limit, Grafana migration, installer, and
  Compose contract suites, including every new deferred/concurrent/failure
  regression.
- [ ] Run frontend app/tests typechecks, backend typecheck, gateway/egress
  builds, lint and safety checks, architecture/OpenAPI drift checks, shell
  syntax, changed-file complexity (`CCN <= 15`), test hygiene, and
  `git diff --check`.
- [ ] Run the repository's complete coverage gates and require exact 100%
  statements, branches, functions, and lines. Re-read the full diff for route
  identity, access parity, cross-process write ownership, proxy trust, live-data
  rollback, and unrelated scope creep.
- [ ] Run an independent adversarial implementation review and resolve every
  verified P0-P2 comment.
- [ ] Deliver the four phases as separate PRs when independently releasable.
  For each: push the exact reviewed head, require every attached PR-head context
  terminal success/skip, squash-merge, verify head/merge tree identity, and
  require every exact target-SHA context terminal success/skip before rebasing
  the next phase.

## Rollback and safety

- Wallet and Intelligence changes are ordinary application code and schema-free;
  revert their phase merge if regressions appear. Never downgrade the wallet
  render fence or wallet access middleware to restore behavior.
- Tor changes must preserve the existing hidden-service key volume. Rollback is
  fail closed: retain the trusted ingress or disable inbound onion Payjoin; it
  must never restore a direct Tor-to-backend target or fallback. Keep an
  executable Compose rollback contract that rejects any reintroduced backend
  target while preserving the key volume.
- Grafana migration tests use disposable directories and fake Docker/CLI
  processes. Never exercise failure tests against the running Sanctuary volume.
  Production rollback must restore the private snapshot before the wrapper
  reports failure, and a failed quiescence check must leave the database
  untouched.
