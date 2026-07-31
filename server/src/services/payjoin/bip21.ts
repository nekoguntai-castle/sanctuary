/**
 * BIP21 URI Parsing and Generation
 *
 * Handles Bitcoin payment URIs with optional Payjoin endpoint (pj= parameter).
 */

import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import { validateAddress } from '../bitcoin/utils';

const SATS_PER_BTC = 100_000_000n;
const RECOGNIZED_PARAMETERS = ['amount', 'label', 'message', 'pj'] as const;
const BTC_AMOUNT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/;

function requireBitcoinScheme(uri: string): string {
  if (!/^bitcoin:/i.test(uri)) {
    throw new Error('BIP21 URI must use the bitcoin: scheme');
  }
  return uri.slice(uri.indexOf(':') + 1);
}

function requireSupportedAddress(address: string): void {
  const valid = BITCOIN_NETWORKS.some(network => validateAddress(address, network).valid);
  if (!valid) throw new Error('Invalid Bitcoin address');
}

function requireSupportedParameters(params: URLSearchParams): void {
  for (const key of params.keys()) {
    if (key.toLowerCase().startsWith('req-')) {
      throw new Error(`Unsupported required BIP21 parameter: ${key}`);
    }
  }
  for (const key of RECOGNIZED_PARAMETERS) {
    if (params.getAll(key).length > 1) throw new Error(`Duplicate BIP21 parameter: ${key}`);
  }
}

function parseBtcAmountToSats(value: string): number {
  const match = BTC_AMOUNT_PATTERN.exec(value);
  if (!match) throw new Error('Invalid BIP21 amount');
  const wholeSats = BigInt(match[1]) * SATS_PER_BTC;
  const fractionalSats = BigInt((match[2] ?? '').padEnd(8, '0'));
  const sats = wholeSats + fractionalSats;
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('BIP21 amount exceeds safe range');
  return Number(sats);
}

function formatSatsAsBtc(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid satoshi amount');
  const sats = BigInt(amount);
  const whole = sats / SATS_PER_BTC;
  const fraction = (sats % SATS_PER_BTC).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
}

/**
 * Parse a BIP21 URI and extract Payjoin URL if present
 */
export function parseBip21Uri(uri: string): {
  address: string;
  amount?: number;
  label?: string;
  message?: string;
  payjoinUrl?: string;
} {
  const payload = requireBitcoinScheme(uri);
  const queryIndex = payload.indexOf('?');
  const address = queryIndex === -1 ? payload : payload.slice(0, queryIndex);
  const paramsPart = queryIndex === -1 ? '' : payload.slice(queryIndex + 1);
  requireSupportedAddress(address);

  const result: ReturnType<typeof parseBip21Uri> = { address };

  if (paramsPart) {
    const params = new URLSearchParams(paramsPart);
    requireSupportedParameters(params);

    const amount = params.get('amount');
    if (amount !== null) {
      result.amount = parseBtcAmountToSats(amount);
    }
    const label = params.get('label');
    if (label !== null) {
      result.label = label;
    }
    const message = params.get('message');
    if (message !== null) {
      result.message = message;
    }
    const pj = params.get('pj');
    if (pj !== null) {
      result.payjoinUrl = pj;
    }
  }

  return result;
}

/**
 * Generate a BIP21 URI with optional Payjoin endpoint
 */
export function generateBip21Uri(
  address: string,
  options?: {
    amount?: number; // in satoshis
    label?: string;
    message?: string;
    payjoinUrl?: string;
  }
): string {
  let uri = `bitcoin:${address}`;
  const params: string[] = [];

  if (options?.amount !== undefined) {
    params.push(`amount=${formatSatsAsBtc(options.amount)}`);
  }
  if (options?.label) {
    params.push(`label=${encodeURIComponent(options.label)}`);
  }
  if (options?.message) {
    params.push(`message=${encodeURIComponent(options.message)}`);
  }
  if (options?.payjoinUrl) {
    params.push(`pj=${encodeURIComponent(options.payjoinUrl)}`);
  }

  if (params.length > 0) {
    uri += '?' + params.join('&');
  }

  return uri;
}
