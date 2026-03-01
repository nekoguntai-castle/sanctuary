/**
 * Transactions API Types
 *
 * Type definitions for transaction, UTXO, and privacy API calls
 */

import type { Transaction, UTXO, SelectionStrategy } from '../../types';

// Re-export types for backward compatibility
export type { Label, Transaction, UTXO, Address, PendingTransaction, SelectionStrategy } from '../../types';

// ========================================
// TRANSACTION QUERY TYPES
// ========================================

export interface GetTransactionsParams {
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | string[] | undefined | null;
}

export interface GetAddressesParams {
  used?: boolean;
  limit?: number;
  offset?: number;
}

export interface GetUTXOsResponse {
  utxos: UTXO[];
  count: number;
  totalBalance: number;
}

export interface GetUTXOsParams {
  limit?: number;
  offset?: number;
}

// ========================================
// TRANSACTION CREATION TYPES
// ========================================

export interface CreateTransactionRequest {
  recipient: string;
  amount: number;
  feeRate: number;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  label?: string;
  memo?: string;
  sendMax?: boolean;
  subtractFees?: boolean;
  decoyOutputs?: {
    enabled: boolean;
    count: number;
  };
}

export interface CreateTransactionResponse {
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  utxos: Array<{ txid: string; vout: number }>;
  effectiveAmount?: number;
  inputPaths?: string[];
  decoyOutputs?: Array<{ address: string; amount: number }>;
}

export interface BroadcastTransactionRequest {
  signedPsbtBase64?: string; // Signed PSBT from Ledger or file upload
  rawTxHex?: string; // Raw transaction hex from Trezor (fully signed)
  recipient: string;
  amount: number;
  fee: number;
  label?: string;
  memo?: string;
  utxos: Array<{ txid: string; vout: number }>;
}

export interface BroadcastTransactionResponse {
  txid: string;
  broadcasted: boolean;
}

export interface EstimateTransactionRequest {
  recipient: string;
  amount: number;
  feeRate: number;
  selectedUtxoIds?: string[];
}

export interface EstimateTransactionResponse {
  fee: number;
  totalCost: number;
  inputCount: number;
  outputCount: number;
  changeAmount: number;
  sufficient: boolean;
  error?: string;
}

export interface AddressSummary {
  totalAddresses: number;
  usedCount: number;
  unusedCount: number;
  totalBalance: number;
  usedBalance: number;
  unusedBalance: number;
}

export interface TransactionStats {
  totalCount: number;
  receivedCount: number;
  sentCount: number;
  consolidationCount: number;
  totalReceived: number;
  totalSent: number;
  totalFees: number;
  walletBalance: number;
}

export interface ExportTransactionsOptions {
  format: 'csv' | 'json';
  startDate?: string;
  endDate?: string;
}

export interface FreezeUTXOResponse {
  id: string;
  txid: string;
  vout: number;
  frozen: boolean;
  message: string;
}

// ========================================
// BATCH TRANSACTION TYPES
// ========================================

export interface BatchTransactionOutput {
  address: string;
  amount: number;
  sendMax?: boolean;
}

export interface CreateBatchTransactionRequest {
  outputs: BatchTransactionOutput[];
  feeRate: number;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  label?: string;
  memo?: string;
}

export interface CreateBatchTransactionResponse {
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  utxos: Array<{ txid: string; vout: number }>;
  inputPaths?: string[];
  outputs: Array<{ address: string; amount: number }>;
}

// ========================================
// CROSS-WALLET TRANSACTION TYPES
// ========================================

export interface RecentTransaction extends Transaction {
  walletName?: string;
}

export interface AggregatedPendingTransaction {
  txid: string;
  walletId: string;
  walletName?: string;
  type: string;
  amount: number;
  fee: number;
  size: number;
  feeRate: number;
  createdAt: string;
}

export interface BalanceHistoryPoint {
  name: string;
  value: number;
}

export type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';

// ========================================
// PRIVACY SCORING TYPES
// ========================================

export interface PrivacyFactor {
  factor: string;
  impact: number;
  description: string;
}

export interface PrivacyScore {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  factors: PrivacyFactor[];
  warnings: string[];
}

export interface UtxoPrivacyInfo {
  utxoId: string;
  txid: string;
  vout: number;
  amount: number;
  address: string;
  score: PrivacyScore;
}

export interface WalletPrivacySummary {
  averageScore: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  utxoCount: number;
  addressReuseCount: number;
  roundAmountCount: number;
  clusterCount: number;
  recommendations: string[];
}

export interface WalletPrivacyResponse {
  utxos: UtxoPrivacyInfo[];
  summary: WalletPrivacySummary;
}

export interface SpendPrivacyAnalysis {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  linkedAddresses: number;
  warnings: string[];
}

// ========================================
// UTXO SELECTION TYPES
// ========================================

export interface SelectedUtxo {
  id: string;
  txid: string;
  vout: number;
  address: string;
  amount: number;
  confirmations: number;
  blockHeight?: number;
}

export interface SelectionResult {
  selected: SelectedUtxo[];
  totalAmount: number;
  estimatedFee: number;
  changeAmount: number;
  inputCount: number;
  strategy: SelectionStrategy;
  warnings: string[];
  privacyImpact?: {
    linkedAddresses: number;
    score: number;
  };
}

export interface SelectUtxosRequest {
  amount: number;
  feeRate: number;
  strategy?: SelectionStrategy;
  scriptType?: string;
}

export interface RecommendedStrategyResponse {
  strategy: SelectionStrategy;
  reason: string;
  utxoCount: number;
  feeRate: number;
}
