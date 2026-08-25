# ADR 0004: Durable, activity-driven wallet synchronization lifecycle

- **Status:** Accepted through durable stale-scheduler retirement
- **Date:** 2026-08-22
- **Accepted on:** 2026-08-22
- **Owner:** Sanctuary maintainers
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `config/wallet-sync-lifecycle-contract.json`, `server/ARCHITECTURE.md`, `server/src/jobs/syncJobContract.ts`, `server/src/worker/recurringSchedules.ts`

## Context

Sanctuary entered this transition with both worker and API-process wallet
synchronization paths. It also schedules `check-stale-wallets`, selects wallets
from the age of `lastSyncedAt`, and creates timestamped child jobs. That policy
converts elapsed wall-clock time into wallet-history work even when the chain
and every watched address are quiet. Multiple execution and subscription owners
also make it hard to prove that activity is coalesced without being lost.

The transition must be rolling-upgrade safe. Retained BullMQ payloads and older
producers use the unversioned or explicit v1 wire shape. A marker-absent
compatibility path may consume those records only until the separately gated
cutover establishes the irreversible retirement marker.

## Decision

The target wallet lifecycle is:

`initial catch-up -> subscribed/current -> activity-driven incremental catch-up`

Initial catch-up records chain and address-status checkpoints before a wallet is
current. Once current, wallet-history work may be requested only for a first or
never-synced wallet, relevant address activity, explicit user action, or bounded
startup/reconnect gap recovery. Gap recovery compares durable address-status
checkpoints and requests work only for changed or previously unknown wallets.

A block header advances the chain tip and confirmation state for already-known
transactions. It is not evidence of wallet address activity and must never cause
an all-wallet history scan. Elapsed wall-clock time, session restoration, and
ordinary navigation are not wallet-history triggers. Any future proposal for a
periodic history rescan requires an explicit change to this ADR and its executable
contract.

One durable sync-intent admission service is the only active production entry
point. API compatibility shims and canonical producers request or merge intent;
they will not execute wallet history directly. The worker will be the only
low-level wallet-history executor and Electrum subscription owner. BullMQ remains
an at-least-once wake-up mechanism; database claims, monotonic generations,
leases, and fencing own admission and completion truth. Full resync takes
precedence without erasing later incremental activity.

The compatibility and mutation-fence activation floors are additive:

- consumers read retained unversioned/v1 payloads and v2 payloads without a
  generation only to bridge them into durable intent; they never execute those
  pre-fence payloads directly. Generation-bound v2 and mutation-fence-required
  v3 wake-ups use the canonical fenced consumer, while active producers emit
  only gate-authorized v3 work;
- canonical incremental and full-resync adapters emit v3 with the required
  mutation-fence floor. Full resync also carries its exact reserved full-resync
  generation and the incremental generation captured with that reservation. A
  pre-floor v2 worker rejects v3 before acquiring the wallet lock, and the
  accepted worker runs reset and pipeline mutations only under the explicit
  fence;
- schema and checkpoint additions are readable before producers rely on them;
- a durable policy understood by every supported rollback binary must be able to
  move `check-stale-wallets` from desired to forbidden and purge retained work;
- missing policy retains legacy behavior before cutover, while malformed or
  unreadable policy must not silently recreate a schedule after cutover.

The admission capability persists coalesced intent. A retained pre-fence job is
converted to pending intent even while activation is dormant, but it cannot
enqueue fenced work until the live gate authorizes it. The worker can claim and
execute an explicitly generation-bound v2 or fenced v3 wake-up while it owns the canonical
Redis wallet lock. A bounded worker recovery runtime now revisits unclaimed
intent and enqueues an exact already-reserved full-resync generation. Restores discard database
lease authority while retaining pending
generations, and a full-resync generation is processed only after its prepared
rebuild completes successfully. Canonical manual/API, initial-sync, address
activity, dead-letter retry, and retained stale-schedule bridges are active only
through the gate-enforced admission boundary. Bounded recovery also calls that
admission boundary; it does not own raw repository or queue authority.
Terminal action-required full-resync generations are excluded from automatic
recovery and exact repair until an explicit operator request reopens the same
reserved generations. Automatic stale-marker repair carries the complete
captured lifecycle snapshot into its token-revoking reset, so acquiring the
Redis lock after a newer completion cannot clear that newer state.
Workers advertise the mutation boundary's explicit capability floor through
the bounded heartbeat registry, old heartbeat records remain readable but block
activation, and an immutable operational activation record defaults to dormant.
The record can be established only through the activation gate after exact,
fresh, stable-identity evidence proves every indexed worker meets the floor
continuously for the declared maximum wallet execution plus lock slack. The
continuous interval is serialized in a separate operational setting, resets on
blocked, unavailable, stale, or restarted-fleet evidence, and is deliberately
not backup authority. Configuration enforces the declared 30-minute maximum
execution duration, and activation always drains its full 31-minute lock horizon
rather than trusting a smaller per-replica value. Graceful worker shutdown retires only its exact boot epoch;
a stale shutdown cannot erase a replacement worker or crash evidence.

Deployments configured with `SYNC_MAX_DURATION_MS` above 30 minutes must lower
that value before starting a floor-capable worker. Such a worker fails closed at
configuration validation; it does not silently shorten an operator-selected
timeout or advertise a drain guarantee it cannot satisfy.

The immutable marker is necessary but never sufficient: admission and every
recovery/reclaim pass recheck current live fleet evidence and the continuous
drain proof. Worker health exposes only the bounded activation state, floor,
reason, and timestamps—never replica identities or lease tokens. The recovery
runtime polls the gate while dormant; its coordinator starts only after
activation, repairs on activation, a bounded timer, and Redis reconnect, and
stops before the queue and Redis authority drain. Canonical production producers
use the same live-and-stabilized gate and fail closed when it cannot authorize
admission.

Expired incremental claims are selected by the existing partial
`(lease expiry, wallet id)` index. Recovery proves the Redis execution lock is
absent and emits only the stable old-generation v3 wake-up; it never places the
old lease token in BullMQ. After acquiring the exact wallet lock, the canonical
worker rereads the expired database fence, rechecks activation, and atomically
rotates the token on the same generation. A stale former owner therefore cannot
write or complete, while any newer requested generation remains a trailing pass.

The additive checkpoint repository also owns the only enrollment request and
completion writers. Exact enrollment completion compares the authoritative
network/address status and advances any required incremental wallet generation
in the same short PostgreSQL transaction: an unknown null status establishes the
baseline without history work, while unknown non-null history and later status
changes coalesce durable intent. The returned exact generation is only a
post-commit wake-up input, so queue loss cannot separate checkpoint evidence
from intent. A bounded, network-explicit enrollment coordinator composes the
completion writer with
injected subscription batch I/O. The worker-owned bounded checkpoint runtime is
the sole production consumer: `server/src/worker.ts` constructs
`server/src/worker/subscriptionCheckpointRuntime.ts`, which owns startup,
reconnect, reconciliation, and live status-comparison pages. API startup,
`SyncService`, and direct subscription callbacks cannot construct the runtime or
call checkpoint writers. Missing checkpoint rows remain rolling-upgrade
candidates, authoritative null status remains distinct from unknown status, and
partial or unavailable subscription batches do not silently mark enrollment
complete. Every page is bounded and network-explicit; committed exact-generation
intents are published and woken only after the checkpoint transaction commits.
The elected worker advances a persistent keyset cursor on its one-second recovery
loop so an unavailable leading page cannot starve later checkpoints. Canonical
jobs consumed by a non-owner worker wait on the durable wallet checkpoint state
for the elected owner instead of issuing network I/O or failing the job. Live
statuses are serialized by exact network and script hash, and any rejected lock
refresh immediately tears down the former owner before its lease can expire.
Subscription RPC responses are emitted into the activity stream synchronously in
Electrum wire order before their promises resolve, while initial checkpoint
enrollment holds a worker-local mutation-order barrier; a later notification
therefore cannot be overwritten by an older subscribe response. A fair keyset
page re-observes authoritative statuses every minute so a transient database
failure before a durable request exists self-heals without an unbounded network
scan. Startup and reconnect work are bound to an exact ownership epoch, checked
after each await, and late connections are disconnected after lease loss.

The elected worker opens Electrum connections for the configured primary
network plus every strictly validated network represented by persisted wallets.
It may add another supported network on demand, but persisted missing or unknown
network values fail closed; only the historical `testnet` spelling is normalized
to `testnet3`. Startup, reconnect, reconciliation, refresh, and direct wallet
subscription responses all flow through the authoritative subscription-status
callback. Periodic checkpoint and status work rotates fairly across the managed
network set. Durable per-network readiness and reorganization evidence are the
authoritative scheduler-retirement gate.

This ADR and `config/wallet-sync-lifecycle-contract.json` establish the target and
freeze the remaining compatibility exceptions. Scheduler retirement serializes
the exact per-network readiness projection with address, checkpoint, failure,
header, coverage, reconciliation, and confirmation-retry writers by taking the
global retirement advisory lock and one fixed-order PostgreSQL table barrier.
It writes the immutable marker only when activation and readiness remain exact,
then removes the repeatable schedule and queued stale-only parents and children
before startup consumers run. The worker repeats this reconciliation after
interruption and periodically retries a legitimately blocked cutover. Explicit,
activity, and full-resync intent always wins over a legacy-shaped job ID.

Marker-absent compatibility scheduling, startup catch-up, and retained completion
admission are isolated in `server/src/worker/staleWalletScheduleCompatibility.ts`.
Their policy read and Redis mutation share the retirement advisory lock with
cutover, while retained intent persistence rechecks the marker in the same locked
database transaction. Once the marker exists these paths cannot create new
elapsed-age work. Deprecated stale-threshold variables emit name-only warnings
during the compatibility window. `cutoverComplete` is true.

Public status is a token-free projection of the same versioned wallet row. REST
status plus wallet list/detail responses, canonical WebSocket snapshots, and the
frontend cache carry incremental requested/claimed/processed generations,
claim/lease timestamps, action-required time, and full-resync
requested/prepared/processed generations. The retired local queue position is
always null. Support packages expose only bounded aggregate counts and coarse
drift buckets; they never include wallet identity, exact generations, timestamps,
or lease tokens and are not authority for live Redis execution ownership.

## Executable invariants

| ID | Requirement |
| --- | --- |
| `WSYNC-LIFECYCLE-001` | Lifecycle and allowed wallet-history triggers match this decision. |
| `WSYNC-BLOCK-001` | Headers update tip/known confirmations only; time and headers do not request wallet history. |
| `WSYNC-ADMISSION-001` | Production producers and recovery use one gate-enforced durable admission module; compatibility exceptions cannot grow. |
| `WSYNC-WORKER-001` | The worker is the sole low-level executor and checkpoint-subscription owner; only its bounded runtime may consume the enrollment coordinator and checkpoint writers. |
| `WSYNC-COMPAT-001` | Unversioned/v1 and retained v2 remain readable only as durable-intent bridges; they cannot enter the unfenced executor. Canonical emission uses floor-bound v3, which a pre-floor worker rejects before locking; unknown versions fail closed. |
| `WSYNC-STALE-001` | The stale scheduler is durably forbidden after an atomic activation/readiness cutover; marker-absent compatibility is isolated, serialized with cutover, and cannot recreate elapsed-age work afterward. |

## Consequences

The compatibility inventory is intentionally a debt ledger. New direct
executors, wallet-job producers, subscription-checkpoint writers or coordinator
consumers, age-driven history paths, or spellings of the legacy job identities
fail required CI. Removing a listed legacy path also fails until the contract is
updated in the same reviewed change, preventing stale exceptions from disguising
progress.

The remaining compatibility ledger keeps retained wire readers and the
marker-absent rollback bridge reviewable while preventing the retired producer
surface from expanding.

## Rollout and rollback

Deploy additive schema, compatible readers, the complete mutation fence, worker
capability heartbeat, and durable activation reader to every worker replica.
Every replica must have a unique stable `WORKER_REPLICA_ID`. Only the activation
gate may establish the immutable floor, and only after continuous exact fleet
proof has survived the full drain horizon. A single ready snapshot is never
activation authority. Admission, recovery, and reclaim continue to require the
durable marker, current fleet readiness, and fresh stabilization evidence after
activation. Canonical producers now emit only through admission after those
checks. The scheduler-cutover release advertises the current worker floor before
cutover inspection, atomically establishes the durable marker only after exact
readiness, and purges stale-only Redis work. A transient block retains
compatibility and is retried by bounded recurring reconciliation; a
marker-present restart reconciles and purges before consumers start.

After cutover begins, rollback is supported only to a binary that understands
and honors the durable forbidden marker. Rolling back below that floor would
recreate the schedule during recurring reconciliation and is unsupported.
The marker is included in complete backup payloads, restored into an empty
recovery database only after strict schema validation, and may never replace or
remove a marker already present in the live deployment.
