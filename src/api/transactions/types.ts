/**
 * Transactions API Types
 *
 * Type definitions for transaction, UTXO, and privacy API calls
 */

import type { MobileTransactionBroadcastRequest } from '@sanctuary/shared/schemas/mobileApiRequests';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import type {
  PrivacyGrade,
  TransactionFilterType,
} from '@sanctuary/shared/constants/transactions';
import type { Transaction, UTXO, SelectionStrategy } from "../../types";

// Re-export types for backward compatibility
export type {
  Label,
  Transaction,
  UTXO,
  Address,
  PendingTransaction,
  SelectionStrategy,
} from "../../types";

// ========================================
// TRANSACTION QUERY TYPES
// ========================================

export interface GetTransactionsParams {
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
  type?: TransactionFilterType;
  [key: string]: string | number | boolean | string[] | undefined | null;
}

export interface GetAddressesParams {
  used?: boolean;
  /** Filter by address type: false = receive only, true = change only, omit = all */
  change?: boolean;
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
  signingContext: PsbtSigningContext;
  intentId: string;
  intentDigest: string;
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

type BroadcastTransactionMetadata = Omit<
  MobileTransactionBroadcastRequest,
  'signedPsbtBase64' | 'rawTxHex' | 'draftId' | 'intentId' | 'intentDigest'
>;

type SigningIntentRequest = { intentId: string; intentDigest: string };

// These source shapes intentionally use `?: never` so browser callers cannot
// send raw transaction hex and a signed PSBT in the same broadcast request.
// `draftId` may accompany either explicit payload to bind server draft checks.
type SignedPsbtBroadcastSource = SigningIntentRequest & {
  // Signed PSBT from Ledger, multisig signing, or file/QR import.
  signedPsbtBase64: string;
  rawTxHex?: never;
  draftId?: string;
};

type RawTransactionBroadcastSource = SigningIntentRequest & {
  // Fully signed raw transaction hex from single-sig hardware devices.
  rawTxHex: string;
  signedPsbtBase64?: never;
  draftId?: string;
};

type DraftBroadcastSource = {
  // Server-owned draft lifecycle marker; backend resolves the stored signed PSBT.
  draftId: string;
  signedPsbtBase64?: never;
  rawTxHex?: never;
};

export type BroadcastTransactionRequest = BroadcastTransactionMetadata & (
  | SignedPsbtBroadcastSource
  | RawTransactionBroadcastSource
  | DraftBroadcastSource
);

export interface BroadcastTransactionResponse {
  txid: string;
  broadcasted: boolean;
  persistenceStatus: 'complete' | 'pending_reconciliation';
  persistenceReason?: 'post_acceptance_persistence_race';
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
  format: "csv" | "json";
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
  signingContext: PsbtSigningContext;
  intentId: string;
  intentDigest: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  utxos: Array<{ txid: string; vout: number }>;
  inputPaths?: string[];
  effectiveAmount?: number;
  outputs: Array<{ address: string; amount: number; sendMax?: boolean }>;
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

/**
 * Confirmed activity over a period, across every wallet in scope.
 *
 * Both directions are positive magnitudes and are never netted: a period that
 * received and spent the same amount saw real transactions, not an empty
 * period. Unconfirmed rows are excluded, matching the balance-history filter,
 * so this and the chart beside it always describe the same set.
 */
export interface ActivitySummary {
  count: number;
  receivedSats: number;
  sentSats: number;
  /** ISO timestamp of the most recent confirmed transaction, or null. */
  latestAt: string | null;
}

export type Timeframe = "1D" | "1W" | "1M" | "1Y" | "ALL";

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
  grade: PrivacyGrade;
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
  grade: PrivacyGrade;
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
  grade: PrivacyGrade;
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
