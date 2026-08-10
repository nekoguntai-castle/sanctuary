/**
 * BIP21 URI Parser
 *
 * Parses Bitcoin payment URIs according to BIP21 specification.
 * Supports:
 * - Basic addresses: bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
 * - With amount: bitcoin:1A1zP1...?amount=0.001
 * - With payjoin: bitcoin:1A1zP1...?pj=https://payjoin.example.com
 *
 * Extracted from SendTransaction.tsx for reusability.
 */

import { btcAmountToSatoshiString, requirePositiveSatoshiAmount } from './sendAmount';

export interface Bip21ParseResult {
  address: string;
  amount?: number;      // Amount in satoshis
  payjoinUrl?: string;  // Payjoin endpoint URL
  label?: string;       // Optional label
  message?: string;     // Optional message
}

const SINGLETON_PARAMETERS = new Set(['amount', 'pj', 'label', 'message']);
const VALID_PERCENT_ESCAPE = /%(?:[0-9a-fA-F]{2})/g;

const hasMalformedPercentEscape = (value: string): boolean =>
  value.replace(VALID_PERCENT_ESCAPE, '').includes('%');

const hasInvalidParameters = (params: URLSearchParams): boolean => {
  const counts = new Map<string, number>();

  for (const key of params.keys()) {
    if (key.startsWith('req-')) return true;
    if (!SINGLETON_PARAMETERS.has(key)) continue;

    const count = (counts.get(key) ?? 0) + 1;
    if (count > 1) return true;
    counts.set(key, count);
  }

  return false;
};

/**
 * Parse a BIP21 URI and extract address, amount, payjoin URL, etc.
 *
 * @param uri - The BIP21 URI string (e.g., "bitcoin:bc1q...")
 * @returns Parsed result object, or null if not a valid BIP21 URI
 */
export function parseBip21Uri(uri: string): Bip21ParseResult | null {
  // Check if it looks like a BIP21 URI
  if (!uri.toLowerCase().startsWith('bitcoin:')) {
    return null;
  }

  const cleanUri = uri.substring(8); // Remove 'bitcoin:'
  const separatorIndex = cleanUri.indexOf('?');
  const addressPart = separatorIndex === -1 ? cleanUri : cleanUri.slice(0, separatorIndex);
  const paramsPart = separatorIndex === -1 ? '' : cleanUri.slice(separatorIndex + 1);

  if (hasMalformedPercentEscape(paramsPart)) return null;

  const result: Bip21ParseResult = {
    address: addressPart,
  };

  if (paramsPart) {
    const params = new URLSearchParams(paramsPart);
    if (hasInvalidParameters(params)) return null;

    if (params.has('amount')) {
      const amountStr = params.get('amount')!.trim();
      const satoshiString = btcAmountToSatoshiString(amountStr);
      if (satoshiString === null) return null;
      result.amount = requirePositiveSatoshiAmount(satoshiString);
    }

    if (params.has('pj')) {
      result.payjoinUrl = params.get('pj')!;
    }

    if (params.has('label')) {
      result.label = params.get('label')!;
    }

    if (params.has('message')) {
      result.message = params.get('message')!;
    }
  }

  return result;
}

/**
 * Check if a string is a BIP21 URI
 */
export function isBip21Uri(value: string): boolean {
  return value.toLowerCase().startsWith('bitcoin:');
}
