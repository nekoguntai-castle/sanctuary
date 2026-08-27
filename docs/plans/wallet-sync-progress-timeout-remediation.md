# Wallet Sync Progress and Timeout Remediation

Status: approved after five recursive review passes; implementation in progress
Date: 2026-08-26
Target: `origin/main` at `40aae345531911da72f7d18d522ccf61575eedde` (v0.8.68)
Incident evidence: `~/sync-diagnosis.txt`, `~/sync-diagnosis2.txt`, and the
2026-08-26 support aggregates

## 1. Confirmed problem

The affected full resync spent about ten minutes fetching 47 address histories,
then stopped visibly at `Fetching transactions 1-25 of 100...`. The worker later
timed the attempt out and released it while the requested full-resync generation
remained unprocessed. The final log row described an ended attempt, not live work.

Source inspection identified one execution problem and two visibility problems:

1. The outer 30-minute attempt signal is checked only between pipeline phases.
   Remote calls in history, transaction, previous-output, UTXO, gap-limit, block
   timestamp, and missing-field paths do not observe it. Electrum batch retry plus
   sequential fallback can compound timeouts, and detached pending requests can
   remain after the 30-second abort grace.
2. One transaction batch log precedes current fetch, parent fetch, classification,
   sequential header timestamp lookups, fenced persistence, labels, and repair.
   There is no truthful substage breadcrumb. `classification.ts` also omits the
   wallet network when looking up block timestamps.
3. `useWalletLogs()` overwrites live entries when history resolves. The dashboard
   mapper drops durable generation/lease fields, and detail controls conflate an
   HTTP submission, queued intent, and leased execution into one local boolean.

## 2. Behavioral invariants

- One `SyncAttemptRuntime { signal, deadlineAt, createStageDeadline }` is created
  before any canonical remote operation and reaches every remote await in `syncWallet()`
  and `populateMissingTransactionFields()`, including connection/identity, height,
  history, UTXO, transaction, header, gap-limit, confirmation, retry, and fallback
  paths. Every catch that maps errors to empty/null rethrows outer cancellation.
- Aborting one attempt removes only its Electrum pending request IDs, timers, and
  listeners; it never disconnects the shared subscription socket. Late responses
  are inert and no new request/retry is scheduled after abort.
- Budget ownership is explicit and never resets in nested helpers: one test-injected
  five-minute deadline spans the complete address-history phase, one spans the
  complete UTXO observation phase, one spans each missing-field remote chunk, and
  one `candidate_batch_remote` deadline spans current fetch, parent fetch, fallback,
  and timestamp/header work for each 25-candidate batch. Nested helpers receive and
  may narrow an existing deadline; recursion never creates a fresh outer budget.
  These budgets apply equally to normal
  and Tor clients, capped by the remaining outer attempt time. The budget includes
  initial batch calls, their retries/delays, subdivision or individual fallback,
  and header reads. Tor keeps longer per-request timeouts, so fewer retries fit;
  it does not receive a larger stage budget. Before a retry starts, the adapter
  caps its timer to remaining budget or stops if no useful time remains.
- Batch failure uses fixed concurrency 4, never serial unbounded fallback. Outer
  cancellation records no evidence rejection. Local budget exhaustion cancels its
  pending RPCs, records one fixed `fetch_budget_exhausted` rejection per unresolved
  item, preserves authenticated siblings, and reaches the existing retryable
  receive-evidence gate.
- After abort, no new fenced mutation unit begins. Cancellation is rechecked by the
  mutation wrapper after its advisory/row lock and fence acquisition, immediately
  before callback entry; a pre-call phase check is only an optimization. A transaction already inside a
  fenced unit may settle atomically; lifecycle release remains serialized behind
  its wallet row lock, so no canonical mutation commits after claim release. Safe
  post-commit cosmetic effects check cancellation before starting.
- Unique positive block heights are fetched once per candidate batch with bounded
  concurrency, on `ctx.network`. Non-cancellation failure stays nullable; outer
  cancellation propagates unchanged. The timestamp map is batch-local.
- Progress is stage-based and never an overall percent. `completed/total` means
  durably settled candidate count and advances only after authoritative persistence
  or repair settles. Stage-start entries contain batch identity but do not advance
  completion. Maximum emission is one start per fixed stage, one fallback summary,
  and one durable completion per candidate batch, plus terminal status.
- Metrics use closed label domains only. Durations/counts are observations, never
  labels. Worker/support execution snapshots are strict aggregate counts/buckets
  scoped to the sampled worker and never claim fleet authority.
- The 2026-08-26 `sync-diagnosis2.txt` snapshot showed five decaying, non-renewing
  wallet locks while Redis had zero active sync jobs and the database still marked
  five wallets syncing, plus a worker lock-loss termination. Treat this as stale
  execution/lock-health evidence: expose fixed lock-loss and orphan-cleanup counters,
  include sampled-worker registry/lock agreement in diagnostics, and classify public
  lifecycle/lease disagreement as attention rather than progress.
- UI state is explicit: submitting, running, pending, retrying, action-required,
  attention, and settled are distinct. Only submitting/running animates. The last
  log checkpoint is current only while durable lease evidence says it is current.
  The browser cannot observe Redis lock ownership: it automatically re-evaluates
  public lease/retry time boundaries and says only that lease evidence expired,
  never that a Redis lock was lost or a worker is orphaned.
- Existing REST/sync snapshot envelopes remain compatible. No database migration,
  raw wallet/user/job/txid/host/error label, or per-wallet support trace is added.

## 3. PR 1 — cancellation substrate and bounded canonical remote work

### Regression-first scope

- Inventory every remote await reachable from `syncWallet()` and
  `populateMissingTransactionFields()` in a checked-in architecture test. Pin
  signal propagation for connection/network verification, height, history and
  UTXO batch/fallback, transaction batch/fallback, gap-limit rescans, transaction
  detail/previous-output resolution, block headers, and confirmation repair.
- Electrum deferred-request tests prove single and batch abort remove matching
  pending entries/timers/listeners, reject with the original reason, ignore late
  replies, stop retry delays, and leave other attempts/subscriptions connected.
- Fake-timer tests prove the complete remote stage settles within five minutes for
  normal and Tor clients; no retry begins when remaining budget is insufficient.
- History, UTXO, and transaction fallback tests prove concurrency never exceeds 4,
  accepted siblings survive, budget exhaustion produces exact unresolved counts
  and `fetch_budget_exhausted`, and outer cancellation adds no rejection.
- Abort tests cover history batch/fallback, UTXO batch/fallback, gap-limit rescan,
  UTXO detail fetch, transaction/parent fetch, block timestamp, and missing-field
  population: zero matching pending IDs, no later read, and no new mutation unit.
- Mutation-boundary tests distinguish abort-before-entry (callback never invoked)
  from abort-after-entry (atomic unit settles; release waits; no subsequent unit).
- Hold a wallet mutation lock, enqueue a fenced unit, abort while it waits, release
  the lock, and prove its callback and post-commit effects never begin.
- Two callers share one deferred connection: aborting caller A detaches only A's
  wait while caller B completes on the same connection, with no disconnect or
  singleton reroute. Abort during pool acquisition/identity starts no fallback.

### Implementation

- Change the attempt runner/canonical adapter contract so it computes one absolute
  outer deadline from the same configured timeout and passes a `SyncAttemptRuntime`
  into `syncWallet`/`PipelineOptions` before connection, identity, and height work.
  `SyncContext` retains that exact runtime after construction. Add shared cancellation
  classification, abortable delay, and stage-deadline helpers; nested/recursive work
  never reconstructs the outer deadline.
- Add optional signals/deadlines through the relevant `NodeClientInterface`,
  Electrum client/public API/method callbacks, connection/verification helpers,
  block-height/timestamp utilities, and pool/singleton implementations. Pending
  cleanup is per request ID and idempotent across response, timeout, abort, socket
  failure, and disconnect races.
- Shared connection establishment is caller-detachable, not caller-cancellable: an
  aborted attempt stops awaiting the shared `connectionPromise` without destroying
  it or its socket. Once connected, identity/height request IDs remain cancellable.
  Pool/fallback catches rethrow attempt cancellation before singleton fallback;
  disconnect remains reserved for network mismatch or socket failure.
- Replace serial history, UTXO, and authenticated-transaction fallbacks with one
  reusable bounded scheduler. The scheduler stops launching on outer abort or
  stage expiry and reports exactly which inputs remain unresolved without exposing
  their values to logs or metrics.
- Propagate cancellation through gap-limit recursion, UTXO insertion/detail reads,
  confirmation/missing-field helpers, and every error-to-null/empty boundary.
  Check before each remote operation and each new mutation unit; keep remote I/O
  outside fenced database transactions.
- Make `runWalletSyncMutation` derive and pass the context cancellation assertion
  into the post-lock authority check, while preserving an explicit compatibility
  path for unfenced callers. This closes the abort-while-waiting race.
- Split helpers before edited files cross repository complexity/size thresholds.

### Acceptance

- Focused Electrum, pipeline, history, UTXO, evidence, gap-limit, confirmation,
  attempt-lifecycle, and mutation-fence suites pass.
- `cd server && npx tsc --noEmit && npx vitest run` passes. If coverage is run,
  use `npx vitest run --coverage tests/unit` and retain the configured threshold.
- A timeout fixture settles inside abort grace with no matching pending request,
  later read, or new mutation; an already-entered mutation serializes correctly.
- Injected-clock tests cap initial connection/identity/height by the exact remaining
  outer time; a near-deadline stage receives only that remainder. Current+parent+
  header work shares one five-minute candidate-batch window, and multi-batch history/
  UTXO work receives no fresh deadline per internal batch.

## 4. PR 2 — stage logs, timestamp performance, and bounded telemetry

### Regression-first scope

- Process-transaction tests pin exact stage order, final partial-batch ranges,
  timestamp-height deduplication/concurrency/network, fallback summary, and the
  rule that durable `completed` never advances before the fenced unit settles.
- Runtime-contract tests cover every fixed stage/unit, finite non-negative integer
  bounds, `completed <= total`, bounded elapsed time, unknown keys/stages, and zero.
- Prometheus snapshot tests enumerate the complete stage/outcome/mode/network label
  domain, inject arbitrary strings without creating series, and prove the active
  stage gauge returns to zero on success, failure, budget expiry, and abort.
- Lock-health metric tests pin closed scope
  `{wallet_sync,electrum_subscription,worker_maintenance,other}`, loss outcome
  `{renewal_lost,ownership_mismatch}`, and cleanup outcome
  `{flag_cleared,intent_requeued,lock_present_deferred,no_change,error}`. Loss
  increments exactly once per ownership-loss transition; cleanup increments once
  per completed reconciliation decision, never per scan or key.
- Worker diagnostics/support tests cover stage transitions without double count,
  terminal removal, stale-entry expiry, restart-reset disclosure, unavailable
  observation, extra-key rejection, bounded/clamped counts, and poison strings.
  Two-worker fixtures prove sampled registry/lock agreement checks only the sampled
  worker's own retained token: matching, missing, mismatch, and Redis unavailable
  are distinct, and another worker's lock is never called orphaned.

### Implementation

- Prefetch timestamps for unique heights using PR 1's bounded scheduler and signal;
  pass the batch-local map into classification and always use `ctx.network`.
- Define a shared closed progress-details contract: `kind='sync_progress'`, fixed
  stage/unit enums, `batch`, `batchCount`, stage-local `elapsedMs`, and optional
  durable `completed/total`. Emit at most one stage start, one fallback summary,
  and one completion per candidate batch; terminal timeout/abort remains explicit.
- Add low-cardinality worker Prometheus metrics for stage duration, active stage,
  fallback, fetched/rejected, budget expiry, attempt timeout/abort, and abort-grace
  exhaustion, plus distributed lock loss and stale/orphan sync cleanup outcomes.
  Normalize unsupported network/stage/outcome/mode to fixed `other`;
  no dynamic operation/error text reaches labels. Gauge transitions are atomic and
  cleaned in `finally`.
- Add an in-memory worker execution registry updated on fixed stage transitions and
  terminal cleanup. Extend the existing authenticated diagnostics protocol with a
  versioned `walletSyncExecution` observation: scope `sampled_worker`, active count
  by fixed stage, oldest-progress age bucket, cumulative fixed counters, and reset
  age/process epoch semantics. Expire abandoned entries after the attempt horizon.
- The existing notification-worker support collector may carry that strict worker
  snapshot. Keep database `walletSync` authoritative for fleet lifecycle and keep
  sampled execution explicitly non-authoritative for fleet state. For each sampled
  registry entry, retain its lock token/key only in worker memory and compare the
  current Redis value without exporting either. Emit fixed counts
  `registryWithOwnedLock`, `registryMissingOwnedLock`, and
  `registryOwnershipMismatch`, or `agreement='unavailable'` on Redis read failure.
  Never emit or infer `lockWithoutRegistry` from a fleet/global Redis scan. Never
  admit the legacy `walletLogs` collector or raw identifiers/errors, lock keys,
  tokens, wallet IDs, or job IDs.
- Lock-loss and cleanup counters are process-local, sampled, and resettable; support
  exposes process epoch/reset age and explicitly cannot prove a pre-restart loss.
  Existing retained container logs remain the post-restart incident evidence. Do
  not add persistent Redis telemetry state in this remediation.

### Acceptance

- For 100 candidates/4 batches, no `completed=25` occurs before batch 1 settles and
  total progress records stay below the defined `(stages + 2) × batches + terminal`
  bound. Header failure yields null; outer abort rejects and launches no next height.
- Metrics expose slow stage/fallback/timeout/abort with a fixed series inventory and
  zero leaked identifiers. A generated shareable aggregate contains only the strict
  sampled-worker count/bucket schema and distinguishes recent-progress age, stale-
  progress age, reset, and unavailable observations without claiming motion or
  multi-worker completeness from one sample.
- Duplicate ownership-loss callbacks increment once; repeated reconciliation scans
  do not inflate cleanup counters. Maintenance and wallet-sync loss use different
  fixed scopes. Support schema rejects extra fields and poison bytes in Redis keys
  or values, and restart resets are disclosed rather than presented as zero events.
- Focused progress, classification, metrics, diagnostics, support/privacy, and
  process-transaction suites pass, followed by the full server commands from PR 1.

## 5. PR 3 — truthful fleet, controls, and log UI

### Regression-first scope

- Deferred hook tests cover live-before-empty-history, overlapping duplicate IDs,
  clear-before-history-resolve, wallet switch while enabled/disabled, rejection
  after switch, equal/malformed timestamps, caps 0/1, and unmount.
- Dashboard mapper tests preserve every incremental/full generation, claim/lease,
  action, retry, owner/start, status, and version field, including zero and null.
- Fleet-classifier tests use an injected `now` and exact disjoint precedence:
  action-required > running > retrying > pending > attention > settled. Public
  active-lease evidence means `syncInProgress===true`, owner `worker`, claimed
  generation ahead of processed, valid claimed-at, and valid expiry strictly after
  both claimed-at and `now`; it is evidence from public fields, not proof of the
  intentionally hidden token. Retrying means non-running/non-action-required,
  durable intent pending, and either a valid future retry timestamp or status
  `retrying`. Attention means any execution marker without public active-lease
  evidence, `processed<=claimed<=requested` violation, partial/invalid/reversed/
  expired lease timestamps, or disagreement between in-progress and claim-ahead.
  Invalid timestamps are attention. Pending is remaining coherent intent. One table
  enumerates every boundary and proves exactly one category per wallet.
- Shared lifecycle-clock tests render a valid public lease, advance exactly to
  expiry without HTTP/WS input, and prove running animation/current-stage context
  stop and Attention appears. A renewal before expiry reschedules the boundary;
  wallet/network switch and unmount leave no timer.
- Presentation tests cover submission before snapshot, reload with pending intent,
  active lease, deferred retry, action required, terminal states, and refetch/socket
  failure. Pending is disabled/static, never spinning; action-required is actionable.
- Admission tests prove POST success plus refresh failure remains accepted/pending
  without a `Sync Failed` notification; socket absence preserves it; older snapshots
  cannot clear it; a processed authoritative snapshot does; route changes isolate it.
- Button-matrix tests independently cover Sync and Full Resync for incremental
  pending, full-resync pending, retrying incremental, running, action-required, and
  settled state. Action-required fixtures with incremental and/or full intent prove
  recovery buttons remain enabled; clicking Sync uses existing explicit-reopen
  admission and creates the accepted watermark. An incremental intent may otherwise
  be superseded by confirmed Full Resync.
- Log tests cover all fixed stages and malformed/unknown details, and prove a final
  prior-attempt checkpoint cannot imply current work after durable state stops.
- Normalize log caps to integer `[0,500]`, defaulting negative/non-finite values to
  500 and truncating fractions before clamping; cover negative, fraction, NaN,
  Infinity, zero, one, and over-500 list/seen-ID behavior.

### Implementation

- Rework `useWalletLogs` around pure merge/cap plus wallet-session and clear epochs.
  Clear invalidates pending history. Valid ISO timestamps sort chronologically with
  ID tie-break; malformed timestamps retain stable arrival order after valid rows.
  Rebuild seen IDs from the committed capped list and reset on wallet identity even
  while disabled. Normalize `maxEntries` once: negative/non-finite uses default 500,
  fractions truncate, then clamp to `[0,500]`; zero retains no rows or seen IDs.
- Preserve the full existing lifecycle contract in the dashboard mapper. Add a pure
  classifier and compact all-filtered-wallet summary, e.g.
  `12 wallets · 2 syncing · 10 pending`, plus retry/action/attention when non-zero.
- Add one shared bounded lifecycle clock for the filtered fleet: schedule the nearest
  lease-expiry or retry boundary with a coarse capped fallback tick, rescheduling on
  snapshots and wallet/network changes. Do not create one timer per wallet. At
  public lease expiry, re-run the classifier and use copy such as “lease evidence
  expired”; do not claim Redis orphan or lock loss from browser-visible fields.
- Treat admission and refresh as separate outcomes. After a successful POST, store
  a route-owned accepted-intent watermark `{kind,generation}` and end only
  `requestSubmitting`; expose static pending even if refresh/socket delivery fails.
  Refresh failure warns that status could not refresh and never reports Sync Failed.
  Clear the watermark only when authoritative HTTP/WS requested/processed generation
  reaches it, or route ownership changes; older snapshots cannot clear it.
- Derive separate `requestSubmitting`, `executionRunning`, `requestPending`, and
  `actionRequired` plus `syncDisabled` and `fullResyncDisabled`. Only submitting/
  running spins. Disable both while submitting/running; disable Sync for any pending
  intent and Full Resync for an existing full-resync intent. Action-required
  overrides ordinary pending disablement: enable Sync so its existing explicit-
  reopen admission can clear action/retry state, and enable Full Resync because no
  backend rejection rule forbids it. Incremental pending/retrying may otherwise be
  superseded by a confirmed Full Resync.
- Runtime-validate progress details with fixed labels. Render readable stage text
  without percentage; malformed/future details fall back to generic formatting and
  never drive a current-stage banner.
- Pass authoritative wallet presentation into LogTab. A checkpoint is current only
  during public active-lease evidence. When execution is stopped but intent remains, show
  `Attempt stopped; sync request pending` and identify the last checkpoint as prior
  attempt evidence. Timeout/abort log rows remain best effort, not source of truth.

### Acceptance

- The 2-public-active-leases + 10-unclaimed-intents fixture yields exactly
  `12 wallets · 2 syncing · 10 pending`; expired/missing leases never count running.
- Late empty history cannot erase live logs; clear cannot be undone by a late
  response; reload preserves a stopped/pending banner instead of stale activity.
- Run `npm run typecheck:app`, `npm run typecheck:tests`, `npx tsc --noEmit`,
  `npx vitest run`, lint, and `npm run build`. Run the Docker-safe static-dist
  Playwright path with no `webServer`, then manually inspect Wallet Summary and
  LogTab in light/dark at mobile and desktop widths; green image tolerance alone
  is not sufficient.

## 6. Serial delivery, rollout, and recovery

1. Deliver PR 1 from exact current `origin/main`; wait for exact-head CI, merge
   through protected policy, and verify ancestry/tree plus landed-main CI.
2. Rebase and deliver PR 2 only after PR 1 lands and verifies; then do the same for
   PR 3. Preserve unrelated Renovate work and avoid redundant CI runs.
3. After all three land, rebuild the already-running local stack with
   `./start.sh --rebuild`; verify backend, worker, frontend, gateway, proxy,
   Prometheus scrape, worker diagnostics, activation/readiness, and log relay.
4. Remote rollout is a same-commit stack upgrade. Pending generations remain
   durable. Rollback is an ordinary image/version rollback because there is no
   migration and no intent is deleted.

## 7. Recursive review record

- Pass 1 backend: broadened cancellation from transaction-only to every canonical
  remote path; defined one exact stage budget; corrected already-entered mutation
  semantics and local-budget evidence behavior; split the oversized backend phase.
- Pass 1 frontend/observability: separated running/pending/submitting; defined exact
  fleet precedence, clear/history epochs, runtime progress validation, current-vs-
  prior attempt display, fixed telemetry domains, sampled-worker support scope, and
  mandatory local/browser verification.
- Pass 2 backend: introduced a pre-context absolute attempt runtime, closed the
  mutation lock-wait race, made stage budget ownership non-resetting, and detached
  caller cancellation safely from shared connection establishment.
- Pass 2 frontend/observability: retained accepted admission across refresh/socket
  failure, split Sync/Full Resync rules, defined public lease/retry/attention
  predicates, normalized log caps, and removed the single-snapshot motion claim.
- Pass 3: backend review was clean; frontend review closed the final action-required
  recovery/button contradiction by making explicit reopen override pending disablement.

## 8. Final review checklist

- [ ] Re-read each diff for mutation-fence ordering, cancellation races, pending
      cleanup, off-by-one ranges, evidence fail-closed behavior, telemetry privacy/
      cardinality, worker restart semantics, null/malformed data, and stale UI.
- [ ] Run simplify/reuse and explicit edge-case audits after each PR.
- [ ] Record commands, exact heads, CI runs, merge commits, landed-main status,
      rebuild commit, telemetry/diagnostics proof, and container health in the ledger.
