import { describe, expect, it } from 'vitest';
import {
  BROADCAST_CANONICAL_INTENT_REQUIRED_FIELDS,
  BROADCAST_CANONICAL_INTENT_SOURCE_VALUES,
  BROADCAST_DRAFT_RETENTION_POLICY,
  BROADCAST_ENTRYPOINTS,
  BROADCAST_ERROR_REASON_VALUES,
  BROADCAST_EXACTLY_ONCE_SIDE_EFFECTS,
  BROADCAST_PAYLOAD_DERIVED_FIELDS,
  BROADCAST_PRE_PROPAGATION_INVARIANTS,
  BROADCAST_REQUEST_METADATA_CONFLICT_FIELDS,
  getBroadcastFailureRetryPolicy,
  isBroadcastErrorReason,
  selectBroadcastIdempotencyBasis,
  type CanonicalBroadcastIntent,
} from '../../../../../src/services/bitcoin/transactions/broadcastContracts';

const REQUIRED_REASON_CODES = [
  'missing_intent',
  'stale_utxo',
  'frozen_utxo',
  'locked_utxo',
  'pending_approval',
  'approval_rejected',
  'approval_vetoed',
  'approval_expired',
  'wrong_network',
  'metadata_mismatch',
  'invalid_psbt',
  'invalid_raw_transaction',
  'unsupported_script',
  'insufficient_signatures',
  'invalid_signature',
  'signer_metadata_mismatch',
  'missing_witness_data',
  'not_finalizable',
  'unknown_change',
  'non_wallet_input',
  'unknown_input_value',
  'dust_output',
  'fee_too_high',
  'fee_too_low',
  'already_known',
  'duplicate_submission',
  'post_acceptance_persistence_race',
  'node_preflight_unavailable',
  'node_preflight_rejected',
  'node_timeout',
  'node_failure',
] as const;

const REQUIRED_PRE_PROPAGATION_INVARIANTS = [
  'intent_exists',
  'signed_psbt_is_parseable',
  'raw_transaction_is_parseable',
  'network_matches_wallet',
  'request_metadata_matches_decoded_payload',
  'wallet_owns_all_spent_inputs',
  'input_values_are_known',
  'change_outputs_are_wallet_owned',
  'outputs_use_supported_scripts',
  'outputs_are_not_dust',
  'fee_is_within_wallet_policy',
  'fee_meets_relay_policy',
  'transaction_has_required_signatures',
  'transaction_is_finalizable',
  'node_preflight_is_available_when_required',
  'node_accepts_final_transaction',
] as const;

describe('broadcast contracts', () => {
  it('defines the structured reason-code registry required by later slices', () => {
    expect(BROADCAST_ERROR_REASON_VALUES).toEqual(REQUIRED_REASON_CODES);
    expect(new Set(BROADCAST_ERROR_REASON_VALUES).size).toBe(
      BROADCAST_ERROR_REASON_VALUES.length,
    );
    expect(isBroadcastErrorReason('wrong_network')).toBe(true);
    expect(isBroadcastErrorReason('human readable node error')).toBe(false);
  });

  it('classifies retry behavior without relying on human error messages', () => {
    expect(getBroadcastFailureRetryPolicy('missing_intent')).toBe('terminal');
    expect(getBroadcastFailureRetryPolicy('invalid_signature')).toBe('terminal');
    expect(getBroadcastFailureRetryPolicy('metadata_mismatch')).toBe('terminal');
    expect(getBroadcastFailureRetryPolicy('node_preflight_rejected')).toBe(
      'terminal',
    );
    expect(getBroadcastFailureRetryPolicy('already_known')).toBe('idempotent_success');
    expect(getBroadcastFailureRetryPolicy('duplicate_submission')).toBe(
      'idempotent_success',
    );
    expect(getBroadcastFailureRetryPolicy('node_timeout')).toBe(
      'retry_after_idempotency',
    );
    expect(getBroadcastFailureRetryPolicy('post_acceptance_persistence_race')).toBe(
      'retry_after_idempotency',
    );
  });

  it('rejects request metadata as an authoritative canonical intent source', () => {
    expect(BROADCAST_CANONICAL_INTENT_SOURCE_VALUES).toEqual([
      'draft',
      'decoded_payload',
    ]);
    expect(BROADCAST_CANONICAL_INTENT_SOURCE_VALUES).not.toContain(
      'request_metadata',
    );
  });

  it('pins the fields that must exist before broadcast propagation', () => {
    expect(BROADCAST_CANONICAL_INTENT_REQUIRED_FIELDS).toEqual([
      'walletId',
      'network',
      'source',
      'mode',
      'expectedInputs',
      'expectedOutputs',
      'expectedFeeSats',
    ]);
    expect(BROADCAST_PAYLOAD_DERIVED_FIELDS).toEqual([
      'txid',
      'wtxid',
      'inputs',
      'outputs',
      'recipientOutputs',
      'changeOutputs',
      'feeSats',
      'vsize',
      'feeRateSatsPerVbyte',
    ]);
  });

  it('treats request metadata only as conflict-check input', () => {
    expect(BROADCAST_REQUEST_METADATA_CONFLICT_FIELDS).toEqual([
      'walletId',
      'network',
      'recipient',
      'amount',
      'fee',
      'utxos',
      'draftId',
    ]);

    expect(BROADCAST_PRE_PROPAGATION_INVARIANTS).toContainEqual({
      name: 'request_metadata_matches_decoded_payload',
      phase: 'policy',
      authoritativeSource: 'decoded_payload',
      failureReason: 'metadata_mismatch',
      requiredBeforePropagation: true,
    });
  });

  it('requires every broadcast entrypoint to canonical-decode before propagation', () => {
    expect(BROADCAST_ENTRYPOINTS).toEqual([
      {
        name: 'transactions_broadcast_signed_psbt',
        mode: 'signed_psbt',
        canonicalDecodeRequired: true,
        requestMetadataRole: 'conflict_check_only',
        nodePreflightRequired: true,
      },
      {
        name: 'transactions_broadcast_draft_signed_psbt',
        mode: 'signed_psbt',
        canonicalDecodeRequired: true,
        requestMetadataRole: 'conflict_check_only',
        nodePreflightRequired: true,
      },
      {
        name: 'transactions_broadcast_raw_transaction',
        mode: 'raw_transaction',
        canonicalDecodeRequired: true,
        requestMetadataRole: 'conflict_check_only',
        nodePreflightRequired: true,
      },
      {
        name: 'psbt_broadcast_signed_psbt',
        mode: 'signed_psbt',
        canonicalDecodeRequired: true,
        requestMetadataRole: 'conflict_check_only',
        nodePreflightRequired: true,
      },
    ]);
  });

  it('defines the pre-propagation invariant matrix for the enforcement slice', () => {
    expect(BROADCAST_PRE_PROPAGATION_INVARIANTS.map(({ name }) => name)).toEqual(
      REQUIRED_PRE_PROPAGATION_INVARIANTS,
    );
    expect(
      new Set(BROADCAST_PRE_PROPAGATION_INVARIANTS.map(({ name }) => name)).size,
    ).toBe(BROADCAST_PRE_PROPAGATION_INVARIANTS.length);
    expect(
      BROADCAST_PRE_PROPAGATION_INVARIANTS.every(
        ({ requiredBeforePropagation }) => requiredBeforePropagation,
      ),
    ).toBe(true);
    expect(
      BROADCAST_PRE_PROPAGATION_INVARIANTS.every(
        ({ failureReason }) => isBroadcastErrorReason(failureReason),
      ),
    ).toBe(true);
  });

  it('pins node preflight as a required fail-closed phase', () => {
    expect(BROADCAST_PRE_PROPAGATION_INVARIANTS.filter(
      ({ phase }) => phase === 'node_preflight',
    )).toEqual([
      {
        name: 'node_preflight_is_available_when_required',
        phase: 'node_preflight',
        authoritativeSource: 'node_preflight',
        failureReason: 'node_preflight_unavailable',
        requiredBeforePropagation: true,
      },
      {
        name: 'node_accepts_final_transaction',
        phase: 'node_preflight',
        authoritativeSource: 'node_preflight',
        failureReason: 'node_preflight_rejected',
        requiredBeforePropagation: true,
      },
    ]);
  });

  it('selects txid as the primary idempotency basis before draft payload hash', () => {
    expect(selectBroadcastIdempotencyBasis({
      txid: ' tx-1 ',
      draftId: 'draft-1',
      payloadHash: 'hash-1',
    })).toEqual({ kind: 'txid', value: 'tx-1' });

    expect(selectBroadcastIdempotencyBasis({
      draftId: ' draft-1 ',
      payloadHash: ' hash-1 ',
    })).toEqual({ kind: 'draft_payload', value: 'draft-1:hash-1' });

    expect(selectBroadcastIdempotencyBasis({
      draftId: 'draft-1',
      payloadHash: '',
    })).toEqual({ kind: 'missing', value: null });
  });

  it('pins the draft retention decision for server-owned broadcast lifecycle', () => {
    expect(BROADCAST_DRAFT_RETENTION_POLICY).toEqual({
      terminalStatus: 'broadcasted',
      actionAfterAcceptedBroadcast: 'archive',
      releaseUtxoLocks: true,
      preserveApprovalHistory: true,
      hideFromActionableDraftLists: true,
    });
  });

  it('records exactly-once side effects that must share the idempotency gate', () => {
    expect(BROADCAST_EXACTLY_ONCE_SIDE_EFFECTS).toEqual([
      'policy_usage',
      'audit_success',
      'notifications',
      'websocket_events',
      'draft_lifecycle',
    ]);
  });

  it('captures the canonical intent shape for draft-backed broadcast', () => {
    const intent: CanonicalBroadcastIntent = {
      walletId: 'wallet-1',
      network: 'testnet4',
      source: 'draft',
      mode: 'signed_psbt',
      draftId: 'draft-1',
      unsignedPsbtBase64: 'unsigned-psbt',
      expectedInputs: [{ txid: 'a'.repeat(64), vout: 0, amountSats: 10_000 }],
      expectedOutputs: [
        { address: 'tb1qrecipient', amountSats: 8_000, type: 'recipient' },
        { address: 'tb1qchange', amountSats: 1_500, type: 'change' },
      ],
      expectedFeeSats: 500,
      changeAddress: 'tb1qchange',
    };

    expect(intent.network).toBe('testnet4');
    expect(intent.expectedOutputs.map(output => output.type)).toEqual([
      'recipient',
      'change',
    ]);
  });

  it('captures the canonical intent shape for decoded payload broadcast', () => {
    const intent: CanonicalBroadcastIntent = {
      walletId: 'wallet-1',
      network: 'testnet4',
      source: 'decoded_payload',
      mode: 'raw_transaction',
      expectedInputs: [{ txid: 'b'.repeat(64), vout: 1, amountSats: 12_000 }],
      expectedOutputs: [
        { address: 'tb1qrecipient', amountSats: 10_000, type: 'recipient' },
      ],
      expectedFeeSats: 2_000,
    };

    expect(intent.source).toBe('decoded_payload');
    expect(intent.mode).toBe('raw_transaction');
  });
});
