# Bug Scrub Slice 2: Draft Broadcast Lifecycle

Date: 2026-05-08

## Scope

Slice 2 turns the Slice 1 broadcast contract into an executable draft-backed broadcast path:

- Clients may send `draftId` with a transaction broadcast request.
- The server owns post-acceptance draft cleanup.
- Broadcast checks approval state before touching the Bitcoin node.
- Broadcasted drafts are archived instead of hard-deleted.
- Archived drafts are hidden from normal actionable draft lists.

## Implemented Contracts

### Request Contract

`MobileTransactionBroadcastRequestSchema` accepts `draftId` as a broadcast intent source. A request must provide at least one of:

- `signedPsbtBase64`
- `rawTxHex`
- `draftId`

When a request is draft-only, the server uses the draft's stored signed PSBT and transaction metadata.

### Approval Gate

Draft-backed broadcasts are rejected before policy evaluation or node broadcast unless:

- `status` is one of `unsigned`, `partial`, or `signed`
- `approvalStatus` is `not_required` or `approved`

Rejected approval states map to Slice 1 reason codes:

- `pending` -> `pending_approval`
- `rejected` -> `approval_rejected`
- `vetoed` -> `approval_vetoed`
- `expired` -> `approval_expired`

Archived drafts return `409 Conflict` with reason `duplicate_submission`.

### Server-Owned Lifecycle

After an accepted network broadcast, `persistTransaction` now performs draft lifecycle cleanup in the same persistence transaction as sent transaction storage:

- Releases UTXO locks for `draftId`.
- Updates the draft status to `broadcasted`.
- Leaves approval history and draft row data intact.

The frontend no longer calls `DELETE /drafts/:draftId` after broadcast. It sends `draftId` and relies on the server to archive.

### Actionable Draft Lists

Repository list/update paths now treat only `unsigned`, `partial`, and `signed` drafts as actionable:

- `findByWalletId` hides `broadcasted` drafts.
- `findByUserId` hides `broadcasted` drafts.
- `update` refuses non-actionable drafts through an atomic `updateMany` gate.
- Expired-draft and spent-UTXO reconciliation cleanup only hard-delete actionable drafts, preserving archived broadcast records and approval history.

## Residual Risks And Follow-Ups

- This slice does not implement full mempool idempotency reconciliation for already-known transactions. That remains part of the broader broadcast error/idempotency backlog.
- The draft row is archived after accepted broadcast, not pre-locked before node submission. Concurrent signing updates after acceptance are rejected by the actionable update gate, but pre-submit simultaneous operations can still race in the narrow window before node acceptance.
- Draft metadata fallback currently parses `selectedUtxoIds` in `txid:vout` format. Existing clients still send explicit `utxos`; malformed stored IDs fall back to an empty list rather than blocking broadcast.
