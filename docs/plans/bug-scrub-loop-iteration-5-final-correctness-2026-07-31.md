# Bug Scrub Loop Iteration 5: Final Correctness Remediation

## Goal

Resolve all nine P1/P2 findings accepted by the complete iteration-4 rescrub at
`ecd16a42877bc8e696c25932d2ad4ec493b05dd2`, prove each root fix with a
failing-first behavioral regression, deliver the reviewed implementation through
protected-branch PRs, verify target-branch CI, and run another complete eight-domain
scrub.

## Locked scope

- Baseline SHA: `ecd16a42877bc8e696c25932d2ad4ec493b05dd2`
- Target branch: `main`
- Task branch: `codex/bug-scrub-loop/iteration5-final-correctness-20260731`
- Accepted findings:
  - P1 `wallet-sync-transient-receive-misclassification-permanent`
  - P1 `full-resync-drops-replacement-during-active-sync`
  - P2 `consolidation-correction-nonatomic-stale-output-roles`
  - P2 `address-label-same-address-stale-save-overwrite`
  - P2 `payjoin-parse-uri-accepts-malformed-values`
  - P2 `payjoin-numeric-query-parsing-violates-contract`
  - P1 `transaction-export-backpressure-exhausts-db-pool`
  - P2 `transaction-export-csv-formula-injection`
  - P1 `address-sync-multi-output-receive-undercount`
- Review refinements accepted before delivery:
  - P1 partial input persistence can suppress later classification repair;
  - P1 a post-reset crash can lose the full-resync rebuild intention;
  - P1 an aborted export can release its permit while database work continues;
  - P2 same-address label requests can still reach persistence out of order;
  - P2 resync and Payjoin OpenAPI contracts can diverge from runtime;
  - P2 the export deadline can omit snapshot file finalization;
  - P2 the export pool-pressure regression can miss the production route; and
  - P2 an OP_RETURN-only send can be mistaken for a consolidation;
  - P1 shutdown can strand a wallet immediately after a committed reset;
  - P2 BullMQ deduplication can be reported as a newly accepted job;
  - P2 stream backpressure can ignore the application request timeout; and
  - P2 an abandoned spilled-snapshot reader can outlive permit ownership;
  - P2 a timed-out export can overwrite or destroy its middleware-owned `408`;
    and
  - P2 an ambiguous queue-add failure can be misreported as definitive rejection;
    and
  - P1 an addressless inline prevout can suppress richer referenced-output
    evidence in both address and primary wallet sync;
  - P1 selected primary I/O repair can be skipped when scalar classification
    returns no candidate; and
  - P1 primary classification can combine a referenced address with a stale
    addressless-inline value from a different evidence source; and
  - P2 classification-null I/O repair can skip same-pass RBF replacement
    linking after its newly resolved inputs become durable.

## Constraints

- Add behavioral regressions before production changes.
- Keep edited functions at `CCN <= 15` and split parsing, paging, and ownership
  logic into named helpers.
- Preserve exact zero/null semantics and wallet-scoped transaction identity.
- Do not hold an interactive database transaction while waiting on client I/O.
- Keep export memory bounded and pagination deterministic.
- Reuse repository transaction, validation, logging, timeout, and access-control
  boundaries.
- Do not start Sanctuary app containers that were not running at loop start.

## Phase 1: Monotonic transaction classification across both sync paths

### Failing-first coverage

- Add a primary wallet-sync regression that:
  1. observes a multi-input wallet spend while its wallet-owned previous output
     fails resolution but another input remains persistable,
  2. proves the first pass can only form weaker `received` evidence,
  3. reruns with complete wallet-owned input evidence, and
  4. requires the persisted row to promote to `sent` with corrected scalar and
     output-role fields, including an `active received → confirmed sent`
     transition that persists `rbfStatus: confirmed`.
- Add a concurrent/same-txid repository regression proving weaker candidates
  cannot overwrite stronger classifications and stronger candidates repair
  weaker rows.
- Add a single-address-sync regression for one incoming transaction paying two
  addresses in the same wallet; require the stored receive amount to equal the
  sum of every wallet-owned output, not only the triggering address.
- Fail primary I/O persistence after the scalar row commits and require the next
  sync to select and repair it independently of classification, including `sent`.
- Require a selected I/O repair with resolvable inputs and only addressless
  outputs to persist and complete even when scalar classification returns null;
  when confirmed, require its newly durable shared inputs to link a pending RBF
  predecessor in the same pass.
- Prove the I/O repair queue is independently capped and fair, attempt cursors are
  scoped to the selected classification/I/O sets, and coinbase/no-input
  transactions can reach durable I/O completion.
- Require live single-address backfill selection to use `ioComplete`, not missing
  input/output relations: a completed coinbase/no-address row must stop refetching,
  while a partial row remains eligible even when both relation sides are nonempty.
- Add a live single-address repair regression whose non-coinbase input has only
  `txid`/`vout` evidence. Fetch the referenced previous transaction, persist the
  resolved input, and require the repaired transaction to reach I/O completion.
- Add distinct addressless-inline-prevout regressions for both sync pipelines:
  fall through to referenced-output evidence, require end-to-end `sent`
  classification, and persist the resolved input rather than treating an inline
  script object without an address as conclusive.
- Round-trip `ioLastAttemptAt` through backup restore and prove with PostgreSQL
  that both I/O cursor and completion writes leave public `updatedAt` unchanged.

### Implementation

- Make the repository's monotonic address-sync reconciliation the canonical
  classification persistence boundary for both single-address and primary wallet
  sync.
- In the primary wallet pipeline, distinguish truly new txids from existing
  non-terminal classifications that must be re-evaluated. Revisit every weaker
  classification until a durable marker proves that every raw non-coinbase input
  had resolvable address evidence. Historical rows default incomplete and remain
  eligible for fair repeated repair attempts until conclusive; completed rows
  leave the candidate set. Bound each sync to 100 incomplete classification
  repairs, select never-attempted rows first, then the oldest dedicated persisted
  `classificationLastAttemptAt`, with a deterministic txid tie-break. Touch only
  that private repair timestamp for an attempted-but-still-incomplete non-terminal
  row without changing its `unchanged` outcome, so permanently unresolved rows
  rotate behind the backlog without changing the public transaction `updatedAt`.
  Persist the cursor with parameterized SQL at the repository boundary,
  bypassing Prisma's automatic `@updatedAt` mutation. Advance it in one bounded
  batch when selected existing repairs start, before raw transaction network I/O,
  so null results, fetch failures, and classification-null outcomes also rotate;
  reconciliation must not touch it a second time. Prove the timestamp separation
  and fetch-failure rotation against focused tests and real PostgreSQL.
  Treat `sent` as classification-conclusive and exclude it from this repair queue.
  Retain batched insert behavior for genuinely new rows.
- Preserve precedence `received < consolidation < sent`, serialize promotion with
  output-role repair, promote confirmation-derived `rbfStatus` with the other
  scalar fields, and keep same/stronger candidates idempotent.
- Route primary-sync input/output persistence through the same repository
  transaction used by address sync: lock parent rows in deterministic order, read
  their committed classifications, and derive output roles only inside that
  transaction. Run RBF replacement detection after durable input persistence with
  the same captured inputs and candidate set. Prove a primary-sync writer blocked
  behind a concurrent promotion persists only roles for the promoted type.
- Track I/O repair independently from classification with durable `ioComplete`
  and `ioLastAttemptAt` fields. Select at most 100 incomplete I/O rows per sync
  across every transaction type, including `sent`, ordered never-attempted then
  oldest attempt and txid. Carry the exact classification and I/O selections in
  sync context so each private cursor advances only for its selected work before
  fetch, without changing public `updatedAt`. Mark `ioComplete` atomically with
  locked duplicate-safe I/O persistence only when every raw non-coinbase input
  has resolvable address evidence; coinbase/no-input transactions are complete,
  while fetch or persistence failures remain independently retryable. In live
  single-address repair, resolve missing inline prevouts from bounded batches of
  referenced previous transactions before deciding whether the evidence is
  complete, matching the primary wallet-sync path. In both paths, an inline
  prevout is conclusive only when its script resolves an address; otherwise the
  classifier and I/O builder must fall through to cached/fetched referenced
  output evidence. Resolve input address and value from the same evidence source
  so a stale addressless-inline value cannot corrupt fee or amount calculation.
- Run selected I/O repair directly from its fetched raw evidence when no scalar
  classification candidate can be formed; classification-null outcomes must not
  prevent duplicate-safe input persistence or durable I/O completion. Derive
  confirmation state from the stored transaction and run RBF detection after
  that durable persistence just as the classified path does.
- For single-address receives, calculate amount from `walletAddressSet` (the same
  wallet-wide rule used by the canonical wallet classifier) while retaining the
  triggering address as `addressId`.
- Define and test the primary-pipeline outcome matrix:
  - `created`: persist I/O and derived fields, apply eligible labels/RBF handling,
    recalculate balances, increment creation statistics, and emit one new-
    transaction notification;
  - `repaired`: complete/repair I/O and derived fields and recalculate balances,
    but do not emit a duplicate new-transaction notification or increment creation
    statistics;
  - `unchanged`: perform only explicitly idempotent incomplete-field/I/O repair and
    no new-transaction side effects.

### Verification

- Focused wallet-sync, address-sync, repository integration, transaction I/O, RBF,
  notification, and running-balance suites.
- Real PostgreSQL promotion/concurrency, I/O completion, cursor isolation, and
  public-timestamp preservation regressions.
- Backup restore schema-classification coverage for both private repair cursors.
- Server production and test TypeScript checks.
- Exact affected-file coverage for capped selection, fair rotation, unchanged
  incomplete attempts, completion, and promotion paths.

## Phase 2: Full-resync follow-up ownership and atomic consolidation correction

### Failing-first coverage

- Hold the distributed wallet-sync lock, request full resync, prove no destructive
  reset occurs while the original job owns the lock, release it, and require
  exactly one high-priority full-resync job to acquire the lock, delete/reset, and
  sync.
- Cover network-wide resync with a mixture of active and idle wallets; require
  every wallet to use the same per-wallet full-resync intention and forbid eager
  bulk deletion/reset.
- Cover deduplication, queue unavailability/enqueue errors, shutdown, retry,
  success, and final-failure paths with an active-wallet follow-up present.
- Simulate BullMQ returning the already-retained job ID while the returned job
  object still exposes the newly submitted candidate data; require the outcome,
  aggregate counts, HTTP contract, and UI message to classify that wallet as
  `deduplicated`, never newly `accepted`.
- Abort immediately after reset commits but before the handler's ordinary
  `syncInProgress` guard is armed; require the retained job to retry and require
  wallet state not to remain falsely successful or permanently stuck.
- At the HTTP boundary, prove queue rejection is reported truthfully
  instead of returning a successful “queued” response.
- Simulate distributed-lock contention from another process and require the
  accepted full-resync intention to remain queued for later ownership.
- Add a mixed-output consolidation regression containing both an already-owned
  `change` output and a newly recognized wallet output; require every output role
  plus parent type/amount to change atomically.
- Inject a repository failure and require the consolidation parent/output state to
  roll back together.
- Inject a failure between transaction deletion, address-flag reset, and wallet
  sync-state reset; require the entire full-resync reset to roll back.
- Add API/OpenAPI/frontend contract and component coverage for the deferred
  response: accepted wallet resync reports pending work without an immediate
  deleted count; network resync reports
  accepted/deduplicated/rejected/indeterminate outcomes without claiming rows
  were already cleared.
- Prove the exact retry bridge: reset commits, the BullMQ job retains its durable
  `fullResync: true` plus generation identity, and a sync failure or stalled-worker
  replay retries the rebuild without repeating deletion. Then prove lock
  contention after reset delays the same job rather than completing it as a
  skipped ordinary sync, A reset/fail → B complete → old A replay also skips
  deletion, and final-attempt preparation failure records truthful failed
  metadata.
- Round-trip a full-resync DLQ envelope with its positive integer generation. Reject
  `fullResync: true` without a valid generation and reject a generation on ordinary work.
  Also round-trip an ordinary `fullResync: false` or omitted shape with no generation;
  successful reset preparation must not rewrite a full-resync job into that
  ordinary shape.

### Implementation

- Represent full resync as a distinct durable BullMQ intention rather than
  deleting state in the request handler. Execute deletion/reset only after that
  full-resync job acquires exclusive wallet sync ownership. If Redis/BullMQ cannot
  durably retain the intention, reject the request before deletion rather than
  reporting success.
- Route both wallet and network full-resync requests through this same per-wallet
  intention; remove eager network-wide transaction deletion and flag resets.
- Allow one deduplicated full-resync follow-up for an actively syncing wallet.
  Ordinary sync jobs use a different identity and are never silently upgraded;
  the distinct full-resync job waits for exclusive ownership. Configure BullMQ
  `keepLastIfActive` deduplication so a request arriving after the active job has
  reset is durably stored as the single generation-bearing successor; waiting or
  delayed work may continue to deduplicate without another successor.
- Detect BullMQ deduplication from a unique submitted job identity or another
  queue-native result, not from candidate data returned by `Queue.add`.
- If `Queue.add` throws after Redis may have committed, reconcile the candidate
  job and deduplication IDs. Report accepted/deduplicated when observable,
  rejected only when a successful reconciliation proves neither exists, and an
  explicit indeterminate outcome when evidence remains ambiguous. In particular,
  reserve `deduplicated` for a retained job verified in a pre-start state; an
  active, missing, terminal/unknown, or failed retained-target lookup is
  `queue_state_unknown` because it cannot prove the active-successor write
  committed.
- Return a discriminated per-wallet enqueue union: `accepted`, `deduplicated`,
  `rejected` with `queue_unavailable | queue_error`, or `indeterminate` with
  `queue_state_unknown`. Do not remove a full-resync job
  permanently until distributed wallet-lock acquisition succeeds; requeue it with
  bounded backoff on external lock contention.
- On distributed-lock contention, move full-resync jobs back to BullMQ's delayed
  state without consuming an attempt; ordinary jobs may retain the existing
  lock-held no-op behavior. Keep the durable full-resync marker through reset and
  rebuild so a stalled retry cannot take the ordinary no-op path.
- Keep priority semantics explicit and test queue-unavailable and enqueue-error
  rejection paths; no synthetic application-level capacity boundary is introduced.
- Model the destructive transition explicitly:
  `queued full-resync → lock acquired → reset completed once → rebuild required
  until success`.
  Execute transaction deletion, address-used reset, and wallet sync-state reset in
  one repository transaction; transition to `reset completed once` only after that
  transaction commits. Reserve a monotonically increasing generation in
  `requestedFullResyncGeneration` before enqueue, and atomically advance
  `processedFullResyncGeneration` with the destructive reset. Queue failures and
  deduplication may leave harmless generation gaps; any generation at or below the
  processed high-water mark is already complete. Lock the wallet row with
  `SELECT ... FOR UPDATE` before reading that high-water mark so competing reset
  transactions serialize and an older generation cannot overwrite a newer one.
  Constrain both counters to PostgreSQL's signed `INTEGER` domain with
  `0 <= processed <= requested <= 2147483647`; accept job/DLQ generations only in
  `1..2147483647`, select both counters under the row lock, and reject any reset
  generation above the durably requested high-water mark.
  This bounded state prevents both
  an intervening ordinary sync and an older DLQ replay after a newer attempt from
  re-arming deletion.
  Retries after reset retain the durable `true + generation` rebuild intention. The
  processed-generation high-water mark makes reset preparation idempotent, while retaining the
  intention ensures distributed-lock contention cannot complete the job as an
  ordinary skipped sync before the rebuild succeeds. Treat reset preparation as
  having armed cleanup ownership before the first post-reset abort checkpoint, so
  shutdown cannot strand `syncInProgress`; shutdown or final failure leaves
  truthful retryable/failed metadata and never reports a queued reset that was
  rejected.
- Replace immediate-delete response contracts across server types, OpenAPI,
  frontend API types, and UI messaging. Wallet responses describe accepted/pending
  work; network responses enumerate accepted, deduplicated, rejected, and
  indeterminate wallets (including reasons). `queued` counts newly accepted jobs;
  `walletIds` contains only accepted or deduplicated wallets in request order.
  Single-wallet and no-confirmed-intention network `503` errors retain every
  discriminated outcome in `details.outcomes`. No client message may say
  “Cleared N transactions” until reset execution has actually committed.
- Persisted DLQ validation permits `fullResync` only as a boolean, requires a
  canonical positive safe-integer generation exactly when it is true, preserves
  valid pairs on retry, and rejects malformed pairings.
- Replace split consolidation writes with one repository transaction that locks or
  conditionally updates the parent and reclassifies all owned outputs to
  `consolidation`. Require at least one wallet-owned output so an OP_RETURN-only
  sent transaction cannot vacuously satisfy the consolidation predicate.

### Verification

- Focused sync queue/service/coordinator/API suites.
- Focused balance-calculation unit and PostgreSQL rollback tests.
- Server lint, build, production/test typechecks, and complexity checks.

## Phase 3: Operation-owned address labels and strict Payjoin validation

### Failing-first coverage

- Add same-address reverse-completion coverage: Save A-old, cancel/reopen A, Save
  A-new, resolve new then old; require local state to retain A-new and current
  modal/busy/error ownership.
- Preserve the iteration-4 guarantee that stale saves for different addresses may
  patch their own captured row.
- Exercise the real BIP21 parser and API route with missing/wrong scheme, invalid
  address, malformed/negative/non-finite/fractional-satoshi amount, duplicate
  critical parameters, and valid encoded metadata.
- Cover URI-generation `amount` and receiver `minfeerate` with exact zero,
  positive boundary, negative, Infinity, empty, and partial numeric strings. For
  `minfeerate`, prove the shared documented/runtime ceiling accepts `1000000`
  (including an all-zero fractional suffix) and rejects the next positive value
  plus arbitrarily large decimal strings.

### Implementation

- Serialize persistence requests per address and track the latest save operation
  per address. Allow a completion to patch that row only if it still owns the
  address-specific generation; retain separate wallet/editor ownership for modal
  state and error visibility.
- Parse BIP21 through a strict helper: require the `bitcoin:` scheme, validate the
  address across all supported networks (mainnet, testnet3, testnet4, signet, and
  regtest), require whole-string fixed-decimal syntax, nonnegative value, at most
  eight fractional digits, and safe-range satoshis. Convert integer and fractional
  digit strings directly to satoshis without binary floating-point arithmetic, so
  valid values such as `0.29` and `0.00000003` remain exact. Reject unsupported
  required parameters.
- Validate Payjoin query values through route schemas/shared numeric helpers rather
  than `parseInt`/`parseFloat` coercion. Preserve documented zero semantics and
  pass validated values unchanged. Export one fixed-decimal lexical contract and
  the `1,000,000 sat/vB` ceiling for both receiver parsing and OpenAPI so neither
  side independently approximates the accepted domain.
- Resolve the documented `maxadditionalfeecontribution` contract explicitly:
  validate it as a whole-string nonnegative integer, reject duplicates/invalid
  values, and pass it to receiver processing if the service supports it; otherwise
  remove it from OpenAPI and reject it as unsupported. Cover both the chosen
  behavior and exact zero.
- Keep the OpenAPI contracts exact: document deferred resync execution and its
  structured `503 details.outcomes`; cap generated Payjoin amounts at the runtime
  safe-integer boundary; and describe `minfeerate` as the same fixed-decimal
  lexical string accepted by the route.

### Verification

- Focused address-label component/hook suites.
- Payjoin parser, API, receiver, service, OpenAPI-contract, and feature-gate suites.
- Frontend and server production/test typechecks.

## Phase 4: Backpressure-safe, injection-safe transaction exports

### Failing-first coverage

- Add an integration test with a deliberately small Prisma connection pool and
  paused export responses; require unrelated DB work to acquire a connection while
  exports are backpressured.
- Saturate the export concurrency guard and require a documented pre-header `429`
  response with retry guidance; then prove the permit is reusable.
- Add stream lifecycle tests for `drain`, request abort, response close, and
  response error; require prompt termination with no listener leak and permit
  release after success, pre-header failure, mid-stream error, abort, and close.
  While `drain` is withheld, fire the application request-timeout signal and
  require the wait to terminate promptly with every socket/signal listener
  removed.
- Add route-level pre-header capture-timeout and post-header backpressure-timeout
  regressions. Require the middleware-owned `408` status/body to remain intact,
  no second error to be forwarded, and permit/snapshot cleanup to settle.
- Force an early return from a spilled snapshot's page generator while its input
  stream is still live; require generator cleanup to close/destroy the readline
  and file stream before snapshot unlink and export-permit reuse complete.
- Add concurrent insert/delete/update pagination tests proving deterministic,
  duplicate-free traversal over an immutable request-start membership set and the
  documented consistency boundary.
- Add CSV cases beginning with `=`, `+`, `-`, `@`, tab, and carriage return in
  labels/memos; require neutralized literal cells while preserving normal RFC CSV
  quoting.

### Implementation

- Remove the client-facing write loop from the repeatable-read interactive
  transaction.
- Use a short, independently timed repeatable-read capture transaction to page only
  immutable transaction IDs in the desired `(blockTime, id)` order into bounded
  memory and, past the configured threshold, a securely created owner-only
  temporary file. This capture may wait on database and local-file I/O but never
  on client I/O; keep spill creation, initial writes, sync, seal, and close inside
  the same strict capture deadline.
- After capture commits and releases its connection, read fixed-size ID pages and
  fetch full rows outside a long-lived transaction. Reorder every `WHERE id IN
  (...)` result to the captured ID order before emission. Inserts after capture
  are excluded; deleted rows are skipped; updated rows may expose their latest
  committed scalar state, while immutable membership/order prevents cursor
  movement, duplicates, and newly inserted tail growth.
- Clean secure snapshot artifacts on success, request abort, response close/error,
  capture failure, and server startup orphan recovery. Use a dedicated,
  identifiable temp prefix and age/ownership checks so recovery never removes
  unrelated files.
- Make chunk writes abort-aware by racing `drain` with request abort and response
  close/error and the application request-timeout signal, and remove listeners
  after every outcome.
- Treat an already-sent/ended request-timeout response as middleware-owned: do not
  forward a second pre-header error or destroy/truncate the middleware's `408`.
- Close and destroy a spilled snapshot's readline/input stream in a generator
  `finally` block so early iterator return settles disk work before cleanup and
  permit release.
- Add a small process-local concurrency guard for export streams so authenticated
  viewers cannot create unbounded simultaneous export work even though DB
  connections are short-lived. Acquire before headers, return `429` plus
  `Retry-After` when saturated. If a client abort only abandons uncancellable
  database work, retain ownership of the bounded permit until that underlying
  operation settles; otherwise release exactly once from a single terminal path.
- Neutralize dangerous spreadsheet prefixes in user-controlled CSV cells with a
  leading apostrophe before RFC quoting. Treat `\r`, `\n`, and `\r\n` as record-
  structural characters that always require RFC quoting, including after formula
  neutralization. Do not alter JSON exports.
- Remove the obsolete five-minute interactive-transaction wrapper only after the
  new traversal and lifecycle tests pass.

### Verification

- Export unit/contract/integration suites, including PostgreSQL pool-pressure proof.
- The PostgreSQL pool-pressure proof must invoke the production export route with
  a one-connection pool, pause the actual response, and show unrelated work can
  still acquire the connection.
- Wallet access, route limiter, response lifecycle, and JSON/CSV parity suites.
- Server coverage, lint, build, typechecks, API validation, and network-boundary
  checks.

## Phase 5: Integration, review, and delivery

- Run focused suites after each phase and then:
  - frontend full coverage at exact 100% statements/branches/functions/lines;
  - backend full coverage at exact 100% statements/branches/functions/lines;
  - frontend app/test typechecks and production build;
  - backend production/test typechecks and production build;
  - lint, `git diff --check`, safety guards, API validation, architecture
    boundaries, OpenAPI checks, blocking-I/O checks, network-boundary checks,
    large-file classification, and changed-production complexity checks;
  - relevant real PostgreSQL integration tests.
- Independently review the exact implementation diff for architecture, tests,
  security, UI ownership, concurrency, and unintended scope.
- Commit, push, open/update a protected-branch PR, wait for every PR-head check,
  squash merge only the reviewed head, verify parent/tree identity, and wait for
  all target-branch checks.
- Resolve findings only against the verified merge SHA.
- Fast-forward local `main`, run a fresh complete eight-domain scrub at that exact
  SHA, and repeat the loop if any P0-P2 remains.

## Rollback

- Use a forward-compatible runtime rollback rather than reverting the squash
  merge as one unit: preserve every already-applied migration file, leave additive
  columns inert, and retain export orphan cleanup.
- The additive non-null requested/processed full-resync generation migration is
  safe to deploy before workers. First stop full-resync producers, then drain or
  reconcile every generation-bearing BullMQ/DLQ job under generation-aware
  workers. Only then revert runtime worker/API behavior. If the columns are later
  removed, do so with a separate forward migration after all deployments run
  generation-oblivious code.
- Keep the prior export route available in git history, but do not retain a runtime
  legacy path or feature flag after the new traversal passes integration coverage.
  Drain active exports before reverting the route and retain startup orphan cleanup
  for at least one compatibility release, removing only owned prefix-matched stale
  snapshot files.
