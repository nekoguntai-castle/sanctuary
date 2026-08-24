import {
  BITCOIN_NETWORKS,
  isNetworkType,
  isTestnetFamilyNetwork,
  normalizeLegacyNetworkType,
  type NetworkType,
} from '@sanctuary/shared/constants/bitcoin';

export const BITCOIN_NETWORK_VALUES = BITCOIN_NETWORKS;
export type BitcoinNetwork = NetworkType;
/** Legacy `testnet` is accepted from node detection only, never for persistence. */
export type DetectedBitcoinNetwork = BitcoinNetwork | 'testnet';

export const normalizeLegacyBitcoinNetwork = normalizeLegacyNetworkType;

export const isBitcoinNetwork = isNetworkType;

export const isBitcoinTestnetFamily = isTestnetFamilyNetwork;

/**
 * Resolve the persisted wallet-network vocabulary without a default.
 *
 * `testnet` is the sole legacy storage alias. Invalid database values must stop
 * startup consumers rather than silently routing wallet work to mainnet.
 */
export function resolvePersistedBitcoinNetwork(value: unknown): BitcoinNetwork {
  if (value === 'testnet') return 'testnet3';
  if (isBitcoinNetwork(value)) return value;
  throw new Error('Invalid persisted Bitcoin network');
}

/**
 * Prefer an explicit requested network over node detection. A missing or legacy
 * generic testnet detection resolves to testnet3 for backward compatibility.
 */
export function resolveDetectedBitcoinNetwork(
  detected: DetectedBitcoinNetwork | null | undefined,
  requested?: BitcoinNetwork,
): BitcoinNetwork {
  if (requested) return requested;
  if (!detected || detected === 'testnet') return 'testnet3';
  return detected;
}

/**
 * Map compatibility-boundary input to the bitcoinjs network families.
 *
 * This permissive helper retains the historical mainnet default used by callers
 * that accept omitted configuration. Persisted values must first pass through
 * `resolvePersistedBitcoinNetwork`, which intentionally rejects invalid input.
 */
export function bitcoinJsNetworkName(network: string | null | undefined): 'mainnet' | 'testnet' | 'regtest' {
  const normalized = normalizeLegacyBitcoinNetwork(network, 'mainnet');
  if (normalized === 'regtest') return 'regtest';
  return isBitcoinTestnetFamily(normalized) ? 'testnet' : 'mainnet';
}

/**
 * BIP44 coin_type: mainnet uses 0; every Bitcoin test-chain family uses 1.
 * Null or unrecognised compatibility input inherits `bitcoinJsNetworkName`'s
 * mainnet default and therefore returns 0; persisted input must be resolved
 * strictly before calling this helper.
 */
export function coinTypeForBitcoinNetwork(network: string | null | undefined): 0 | 1 {
  return bitcoinJsNetworkName(network) === 'mainnet' ? 0 : 1;
}

/**
 * Format a network for presentation. Callers should pass a validated canonical
 * value; the historical compatibility fallback labels any other string Mainnet.
 */
export function formatBitcoinNetworkLabel(network: string): string {
  if (network === 'testnet3') return 'Testnet3';
  if (network === 'testnet4') return 'Testnet4';
  if (network === 'signet') return 'Signet';
  if (network === 'regtest') return 'Regtest';
  return 'Mainnet';
}
