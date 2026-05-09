import type { BitcoinNetwork } from '../networks';

export const BROADCAST_ERROR_REASON_VALUES = [
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

export type BroadcastErrorReason = typeof BROADCAST_ERROR_REASON_VALUES[number];

export type BroadcastFailureRetryPolicy =
  | 'terminal'
  | 'idempotent_success'
  | 'retry_after_idempotency';

const IDEMPOTENT_SUCCESS_REASONS = new Set<BroadcastErrorReason>([
  'already_known',
  'duplicate_submission',
]);

const RETRY_AFTER_IDEMPOTENCY_REASONS = new Set<BroadcastErrorReason>([
  'node_timeout',
  'node_failure',
  'post_acceptance_persistence_race',
]);

export function isBroadcastErrorReason(value: unknown): value is BroadcastErrorReason {
  return (
    typeof value === 'string' &&
    BROADCAST_ERROR_REASON_VALUES.includes(value as BroadcastErrorReason)
  );
}

export function getBroadcastFailureRetryPolicy(
  reason: BroadcastErrorReason,
): BroadcastFailureRetryPolicy {
  if (IDEMPOTENT_SUCCESS_REASONS.has(reason)) return 'idempotent_success';
  if (RETRY_AFTER_IDEMPOTENCY_REASONS.has(reason)) return 'retry_after_idempotency';
  return 'terminal';
}

export type BroadcastPayloadMode = 'signed_psbt' | 'raw_transaction';
export type BroadcastIntentSource = 'draft' | 'request_metadata';
export type BroadcastIntentOutputType = 'recipient' | 'change' | 'decoy';

export interface CanonicalBroadcastInput {
  txid: string;
  vout: number;
  amountSats?: number;
  address?: string;
}

export interface CanonicalBroadcastOutput {
  address: string;
  amountSats: number;
  type: BroadcastIntentOutputType;
}

export interface CanonicalBroadcastIntent {
  walletId: string;
  network: BitcoinNetwork;
  source: BroadcastIntentSource;
  mode: BroadcastPayloadMode;
  expectedInputs: CanonicalBroadcastInput[];
  expectedOutputs: CanonicalBroadcastOutput[];
  expectedFeeSats: number;
  draftId?: string;
  unsignedPsbtBase64?: string;
  changeAddress?: string;
  sendMax?: boolean;
}

export type BroadcastIdempotencyBasis =
  | { kind: 'txid'; value: string }
  | { kind: 'draft_payload'; value: string }
  | { kind: 'missing'; value: null };

export interface BroadcastIdempotencyInput {
  txid?: string | null;
  draftId?: string | null;
  payloadHash?: string | null;
}

export function selectBroadcastIdempotencyBasis(
  input: BroadcastIdempotencyInput,
): BroadcastIdempotencyBasis {
  const txid = input.txid?.trim();
  if (txid) return { kind: 'txid', value: txid };

  const draftId = input.draftId?.trim();
  const payloadHash = input.payloadHash?.trim();
  if (draftId && payloadHash) {
    return { kind: 'draft_payload', value: `${draftId}:${payloadHash}` };
  }

  return { kind: 'missing', value: null };
}

export const BROADCAST_DRAFT_RETENTION_POLICY = {
  terminalStatus: 'broadcasted',
  actionAfterAcceptedBroadcast: 'archive',
  releaseUtxoLocks: true,
  preserveApprovalHistory: true,
  hideFromActionableDraftLists: true,
} as const;

export const BROADCAST_EXACTLY_ONCE_SIDE_EFFECTS = [
  'policy_usage',
  'audit_success',
  'notifications',
  'websocket_events',
  'draft_lifecycle',
] as const;
