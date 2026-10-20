/**
 * Payjoin API Client
 *
 * Frontend API calls for BIP78 Payjoin functionality
 */

import apiClient from './client';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import {
  PayjoinAttemptResponseSchema,
  PayjoinReleaseOriginalResponseSchema,
  type PayjoinAttemptResponse,
  type PayjoinReleaseOriginalResponse,
} from '@sanctuary/shared/schemas/bitcoinResponses';

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

export type PayjoinAttemptResult = PayjoinAttemptResponse;

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

export interface PayjoinAvailabilityStatus {
  enabled: boolean;
  configured: boolean;
}

/**
 * Check if Payjoin feature is enabled and properly configured
 */
export async function getPayjoinStatus(): Promise<PayjoinAvailabilityStatus> {
  return apiClient.get<PayjoinAvailabilityStatus>('/payjoin/status');
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
  if (options?.amount !== undefined) params.amount = String(options.amount);
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

export interface PayjoinAttemptOptions {
  signal?: AbortSignal;
  /** The receiver budget is 30s server-side; callers pass a longer client budget. */
  timeoutMs?: number;
}

/**
 * Round one of a BIP78 send: hand the server the signed (not finalized)
 * original PSBT for the authenticated intent. The server verifies it, posts a
 * finalized original to the receiver, and returns the validated proposal plus
 * its replacement intent, which still needs the sender's second signature.
 */
export async function attemptPayjoin(
  walletId: string,
  signedPsbt: string,
  intentId: string,
  intentDigest: string,
  payjoinUrl: string,
  network: NetworkType,
  options: PayjoinAttemptOptions = {},
): Promise<PayjoinAttemptResult> {
  const request = {
    walletId,
    signedPsbt,
    intentId,
    intentDigest,
    payjoinUrl,
    network,
  };
  return apiClient.post<PayjoinAttemptResult>('/payjoin/attempt', request, {
    schema: PayjoinAttemptResponseSchema,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
}

/**
 * Make the signed original broadcastable again after an abandoned or failed
 * payjoin round. The server decides: `{ restored }` on success, 409 while the
 * proposal's broadcast outcome is unknown, 400 when the original is gone.
 */
export async function releasePayjoinOriginal(
  walletId: string,
  intentId: string,
  intentDigest: string,
): Promise<PayjoinReleaseOriginalResponse> {
  return apiClient.post<PayjoinReleaseOriginalResponse>(
    '/payjoin/release-original',
    { walletId, intentId, intentDigest },
    { schema: PayjoinReleaseOriginalResponseSchema },
  );
}

/**
 * Check if a wallet is eligible for Payjoin receives
 */
export async function checkPayjoinEligibility(
  walletId: string
): Promise<PayjoinEligibility> {
  return apiClient.get<PayjoinEligibility>(`/payjoin/eligibility/${walletId}`);
}
