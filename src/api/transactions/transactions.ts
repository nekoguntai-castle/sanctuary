/**
 * Transactions API - Transaction CRUD
 *
 * Core transaction operations: list, get, create, broadcast, estimate, export
 */

import apiClient from '../client';
import type {
  Transaction,
  PendingTransaction,
  GetTransactionsParams,
  CreateTransactionRequest,
  CreateTransactionResponse,
  BroadcastTransactionRequest,
  BroadcastTransactionResponse,
  EstimateTransactionRequest,
  EstimateTransactionResponse,
  TransactionStats,
  ExportTransactionsOptions,
  CreateBatchTransactionRequest,
  CreateBatchTransactionResponse,
  RecentTransaction,
  AggregatedPendingTransaction,
  BalanceHistoryPoint,
  Timeframe,
  Address,
  GetAddressesParams,
  AddressSummary,
} from './types';

// ========================================
// WALLET-SCOPED TRANSACTION OPERATIONS
// ========================================

/**
 * Get transactions for a wallet
 */
export async function getTransactions(
  walletId: string,
  params?: GetTransactionsParams
): Promise<Transaction[]> {
  return apiClient.get<Transaction[]>(`/wallets/${walletId}/transactions`, params);
}

/**
 * Get a specific transaction by txid
 */
export async function getTransaction(txid: string): Promise<Transaction> {
  return apiClient.get<Transaction>(`/transactions/${txid}`);
}

/**
 * Get pending (unconfirmed) transactions for a wallet
 * Used for block queue visualization
 */
export async function getPendingTransactions(walletId: string): Promise<PendingTransaction[]> {
  return apiClient.get<PendingTransaction[]>(`/wallets/${walletId}/transactions/pending`);
}

/**
 * Get transaction summary statistics for a wallet
 * Returns counts and totals independent of pagination
 */
export async function getTransactionStats(walletId: string): Promise<TransactionStats> {
  return apiClient.get<TransactionStats>(`/wallets/${walletId}/transactions/stats`);
}

/**
 * Export transactions for a wallet
 * Downloads a CSV or JSON file
 */
export async function exportTransactions(
  walletId: string,
  walletName: string,
  options: ExportTransactionsOptions
): Promise<void> {
  const params: Record<string, string> = { format: options.format };
  if (options.startDate) params.startDate = options.startDate;
  if (options.endDate) params.endDate = options.endDate;

  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = walletName.replace(/[^a-zA-Z0-9]/g, '_');
  const extension = options.format === 'json' ? 'json' : 'csv';
  const filename = `${safeName}_transactions_${timestamp}.${extension}`;

  await apiClient.download(`/wallets/${walletId}/transactions/export`, filename, { params });
}

/**
 * Create a transaction PSBT (for hardware wallet signing)
 */
export async function createTransaction(
  walletId: string,
  data: CreateTransactionRequest
): Promise<CreateTransactionResponse> {
  return apiClient.post<CreateTransactionResponse>(
    `/wallets/${walletId}/transactions/create`,
    data
  );
}

/**
 * Broadcast a signed transaction
 */
export async function broadcastTransaction(
  walletId: string,
  data: BroadcastTransactionRequest
): Promise<BroadcastTransactionResponse> {
  return apiClient.post<BroadcastTransactionResponse>(
    `/wallets/${walletId}/transactions/broadcast`,
    data
  );
}

/**
 * Estimate transaction cost
 */
export async function estimateTransaction(
  walletId: string,
  data: EstimateTransactionRequest
): Promise<EstimateTransactionResponse> {
  return apiClient.post<EstimateTransactionResponse>(
    `/wallets/${walletId}/transactions/estimate`,
    data
  );
}

/**
 * Create a batch transaction with multiple outputs
 */
export async function createBatchTransaction(
  walletId: string,
  data: CreateBatchTransactionRequest
): Promise<CreateBatchTransactionResponse> {
  return apiClient.post<CreateBatchTransactionResponse>(
    `/wallets/${walletId}/transactions/batch`,
    data
  );
}

// ========================================
// CROSS-WALLET TRANSACTION OPERATIONS
// ========================================

/**
 * Get recent transactions across all wallets the user has access to
 * This is an optimized aggregate endpoint that replaces N separate API calls
 *
 * @param limit - Max transactions to return (default: 10)
 * @param walletIds - Optional array of wallet IDs to filter by (for network filtering)
 */
export async function getRecentTransactions(limit: number = 10, walletIds?: string[]): Promise<RecentTransaction[]> {
  const params: Record<string, string | number> = { limit };
  if (walletIds && walletIds.length > 0) {
    params.walletIds = walletIds.join(',');
  }
  return apiClient.get<RecentTransaction[]>('/transactions/recent', params);
}

/**
 * Get pending transactions across all wallets the user has access to
 * Used for mempool visualization showing user's transactions in the block queue
 */
export async function getAllPendingTransactions(): Promise<AggregatedPendingTransaction[]> {
  return apiClient.get<AggregatedPendingTransaction[]>('/transactions/pending');
}

/**
 * Get balance history chart data across all wallets
 * This is an optimized aggregate endpoint that replaces N separate API calls
 */
export async function getBalanceHistory(
  timeframe: Timeframe,
  totalBalance: number,
  walletIds?: string[]
): Promise<BalanceHistoryPoint[]> {
  const params: Record<string, string | number> = {
    timeframe,
    totalBalance,
  };
  if (walletIds && walletIds.length > 0) {
    params.walletIds = walletIds.join(',');
  }
  return apiClient.get<BalanceHistoryPoint[]>('/transactions/balance-history', params);
}

// ========================================
// ADDRESS OPERATIONS
// ========================================

/**
 * Get addresses for a wallet
 */
export async function getAddresses(walletId: string, params?: GetAddressesParams): Promise<Address[]> {
  return apiClient.get<Address[]>(`/wallets/${walletId}/addresses`, params);
}

/**
 * Get address summary for a wallet
 */
export async function getAddressSummary(walletId: string): Promise<AddressSummary> {
  return apiClient.get<AddressSummary>(`/wallets/${walletId}/addresses/summary`);
}

/**
 * Generate more addresses for a wallet
 */
export async function generateAddresses(walletId: string, count: number = 10): Promise<{ generated: number }> {
  return apiClient.post<{ generated: number }>(`/wallets/${walletId}/addresses/generate`, { count });
}
