# ADR 0004: Durable, activity-driven wallet synchronization lifecycle

- **Status:** Accepted for compatibility precursor
- **Date:** 2026-08-22
- **Accepted on:** 2026-08-22
- **Owner:** Sanctuary maintainers
- **Supersedes:** none
- **Superseded by:** none
- **Related:** `config/wallet-sync-lifecycle-contract.json`, `server/ARCHITECTURE.md`, `server/src/jobs/syncJobContract.ts`, `server/src/worker/recurringSchedules.ts`

## Context

Sanctuary currently has both worker and API-process wallet synchronization paths.
It also schedules `check-stale-wallets`, selects wallets from the age of
`lastSyncedAt`, and creates timestamped child jobs. That policy converts elapsed
wall-clock time into wallet-history work even when the chain and every watched
address are quiet. Multiple execution and subscription owners also make it hard
to prove that activity is coalesced without being lost.

The transition must be rolling-upgrade safe. Retained BullMQ payloads and older
producers use the unversioned or explicit v1 wire shape. The recurring stale
schedule remains live during the compatibility precursor, so this decision must
not describe the desired lifecycle as already cut over.

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

One durable sync-intent admission service will become the only production entry
point. API compatibility shims and queue producers will request or merge intent;
they will not execute wallet history directly. The worker will be the only
low-level wallet-history executor and Electrum subscription owner. BullMQ remains
an at-least-once wake-up mechanism; database claims, monotonic generations,
leases, and fencing own admission and completion truth. Full resync takes
precedence without erasing later incremental activity.

The compatibility precursor is additive:

- consumers read retained unversioned/v1 payloads and generation-bound v2 wallet
  wake-ups while production producers continue to emit v1;
- schema and checkpoint additions are readable before producers rely on them;
- a durable policy understood by every supported rollback binary must be able to
  move `check-stale-wallets` from desired to forbidden and purge retained work;
- missing policy retains legacy behavior before cutover, while malformed or
  unreadable policy must not silently recreate a schedule after cutover.

The admission capability can persist coalesced intent, and the worker can claim
and execute an explicitly generation-bound v2 wake-up while it owns the canonical
Redis wallet lock. A bounded recovery coordinator can revisit unclaimed intent
and enqueue an exact already-reserved full-resync generation, but it has no
production startup or timer caller in this precursor. Restores discard database
lease authority while retaining pending
generations, and a full-resync generation is processed only after its prepared
rebuild completes successfully. Producer and repair-loop activation remain a
separate change; automatic expired-lease reclaim remains forbidden until low-level
wallet-history mutations are fenced against a paused former owner.

The additive checkpoint repository also owns the only enrollment request and
completion writers. No production source calls the request writer. A bounded,
network-explicit enrollment coordinator composes the completion writer with
injected subscription batch I/O, but remains dormant: no API, server startup,
worker startup, subscription manager, or recovery loop constructs or calls it in
this precursor. Missing checkpoint rows remain rolling-upgrade
candidates, authoritative null status remains distinct from unknown status, and
partial or unavailable subscription batches do not silently mark enrollment
complete. Coordinator activation and transfer of live subscription ownership are
a separate reviewed change.

This ADR and `config/wallet-sync-lifecycle-contract.json` establish the target and
freeze the current compatibility exceptions. They do **not** retire the recurring
schedule, change a producer, install the durable disable marker, or claim that the
single-admission boundary is already complete.

## Executable invariants

| ID | Requirement |
| --- | --- |
| `WSYNC-LIFECYCLE-001` | Lifecycle and allowed wallet-history triggers match this decision. |
| `WSYNC-BLOCK-001` | Headers update tip/known confirmations only; time and headers do not request wallet history. |
| `WSYNC-ADMISSION-001` | The target has one durable admission module; compatibility exceptions cannot grow. |
| `WSYNC-WORKER-001` | The worker is the target low-level executor and subscription owner; the checkpoint enrollment coordinator remains dormant until that ownership transfer is activated. |
| `WSYNC-COMPAT-001` | Unversioned/v1 remain readable, generation-bound v2 is accepted only by the fenced worker consumer, production emission remains disabled, and unknown versions fail closed. |
| `WSYNC-STALE-001` | The stale scheduler remains explicitly legacy during the precursor and becomes forbidden only after the durable rollback floor is deployed. |

## Consequences

The compatibility inventory is intentionally a debt ledger. New direct
executors, wallet-job producers, subscription-checkpoint writers or coordinator
consumers, age-driven history paths, or spellings of the legacy job identities
fail required CI. Removing a listed legacy path also fails until the contract is
updated in the same reviewed change, preventing stale exceptions from disguising
progress.

The precursor does not reduce current sync frequency. It makes the later schema,
producer migration, scheduler retirement, and observation steps independently
reviewable and prevents the transition surface from expanding meanwhile.

## Rollout and rollback

Deploy additive schema, compatible readers, and the durable scheduler policy to
every API and worker replica before changing producers or setting the policy to
forbidden. Until then, `check-stale-wallets` remains desired.

After cutover begins, rollback is supported only to a binary that understands
and honors the durable forbidden marker. Rolling back below that floor would
recreate the schedule during recurring reconciliation and is unsupported.
The marker is included in complete backup payloads, restored into an empty
recovery database only after strict schema validation, and may never replace or
remove a marker already present in the live deployment.
