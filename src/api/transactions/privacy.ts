/**
 * Transactions API - Privacy Analysis
 *
 * Privacy scoring for UTXOs, wallets, and spend analysis
 */

import apiClient from '../client';
import type {
  WalletPrivacyResponse,
  PrivacyScore,
  SpendPrivacyAnalysis,
} from './types';

/**
 * Get privacy analysis for all UTXOs in a wallet
 */
export async function getWalletPrivacy(walletId: string): Promise<WalletPrivacyResponse> {
  return apiClient.get<WalletPrivacyResponse>(`/wallets/${walletId}/privacy`);
}

/**
 * Get privacy score for a single UTXO
 */
export async function getUtxoPrivacy(utxoId: string): Promise<PrivacyScore> {
  return apiClient.get<PrivacyScore>(`/utxos/${utxoId}/privacy`);
}

/**
 * Analyze privacy impact of spending selected UTXOs together
 */
export async function analyzeSpendPrivacy(
  walletId: string,
  utxoIds: string[]
): Promise<SpendPrivacyAnalysis> {
  return apiClient.post<SpendPrivacyAnalysis>(`/wallets/${walletId}/privacy/spend-analysis`, {
    utxoIds,
  });
}
