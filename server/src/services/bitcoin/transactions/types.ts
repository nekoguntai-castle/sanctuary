/**
 * Transaction Types
 *
 * Shared type definitions for transaction creation, broadcasting, and persistence.
 */

import * as bitcoin from 'bitcoinjs-lib';
import type { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import type { SigningIntentFeePolicyV1 } from '../signingIntent/types';

export type { PrismaTxClient } from '../../../models/prisma';

/**
 * Input metadata for transaction storage
 */
export interface TransactionInputMetadata {
  txid: string;
  vout: number;
  address: string;
  amount: number;
  derivationPath?: string;
}

/**
 * Output metadata for transaction storage
 */
export interface TransactionOutputMetadata {
  address: string;
  amount: number;
  outputType: 'recipient' | 'change' | 'decoy' | 'consolidation' | 'unknown';
  isOurs: boolean;
  scriptPubKey?: string;
}

/**
 * Output definition for batch transactions
 */
export interface TransactionOutput {
  address: string;
  amount: number;
  sendMax?: boolean; // If true, allocate remaining balance to this output
}

/**
 * Pending output for PSBT construction (used for output shuffling)
 */
export interface PendingOutput {
  address: string;
  value: number;
  type: 'recipient' | 'change' | 'decoy';
}

/**
 * Result from createTransaction
 */
export interface CreateTransactionResult {
  psbt: bitcoin.Psbt;
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  utxos: Array<{ txid: string; vout: number; address?: string; amount?: number }>;
  inputPaths: string[]; // Derivation paths for hardware wallet signing
  effectiveAmount: number; // The actual amount being sent
  decoyOutputs?: Array<{ address: string; amount: number }>; // Decoy change outputs
  signingContext: PsbtSigningContext;
  feePolicy: SigningIntentFeePolicyV1;
}

/**
 * Result from createBatchTransaction
 */
export interface CreateBatchTransactionResult {
  psbt: bitcoin.Psbt;
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  utxos: Array<{ txid: string; vout: number; address?: string; amount?: number }>;
  inputPaths: string[];
  outputs: Array<{ address: string; amount: number }>;
  signingContext: PsbtSigningContext;
  feePolicy: SigningIntentFeePolicyV1;
}

/**
 * Result from broadcastAndSave
 */
export interface BroadcastResult {
  txid: string;
  broadcasted: boolean;
  persistenceStatus: 'complete' | 'pending_reconciliation';
  persistenceReason?: 'post_acceptance_persistence_race';
}

/**
 * Internal UTXO selection result shape used by createTransaction.
 */
export interface UtxoSelection {
  utxos: Array<{
    txid: string;
    vout: number;
    amount: number;
    address: string;
    scriptPubKey: string;
  }>;
  totalAmount: number;
  estimatedFee: number;
  changeAmount: number;
  changeOutputCount?: number;
  feeSurplusSats?: number;
}

/**
 * Resolved wallet signing info - extracted from wallet/devices/descriptor
 * for use in PSBT construction
 */
export interface WalletSigningInfo {
  scriptType: WalletScriptType;
  masterFingerprint?: Buffer;
  accountXpub?: string;
  accountPath?: string;
  multisigKeys?: import('../addressDerivation').MultisigKeyInfo[];
  multisigQuorum?: number;
  multisigScriptType?: 'wsh-sortedmulti' | 'sh-wsh-sortedmulti';
  isMultisig: boolean;
}
