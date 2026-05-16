/**
 * UTXO Selection Types
 */

import type { UtxoSelectionStrategy } from '@sanctuary/shared/constants/transactions';

export type SelectionStrategy = UtxoSelectionStrategy;

export interface SelectedUtxo {
  id: string;
  txid: string;
  vout: number;
  address: string;
  amount: bigint;
  confirmations: number;
  blockHeight?: number;
}

export interface SelectionResult {
  selected: SelectedUtxo[];
  totalAmount: bigint;
  estimatedFee: bigint;
  changeAmount: bigint;
  inputCount: number;
  strategy: SelectionStrategy;
  warnings: string[];
  privacyImpact?: {
    linkedAddresses: number;
    score: number;
  };
}

export interface SelectionOptions {
  walletId: string;
  targetAmount: bigint;
  feeRate: number;
  strategy: SelectionStrategy;
  excludeFrozen?: boolean;
  excludeUnconfirmed?: boolean;
  excludeUtxoIds?: string[];
  scriptType?: string;
}
