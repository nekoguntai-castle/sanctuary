/**
 * Transactions API
 *
 * Re-exports for transaction, UTXO, and privacy API functionality.
 * Barrel file preserving the public API surface from the original transactions.ts module.
 */

// Types (including re-exported types from src/types for backward compatibility)
export type {
  Label,
  Transaction,
  UTXO,
  Address,
  PendingTransaction,
  SelectionStrategy,
  GetTransactionsParams,
  GetAddressesParams,
  GetUTXOsResponse,
  GetUTXOsParams,
  CreateTransactionRequest,
  CreateTransactionResponse,
  BroadcastTransactionRequest,
  BroadcastTransactionResponse,
  EstimateTransactionRequest,
  EstimateTransactionResponse,
  AddressSummary,
  TransactionStats,
  ExportTransactionsOptions,
  FreezeUTXOResponse,
  BatchTransactionOutput,
  CreateBatchTransactionRequest,
  CreateBatchTransactionResponse,
  RecentTransaction,
  AggregatedPendingTransaction,
  BalanceHistoryPoint,
  Timeframe,
  PrivacyFactor,
  PrivacyScore,
  UtxoPrivacyInfo,
  WalletPrivacySummary,
  WalletPrivacyResponse,
  SpendPrivacyAnalysis,
  SelectedUtxo,
  SelectionResult,
  SelectUtxosRequest,
  RecommendedStrategyResponse,
} from './types';

// Transaction operations
export {
  getTransactions,
  getTransaction,
  getPendingTransactions,
  getTransactionStats,
  exportTransactions,
  createTransaction,
  broadcastTransaction,
  estimateTransaction,
  createBatchTransaction,
  getRecentTransactions,
  getAllPendingTransactions,
  getBalanceHistory,
  getAddresses,
  getAddressSummary,
  generateAddresses,
} from './transactions';

// UTXO operations
export {
  getUTXOs,
  freezeUTXO,
  selectUtxos,
  compareStrategies,
  getRecommendedStrategy,
} from './utxos';

// Privacy operations
export {
  getWalletPrivacy,
  getUtxoPrivacy,
  analyzeSpendPrivacy,
} from './privacy';
