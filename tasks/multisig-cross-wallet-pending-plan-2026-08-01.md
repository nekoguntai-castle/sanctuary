# Multisig Cross-Wallet Pending Receive Implementation Plan

## Goal

Make a Sanctuary multisig-to-multisig send appear immediately as a pending send
for the source wallet and a pending receive for the destination wallet, without
duplicating side effects or exposing sender-private metadata.

## Evidence And Constraints

- The incident deployment and txid are unavailable from this host, so the live
  SQL discriminator cannot be run here.
- Wallet navigation performs a fresh wallet-scoped transaction fetch; the list
  and pending APIs do not filter out pending `received` rows. A committed receiver
  row should therefore render without a frontend change.
- Signed multisig broadcasts are extracted to raw transactions before persistence.
  Bitcoinjs supports both P2WSH and P2SH-P2WSH output decoding; existing tests do
  not exercise a signed multisig input paying either destination type.
- Receiver discovery is an exact lookup against persisted `Address` rows. A miss
  and a parsing, lookup, or persistence error currently collapse to the same empty
  result.
- Sender and receiver writes already share one PostgreSQL transaction. A failed
  statement aborts that transaction; swallowing the error cannot safely commit
  the sender row.
- Receiver rows currently inherit the sender's private label and lack receiver
  transaction output detail.
- Backend coverage gates are 100% for branches, functions, lines, and statements.

## Phase 1: Exercise And Harden The Internal-Receive Boundary

- [x] Add deterministic signed 2-of-2 PSBT fixtures with P2WSH and P2SH-P2WSH
  destinations, without Bitcoin Core.
- [x] Exercise the real `broadcastAndSave` signed-PSBT path and persistence
  callback; assert distinct sender and receiver rows, positive receiver amount,
  zero confirmations, null block height, no inherited sender label, and receiver
  output detail.
- [x] Add controls for no internal recipient, multiple outputs to one receiver,
  multiple receiver wallets, sender change, and an existing receiver row.
- [x] Record the available baseline evidence: signed multisig extraction and exact
  persisted-address matching succeed; an injected receiver persistence failure is
  silently swallowed. The original incident cannot be reproduced without its
  deployment state, txid, or database evidence.
- [x] Replace the broad internal-receive catch with stage-specific behavior:
  unsupported/non-address outputs remain valid skips; sender-wallet absence,
  transaction parse failures, ownership-query failures, and non-unique persistence
  failures must not be reported as successful persistence.
- [x] Return explicit `created` and `existing` receiver outcomes. Recalculate both;
  emit events and notifications only for newly created rows.
- [x] Keep ownership matching authoritative inside the existing transaction,
  wallet-scoped, exact-network-consistent, and aggregated per receiving wallet.
- [x] Do not copy the source wallet's label or memo to receiver rows. Persist the
  receiver's owned outputs so transaction detail is meaningful.
- [x] Verify the existing focused API assertions expose pending `received` rows in
  wallet transaction reads; add no rendering change because the frontend loading
  path already refetches the selected wallet.

## Phase 2: Post-Acceptance Recovery Gate

Independent review demonstrated that the sender's catch-and-query unique handling
cannot work inside an aborted PostgreSQL transaction and that any post-acceptance
persistence failure currently becomes an ordinary API error. Complete this phase
in the same atomic delivery because the network broadcast already precedes the
database transaction.

- [x] Replace sender create/catch/query idempotency with a conflict-free insert and
  lookup that remains valid in PostgreSQL.
- [x] Classify only known Prisma transaction conflicts that guarantee rollback.
- [x] Retry `persistTransaction` with a fresh database transaction and a strict
  bound; never rebroadcast the Bitcoin transaction.
- [x] Prove node broadcast, policy accounting, audit success, notifications,
  websocket events, and draft lifecycle side effects are not duplicated.
- [x] Surface unresolved accepted-but-unpersisted state with the accepted txid and
  reconciliation status; do not call it an ordinary terminal failure.
- [x] Keep post-commit balance and event failures non-terminal, and show the
  accepted-but-reconciling state as a frontend warning without a success sound.

## Verification

- [x] Run focused transaction broadcast, persistence, cross-wallet, pending-route,
  and transaction-detail tests.
- [x] Run backend app and test TypeScript checks.
- [x] Run the full backend suite and backend coverage.
- [x] If frontend code changes, run focused frontend tests, all three frontend
  TypeScript checks, and full frontend coverage.
- [x] Review null/empty outputs, duplicate rows, multiple receivers, network
  mismatches, transaction rollback, event ownership, and metadata privacy.
- [ ] Deliver through protected PR flow, verify merge ancestry and target-branch
  CI, then clean only the implementation-owned branch/worktree.

## Acceptance Criteria

- A signed Sanctuary multisig transaction paying persisted P2WSH or P2SH-P2WSH
  addresses in another Sanctuary wallet commits one pending row per affected wallet.
- Receiver list, pending, and detail APIs expose the receiver transaction, and
  wallet navigation renders it without a manual reload.
- Receiver amounts include only outputs owned by that wallet; sender change, fees,
  other wallets' outputs, labels, and memos are excluded.
- Reprocessing is idempotent: rows are not duplicated, existing rows receive
  balance repair, and notifications/events are not repeated.
- Internal-receive failures cannot silently masquerade as successful persistence.

## Backout

No schema migration is expected. Revert the receiver persistence and outcome
changes together; normal wallet sync remains the reconciliation path for accepted
on-chain transactions.
