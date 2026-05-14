import {
  BITCOIN_NETWORKS,
  isNetworkType,
  isTestnetFamilyNetwork,
  normalizeLegacyNetworkType,
  type NetworkType,
} from '@sanctuary/shared/constants/bitcoin';

export const BITCOIN_NETWORK_VALUES = BITCOIN_NETWORKS;
export type BitcoinNetwork = NetworkType;
export type DetectedBitcoinNetwork = BitcoinNetwork | 'testnet';

export const normalizeLegacyBitcoinNetwork = normalizeLegacyNetworkType;

export const isBitcoinNetwork = isNetworkType;

export const isBitcoinTestnetFamily = isTestnetFamilyNetwork;

export function resolveDetectedBitcoinNetwork(
  detected: DetectedBitcoinNetwork | null | undefined,
  requested?: BitcoinNetwork,
): BitcoinNetwork {
  if (requested) return requested;
  if (!detected || detected === 'testnet') return 'testnet3';
  return detected;
}

export function bitcoinJsNetworkName(network: string | null | undefined): 'mainnet' | 'testnet' | 'regtest' {
  const normalized = normalizeLegacyBitcoinNetwork(network, 'mainnet');
  if (normalized === 'regtest') return 'regtest';
  return isBitcoinTestnetFamily(normalized) ? 'testnet' : 'mainnet';
}

export function coinTypeForBitcoinNetwork(network: string | null | undefined): 0 | 1 {
  return bitcoinJsNetworkName(network) === 'mainnet' ? 0 : 1;
}

export function formatBitcoinNetworkLabel(network: string): string {
  if (network === 'testnet3') return 'Testnet3';
  if (network === 'testnet4') return 'Testnet4';
  if (network === 'signet') return 'Signet';
  if (network === 'regtest') return 'Regtest';
  return 'Mainnet';
}
