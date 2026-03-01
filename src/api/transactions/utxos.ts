/**
 * Transactions API - UTXO Operations
 *
 * UTXO listing, freezing, selection, and strategy comparison
 */

import apiClient from '../client';
import type {
  GetUTXOsResponse,
  GetUTXOsParams,
  FreezeUTXOResponse,
  SelectUtxosRequest,
  SelectionResult,
  RecommendedStrategyResponse,
  SelectionStrategy,
} from './types';

// ========================================
// UTXO LISTING & MANAGEMENT
// ========================================

/**
 * Get UTXOs for a wallet
 */
export async function getUTXOs(
  walletId: string,
  params?: GetUTXOsParams
): Promise<GetUTXOsResponse> {
  return apiClient.get<GetUTXOsResponse>(`/wallets/${walletId}/utxos`, params);
}

/**
 * Toggle UTXO frozen status
 */
export async function freezeUTXO(utxoId: string, frozen: boolean): Promise<FreezeUTXOResponse> {
  return apiClient.patch<FreezeUTXOResponse>(`/utxos/${utxoId}/freeze`, { frozen });
}

// ========================================
// UTXO SELECTION
// ========================================

/**
 * Select UTXOs for a transaction using specified strategy
 */
export async function selectUtxos(
  walletId: string,
  request: SelectUtxosRequest
): Promise<SelectionResult> {
  return apiClient.post<SelectionResult>(`/wallets/${walletId}/utxos/select`, request);
}

/**
 * Compare different UTXO selection strategies for a given amount
 */
export async function compareStrategies(
  walletId: string,
  amount: number,
  feeRate: number,
  scriptType?: string
): Promise<Record<SelectionStrategy, SelectionResult>> {
  return apiClient.post<Record<SelectionStrategy, SelectionResult>>(
    `/wallets/${walletId}/utxos/compare-strategies`,
    { amount, feeRate, scriptType }
  );
}

/**
 * Get recommended UTXO selection strategy based on context
 */
export async function getRecommendedStrategy(
  walletId: string,
  feeRate: number,
  prioritizePrivacy?: boolean
): Promise<RecommendedStrategyResponse> {
  const params: Record<string, string> = { feeRate: String(feeRate) };
  if (prioritizePrivacy) {
    params.prioritizePrivacy = 'true';
  }
  return apiClient.get<RecommendedStrategyResponse>(
    `/wallets/${walletId}/utxos/recommended-strategy`,
    params
  );
}
