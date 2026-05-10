import type { BitcoinNetwork } from '../networks';
import { BITCOIN_ELECTRUM_BROADCAST_PREFLIGHT_SCOPE } from '../validationEvidenceContracts';

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
export const BROADCAST_CANONICAL_INTENT_SOURCE_VALUES = [
  'draft',
  'decoded_payload',
] as const;
export type BroadcastIntentSource =
  typeof BROADCAST_CANONICAL_INTENT_SOURCE_VALUES[number];
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

export const BROADCAST_CANONICAL_INTENT_REQUIRED_FIELDS = [
  'walletId',
  'network',
  'source',
  'mode',
  'expectedInputs',
  'expectedOutputs',
  'expectedFeeSats',
] as const satisfies readonly (keyof CanonicalBroadcastIntent)[];

export type BroadcastCanonicalIntentField =
  typeof BROADCAST_CANONICAL_INTENT_REQUIRED_FIELDS[number];

export const BROADCAST_PAYLOAD_DERIVED_FIELDS = [
  'txid',
  'wtxid',
  'inputs',
  'outputs',
  'recipientOutputs',
  'changeOutputs',
  'feeSats',
  'vsize',
  'feeRateSatsPerVbyte',
] as const;

export type BroadcastPayloadDerivedField =
  typeof BROADCAST_PAYLOAD_DERIVED_FIELDS[number];

export const BROADCAST_REQUEST_METADATA_CONFLICT_FIELDS = [
  'walletId',
  'network',
  'recipient',
  'amount',
  'fee',
  'utxos',
  'draftId',
] as const;

export type BroadcastMetadataConflictField =
  typeof BROADCAST_REQUEST_METADATA_CONFLICT_FIELDS[number];

export type BroadcastInvariantPhase =
  | 'decode'
  | 'policy'
  | 'node_preflight'
  | 'persistence';

export type BroadcastAuthoritativeSource =
  | 'decoded_payload'
  | 'trusted_wallet_context'
  | 'wallet_state'
  | 'node_preflight';

export interface BroadcastInvariantSpec {
  name: string;
  phase: BroadcastInvariantPhase;
  authoritativeSource: BroadcastAuthoritativeSource;
  failureReason: BroadcastErrorReason;
  requiredBeforePropagation: true;
}

export const BROADCAST_PRE_PROPAGATION_INVARIANTS = [
  {
    name: 'intent_exists',
    phase: 'decode',
    authoritativeSource: 'trusted_wallet_context',
    failureReason: 'missing_intent',
    requiredBeforePropagation: true,
  },
  {
    name: 'signed_psbt_is_parseable',
    phase: 'decode',
    authoritativeSource: 'decoded_payload',
    failureReason: 'invalid_psbt',
    requiredBeforePropagation: true,
  },
  {
    name: 'raw_transaction_is_parseable',
    phase: 'decode',
    authoritativeSource: 'decoded_payload',
    failureReason: 'invalid_raw_transaction',
    requiredBeforePropagation: true,
  },
  {
    name: 'network_matches_wallet',
    phase: 'policy',
    authoritativeSource: 'trusted_wallet_context',
    failureReason: 'wrong_network',
    requiredBeforePropagation: true,
  },
  {
    name: 'request_metadata_matches_decoded_payload',
    phase: 'policy',
    authoritativeSource: 'decoded_payload',
    failureReason: 'metadata_mismatch',
    requiredBeforePropagation: true,
  },
  {
    name: 'wallet_owns_all_spent_inputs',
    phase: 'policy',
    authoritativeSource: 'wallet_state',
    failureReason: 'non_wallet_input',
    requiredBeforePropagation: true,
  },
  {
    name: 'input_values_are_known',
    phase: 'policy',
    authoritativeSource: 'wallet_state',
    failureReason: 'unknown_input_value',
    requiredBeforePropagation: true,
  },
  {
    name: 'change_outputs_are_wallet_owned',
    phase: 'policy',
    authoritativeSource: 'wallet_state',
    failureReason: 'unknown_change',
    requiredBeforePropagation: true,
  },
  {
    name: 'outputs_use_supported_scripts',
    phase: 'policy',
    authoritativeSource: 'decoded_payload',
    failureReason: 'unsupported_script',
    requiredBeforePropagation: true,
  },
  {
    name: 'outputs_are_not_dust',
    phase: 'policy',
    authoritativeSource: 'decoded_payload',
    failureReason: 'dust_output',
    requiredBeforePropagation: true,
  },
  {
    name: 'fee_is_within_wallet_policy',
    phase: 'policy',
    authoritativeSource: 'decoded_payload',
    failureReason: 'fee_too_high',
    requiredBeforePropagation: true,
  },
  {
    name: 'transaction_has_required_signatures',
    phase: 'policy',
    authoritativeSource: 'decoded_payload',
    failureReason: 'insufficient_signatures',
    requiredBeforePropagation: true,
  },
  {
    name: 'transaction_is_finalizable',
    phase: 'policy',
    authoritativeSource: 'decoded_payload',
    failureReason: 'not_finalizable',
    requiredBeforePropagation: true,
  },
  {
    name: 'node_preflight_is_available_when_required',
    phase: 'node_preflight',
    authoritativeSource: 'node_preflight',
    failureReason: 'node_preflight_unavailable',
    requiredBeforePropagation: true,
  },
  {
    name: 'configured_electrum_prevouts_are_unspent',
    phase: 'node_preflight',
    authoritativeSource: 'node_preflight',
    failureReason: 'node_preflight_rejected',
    requiredBeforePropagation: true,
  },
] as const satisfies readonly BroadcastInvariantSpec[];

export const BROADCAST_RUNTIME_PREFLIGHT_SCOPE = BITCOIN_ELECTRUM_BROADCAST_PREFLIGHT_SCOPE;

export interface BroadcastEntrypointSpec {
  name: string;
  mode: BroadcastPayloadMode;
  canonicalDecodeRequired: true;
  requestMetadataRole: 'conflict_check_only';
  nodePreflightRequired: true;
}

export const BROADCAST_ENTRYPOINTS = [
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
] as const satisfies readonly BroadcastEntrypointSpec[];

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
