export const BITCOIN_NETWORK_VALUES = ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'] as const;
export type BitcoinNetwork = typeof BITCOIN_NETWORK_VALUES[number];
export type DetectedBitcoinNetwork = BitcoinNetwork | 'testnet';

export function normalizeLegacyBitcoinNetwork(
  value: unknown,
  fallback: BitcoinNetwork = 'mainnet',
): BitcoinNetwork {
  if (value === 'testnet') return 'testnet3';
  return isBitcoinNetwork(value) ? value : fallback;
}

export function isBitcoinNetwork(value: unknown): value is BitcoinNetwork {
  return typeof value === 'string' && BITCOIN_NETWORK_VALUES.includes(value as BitcoinNetwork);
}

export function isBitcoinTestnetFamily(network: string | null | undefined): boolean {
  const normalized = normalizeLegacyBitcoinNetwork(network, 'mainnet');
  return normalized === 'testnet3' || normalized === 'testnet4' || normalized === 'signet' || normalized === 'regtest';
}

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
