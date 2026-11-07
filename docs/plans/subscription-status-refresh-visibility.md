# Subscription Status Refresh: Visibility and Documentation

Status: implemented
Date: 2026-11-06
Follows: [`stale-wallet-scheduler-removal.md`](stale-wallet-scheduler-removal.md)

## Background

Activity-driven sync (ADR 0004) depends on not missing an Electrum
`blockchain.scripthash.subscribe` notification. The proposed backstop was a
periodic reconciliation: re-read each subscribed address's Electrum status hash,
compare it with the stored one, and raise sync intent only on a mismatch.

That backstop already exists. #908 (2026-08-23) added it:

- `startSubscriptionStatusRefreshTimer` (`server/src/worker.ts`) runs every
  `SUBSCRIPTION_STATUS_REFRESH_INTERVAL_MS` (60 s). Each tick resubscribes one
  page of `SUBSCRIPTION_CHECKPOINT_PAGE_SIZE` (200) addresses for one managed
  network, round-robin, through `electrumManager.refreshSubscriptionStatusPage`.
- Returned statuses go through `onSubscriptionStatuses` →
  `recordSubscriptionStatuses` → `subscriptionCheckpointRuntime.recordStatusPage`
  → checkpoint completion.
- `requiresIntent` (`server/src/repositories/subscriptionCheckpointCompletion.ts`)
  raises durable sync intent when the observed status differs from the stored
  `address_subscription_checkpoints.observedStatus`, or when an unknown status
  becomes non-null.
- A full pass over N addresses takes about N / 200 minutes per network, so
  3,000 addresses take about 15 minutes. Reconnect also resubscribes every
  address with the same comparison.

The mechanism is correct but invisible. The ADR and runbook don't mention it,
no metric shows whether it is running or what it finds, and a mismatch it
detects looks the same as an ordinary notification. That is why the backstop
looked absent when the stale-wallet removal was reviewed.

## Goals

1. Make a mismatch found by the refresh distinguishable. That mismatch means a
   notification was missed, which is the failure this backstop exists to catch.
2. Show that the refresh is running and how current each network's pass is.
3. Document the backstop where agents and operators look first.

Non-goals: changing the cadence, page size, comparison rule, or intent
admission. Reintroducing any elapsed-time wallet re-sync.

## Work

### 1. Tag the observation source

Pass a source (`notification`, `subscribe`, `reconnect`, `refresh`) from each
`onSubscriptionStatuses` caller through to `recordStatusPage`, and return
whether each completion raised intent. Keep the source out of the persisted
checkpoint; this needs no schema change and no migration (RC10 migration
digest gate).

### 2. Metrics (`walletSyncMetrics.ts` or `electrumMetrics.ts`)

- `sanctuary_subscription_status_mismatches_total{network,source}`: completions
  that raised intent. A non-zero `source="refresh"` rate means notifications are
  being missed.
- `sanctuary_subscription_status_refresh_pages_total{network,outcome}`, with
  outcome `refreshed`, `skipped_disconnected`, `skipped_not_owner`, `failed`.
- `sanctuary_subscription_status_refresh_cycle_completed_timestamp_seconds{network}`:
  set when a network's cursor wraps, which marks a completed full pass.

Labels use fixed sets only, with no address, script hash or wallet identity.

### 3. Alerts (`docker/monitoring/alert_rules.yml`)

- **Refresh stalled:** no completed cycle for a network in longer than an
  expected bound derived from the address count, with a generous floor.
- **Missed notifications:** sustained `source="refresh"` mismatches. Warning
  severity: sync self-heals, but the Electrum server or the subscription path
  needs a look.

### 4. Verify the disconnected-page behavior

While a network is disconnected, `refreshSubscriptionStatusPage` skips the
subscribe but still returns `scanned` and `nextCursor`, so the cursor advances
past unchecked pages. Reconnect's full resubscribe should cover that window.
Confirm it with a test (a missed notification while disconnected is caught on
reconnect). If it isn't covered, hold the cursor while disconnected instead.

### 5. Documentation

- ADR 0004: add a short "Missed-notification backstop" paragraph covering the
  refresh, its cadence, the comparison rule, and that it raises intent and
  never re-syncs on elapsed time.
- `docs/how-to/operations-runbooks.md` "Is sync current?": add the cycle
  timestamp and the refresh mismatch rate to the table of checks.
- `server/ARCHITECTURE.md`: list the timer with the other worker timers.

## Acceptance criteria

- Unit tests show a refresh-detected mismatch increments
  `sanctuary_subscription_status_mismatches_total{source="refresh"}` and raises
  intent, and that a matching status does neither.
- Unit tests cover each page outcome and cycle-wrap timestamp updates.
- A test shows that a status change while disconnected raises intent after
  reconnect, or the cursor-hold fix lands with that test.
- Alert rules pass the existing monitoring config checks.
- ADR, runbook and architecture docs describe the backstop.
- No Prisma migration. Backend and frontend typechecks, unit tests and unit
  coverage thresholds pass. Required PR checks are green.

## Delivery

One PR, after the stale-wallet scheduler removal merges.

## Implementation notes

Divergences from the plan:

- **Stall alert bound.** No per-network address-count metric exists, so
  `SubscriptionStatusRefreshStalled` uses a fixed 6 hour floor (covers about
  70,000 addresses on one network) instead of a bound derived from the address
  count. The runbook and the rule comment say to raise it for larger installs.
  The series appears after a network's first completed pass, so a restarted
  worker is not flagged before then.
- **Cycle timestamp semantics.** A pass counts as complete only if every page in
  it ended `refreshed`. A pass that crossed a disconnected network, a lost
  ownership or a failed page wraps its cursor but does not update the timestamp.
- **Item 4 (disconnected window).** Reconnect already covers the gap, so the
  cursor is not held. Reconnect builds a fresh network state with an empty
  `subscribedAddresses` set and resubscribes every address tracked for the
  network, passing the statuses to the same checkpoint comparison. A test
  (`covers a status refresh skipped while disconnected with the reconnect
  resubscribe`) shows a status changed during the gap is delivered with source
  `reconnect`.
- **Source tagging.** The source is a fixed union bound in
  `ElectrumSubscriptionManager.observeStatuses`, passed as a third argument of
  `onSubscriptionStatuses`, and kept out of the persisted checkpoint.
  `recordStatusPage` returns `intentsRaised` (applied completions that raised
  intent). Reconcile and wallet-address subscription report as `subscribe`.
  `refreshSubscriptionStatusPage` now also returns its page `outcome`.
- Metrics live in `observability/metrics/subscriptionStatusMetrics.ts`, and the
  cursor, outcome and cycle bookkeeping in
  `worker/subscriptionStatusRefreshTracker.ts`, which keeps `worker.ts` under
  the large-file limit.
