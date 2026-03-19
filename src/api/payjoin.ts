/**
 * Payjoin API Client
 *
 * Frontend API calls for BIP78 Payjoin functionality
 */

import apiClient from './client';

export interface PayjoinUriResponse {
  uri: string;
  address: string;
  payjoinUrl: string;
}

export interface ParsedUri {
  address: string;
  amount?: number;
  label?: string;
  message?: string;
  payjoinUrl?: string;
  hasPayjoin: boolean;
}

export interface PayjoinAttemptResult {
  success: boolean;
  proposalPsbt?: string;
  isPayjoin: boolean;
  error?: string;
}

export type PayjoinEligibilityStatus =
  | 'ready'
  | 'no-utxos'
  | 'pending-confirmations'
  | 'all-frozen'
  | 'all-locked'
  | 'unavailable';

export interface PayjoinEligibility {
  eligible: boolean;
  status: PayjoinEligibilityStatus;
  eligibleUtxoCount: number;
  totalUtxoCount: number;
  reason: string | null;
}

export interface PayjoinStatus {
  enabled: boolean;
  configured: boolean;
}

/**
 * Check if Payjoin feature is enabled and properly configured
 */
export async function getPayjoinStatus(): Promise<PayjoinStatus> {
  return apiClient.get<PayjoinStatus>('/payjoin/status');
}

/**
 * Generate a BIP21 URI with Payjoin endpoint for an address
 */
export async function getPayjoinUri(
  addressId: string,
  options?: {
    amount?: number;
    label?: string;
    message?: string;
  }
): Promise<PayjoinUriResponse> {
  const params: Record<string, string> = {};
  if (options?.amount) params.amount = String(options.amount);
  if (options?.label) params.label = options.label;
  if (options?.message) params.message = options.message;

  return apiClient.get<PayjoinUriResponse>(`/payjoin/address/${addressId}/uri`, params);
}

/**
 * Parse a BIP21 URI to extract address and Payjoin URL
 */
export async function parsePayjoinUri(uri: string): Promise<ParsedUri> {
  return apiClient.post<ParsedUri>('/payjoin/parse-uri', { uri });
}

/**
 * Attempt to perform a Payjoin send
 * Returns the Payjoin proposal PSBT if successful
 */
export async function attemptPayjoin(
  psbt: string,
  payjoinUrl: string,
  network: 'mainnet' | 'testnet' | 'regtest'
): Promise<PayjoinAttemptResult> {
  return apiClient.post<PayjoinAttemptResult>('/payjoin/attempt', {
    psbt,
    payjoinUrl,
    network,
  });
}

/**
 * Check if a wallet is eligible for Payjoin receives
 */
export async function checkPayjoinEligibility(
  walletId: string
): Promise<PayjoinEligibility> {
  return apiClient.get<PayjoinEligibility>(`/payjoin/eligibility/${walletId}`);
}
