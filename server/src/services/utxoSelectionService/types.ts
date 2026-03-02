/**
 * UTXO Selection Types
 */

// UTXO selection strategy type (duplicated from frontend types for Docker build isolation)
export type SelectionStrategy =
  | 'privacy'
  | 'efficiency'
  | 'oldest_first'
  | 'largest_first'
  | 'smallest_first';

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
