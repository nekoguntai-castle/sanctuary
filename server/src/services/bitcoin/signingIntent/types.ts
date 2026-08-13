import type { BitcoinNetwork } from '../networks';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';

export const LEGACY_SIGNING_INTENT_SNAPSHOT_VERSION = 1 as const;
export const SIGNING_INTENT_SNAPSHOT_VERSION = 2 as const;
export const SIGNING_INTENT_MIN_FEE_RATE = 0.1;
export const SIGNING_INTENT_MAX_FEE_RATE = 1000;

export const SIGNING_INTENT_SOURCE_VALUES = [
  'standard',
  'batch',
  'hardware',
  'rbf',
  'cpfp',
  'advanced_batch',
  'agent',
  'payjoin',
] as const;

export type SigningIntentSource = typeof SIGNING_INTENT_SOURCE_VALUES[number];
export type SigningIntentInputRole = 'wallet' | 'payjoin_peer';

export interface SigningIntentPrevout {
  amountSats: string;
  scriptPubKeyHex: string;
  role: SigningIntentInputRole;
}

export interface SigningIntentInput {
  txid: string;
  vout: number;
  sequence: number;
  prevout: SigningIntentPrevout;
}

export interface SigningIntentOutput {
  amountSats: string;
  scriptPubKeyHex: string;
}

interface SigningIntentTransactionSnapshot {
  version: number;
  locktime: number;
  replacementTxid?: string;
  inputs: SigningIntentInput[];
  outputs: SigningIntentOutput[];
}

export interface SigningIntentSnapshotV1 {
  version: typeof LEGACY_SIGNING_INTENT_SNAPSHOT_VERSION;
  walletId: string;
  network: BitcoinNetwork;
  transaction: SigningIntentTransactionSnapshot;
}

/**
 * Fee authorization is evaluated against the final witness-bearing transaction.
 * `expectedFeeSats` binds the exact absolute fee authorized at construction.
 * `roundingToleranceSats` is only an inclusive bound on the absolute difference
 * between that fee and `ceil(requestedFeeRateSatsPerVbyte * finalVsize)`; it
 * never authorizes the final fee to differ from `expectedFeeSats`.
 */
export interface SigningIntentFeePolicyV1 {
  version: 1;
  expectedFeeSats: number;
  requestedFeeRateSatsPerVbyte: number;
  roundingMode: 'ceil';
  roundingToleranceSats: number;
}

export interface SigningIntentSnapshotV2 {
  version: typeof SIGNING_INTENT_SNAPSHOT_VERSION;
  walletId: string;
  network: BitcoinNetwork;
  feePolicy: SigningIntentFeePolicyV1;
  transaction: SigningIntentTransactionSnapshot;
}

export type SigningIntentSnapshot = SigningIntentSnapshotV1 | SigningIntentSnapshotV2;

export interface SigningIntentHandle {
  intentId: string;
  intentDigest: string;
}

export type IssuedSigningIntentHandle = SigningIntentHandle & {
  signingContext: PsbtSigningContext;
};

export interface SigningIntentEnvelope extends SigningIntentHandle {
  signingContext?: PsbtSigningContext;
  snapshot: SigningIntentSnapshot;
  unsignedPsbtBase64: string;
  unsignedPsbtSha256: string;
  source: SigningIntentSource;
  expiresAt: Date;
  broadcastReplay?: {
    state: 'accepted' | 'complete';
    txid: string;
    rawTx: string;
  };
}

export interface CreateSigningIntentInput {
  walletId: string;
  createdByUserId: string;
  network: BitcoinNetwork;
  source: SigningIntentSource;
  unsignedPsbtBase64: string;
  feePolicy: SigningIntentFeePolicyV1;
  inputRoles?: SigningIntentInputRole[];
  supersedesIntentId?: string;
  replacementTxid?: string;
  expiresAt?: Date;
  signingContext: PsbtSigningContext;
}
