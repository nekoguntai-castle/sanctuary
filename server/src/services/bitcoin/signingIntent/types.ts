import type { BitcoinNetwork } from '../networks';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';

export const SIGNING_INTENT_SNAPSHOT_VERSION = 1 as const;

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

export interface SigningIntentSnapshotV1 {
  version: typeof SIGNING_INTENT_SNAPSHOT_VERSION;
  walletId: string;
  network: BitcoinNetwork;
  transaction: {
    version: number;
    locktime: number;
    replacementTxid?: string;
    inputs: SigningIntentInput[];
    outputs: SigningIntentOutput[];
  };
}

export interface SigningIntentHandle {
  intentId: string;
  intentDigest: string;
}

export type IssuedSigningIntentHandle = SigningIntentHandle & {
  signingContext: PsbtSigningContext;
};

export interface SigningIntentEnvelope extends SigningIntentHandle {
  signingContext?: PsbtSigningContext;
  snapshot: SigningIntentSnapshotV1;
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
  inputRoles?: SigningIntentInputRole[];
  supersedesIntentId?: string;
  replacementTxid?: string;
  expiresAt?: Date;
  signingContext: PsbtSigningContext;
}
