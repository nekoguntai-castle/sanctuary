import { describe, expect, it } from 'vitest';
import {
  BROADCAST_DRAFT_RETENTION_POLICY,
  BROADCAST_ERROR_REASON_VALUES,
  BROADCAST_EXACTLY_ONCE_SIDE_EFFECTS,
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
  'invalid_psbt',
  'invalid_raw_transaction',
  'insufficient_signatures',
  'invalid_signature',
  'signer_metadata_mismatch',
  'missing_witness_data',
  'not_finalizable',
  'fee_too_low',
  'already_known',
  'duplicate_submission',
  'post_acceptance_persistence_race',
  'node_timeout',
  'node_failure',
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

  it('captures the canonical intent shape for draft-backed and metadata-backed broadcast', () => {
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
});
