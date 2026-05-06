/**
 * Shared Bitcoin Constants
 *
 * These constants are used across frontend, backend, and gateway.
 */

export const SATS_PER_BTC = 100_000_000;

export const BITCOIN_NETWORKS = ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'] as const;

export type NetworkType = typeof BITCOIN_NETWORKS[number];

export type LegacyNetworkType = NetworkType | 'testnet';

export function isNetworkType(value: unknown): value is NetworkType {
  return typeof value === 'string' && BITCOIN_NETWORKS.includes(value as NetworkType);
}

export function normalizeLegacyNetworkType(
  value: unknown,
  fallback: NetworkType = 'mainnet',
): NetworkType {
  if (value === 'testnet') return 'testnet3';
  return isNetworkType(value) ? value : fallback;
}

export function isTestnetFamilyNetwork(network: string | null | undefined): boolean {
  const normalized = normalizeLegacyNetworkType(network, 'mainnet');
  return normalized === 'testnet3' || normalized === 'testnet4' || normalized === 'signet' || normalized === 'regtest';
}

export type AddressType =
  | 'legacy'
  | 'p2sh'
  | 'native_segwit'
  | 'taproot'
  | 'testnet_legacy'
  | 'testnet_p2sh'
  | 'testnet_segwit';

/**
 * Address regex patterns for quick UI validation
 * Note: These provide format validation only. Use bitcoinjs-lib for
 * cryptographic validation on the backend.
 */
export const ADDRESS_PATTERNS = {
  /** Legacy P2PKH addresses (1...) */
  legacy: /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/,

  /** P2SH addresses including nested SegWit (3...) */
  p2sh: /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/,

  /** Native SegWit P2WPKH/P2WSH addresses (bc1q...) */
  nativeSegwit: /^bc1q[a-z0-9]{38,58}$/i,

  /** Taproot P2TR addresses (bc1p...) */
  taproot: /^bc1p[a-z0-9]{58}$/i,

  /** Testnet legacy addresses (m... or n...) */
  testnetLegacy: /^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/,

  /** Testnet P2SH addresses (2...) */
  testnetP2sh: /^2[a-km-zA-HJ-NP-Z1-9]{25,34}$/,

  /** Testnet SegWit addresses (tb1...) */
  testnetSegwit: /^tb1[a-z0-9]{39,59}$/i,
} as const;
