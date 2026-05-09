# Bug Scrub Slice 1 Broadcast Contracts

Date: 2026-05-08

Scope: Slice 1 defines the contracts later slices must implement before changing broadcast behavior. The executable contract source is `server/src/services/bitcoin/transactions/broadcastContracts.ts`.

## Idempotency

- Primary identity is the locally extracted final `txid`.
- Fallback identity is `draftId:payloadHash` only when a final `txid` cannot be extracted yet.
- Duplicate submissions and node `already known` responses must converge on one wallet transaction row and one side-effect set.
- `policy_usage`, `audit_success`, `notifications`, `websocket_events`, and `draft_lifecycle` are exactly-once side effects behind the idempotency gate.
- Generic frontend retry should stay disabled for broadcast until the server applies this idempotency contract.

## Structured Error Reasons

Broadcast failures must use machine-readable reason codes, not message parsing. The initial registry covers:

- intent and input state: `missing_intent`, `stale_utxo`, `frozen_utxo`, `locked_utxo`
- policy state: `pending_approval`, `approval_rejected`, `approval_vetoed`, `approval_expired`
- network and payload validity: `wrong_network`, `invalid_psbt`, `invalid_raw_transaction`, `fee_too_low`
- readiness/finality: `insufficient_signatures`, `invalid_signature`, `signer_metadata_mismatch`, `missing_witness_data`, `not_finalizable`
- idempotent outcomes and infrastructure: `already_known`, `duplicate_submission`, `post_acceptance_persistence_race`, `node_timeout`, `node_failure`

Reason retry policy is encoded in `getBroadcastFailureRetryPolicy`. Most validation failures are terminal. `already_known` and `duplicate_submission` are idempotent success paths. Node timeout/failure and post-acceptance persistence races may retry only after server idempotency is active.

## Readiness And Finality

Server-side broadcast readiness must not trust UI `canBroadcast`, draft `status`, or `signedDeviceIds`.

- PSBT broadcast must prove sufficient signatures, valid signatures, signer metadata alignment, witness/non-witness data presence, and final extractability.
- Raw transaction broadcast must compute the final local txid, decode with wallet network context, prove wallet input ownership, and compare outputs/fee against canonical intent.
- Partial multisig PSBTs must fail before node broadcast with specific reason codes.

## Canonical Intent

All broadcast paths resolve one `CanonicalBroadcastIntent` before payload validation:

- `walletId`, `network`, `source`, and payload `mode`
- expected input outpoints and optional input amounts/addresses
- expected recipient/change/decoy outputs
- expected fee in sats
- optional `draftId`, original unsigned PSBT, change address, and send-max flag

Draft data is the preferred intent source when `draftId` exists. Request metadata is a fallback only when the schema proves it is complete enough to validate.

## Draft Retention

The Slice 1 decision is archive/mark-broadcasted, not hard delete.

- Successful accepted broadcast moves draft lifecycle to terminal `broadcasted`.
- UTXO locks are released by the server.
- Approval history is preserved.
- Broadcasted drafts are hidden from actionable draft lists.
- Maintenance cleanup can later purge or compact archived drafts only after audit-retention requirements are met.
