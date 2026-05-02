export const TAB_NETWORKS = ['mainnet', 'testnet', 'signet'] as const;

export type TabNetwork = typeof TAB_NETWORKS[number];

export interface NetworkConfig {
  label: string;
  dotColor: string;
}

export const networkConfigs: Record<TabNetwork, NetworkConfig> = {
  mainnet: {
    label: 'Mainnet',
    dotColor: 'bg-mainnet-500',
  },
  testnet: {
    label: 'Testnet',
    dotColor: 'bg-testnet-500',
  },
  signet: {
    label: 'Signet',
    dotColor: 'bg-signet-500',
  },
};

export function isTabNetwork(value: unknown): value is TabNetwork {
  return typeof value === 'string' && TAB_NETWORKS.includes(value as TabNetwork);
}

export function toTabNetwork(value: unknown, fallback: TabNetwork = 'mainnet'): TabNetwork {
  return isTabNetwork(value) ? value : fallback;
}

export function formatNetworkTitle(network: TabNetwork): string {
  return networkConfigs[network].label;
}

export function isMainnetNetwork(network: string | null | undefined): boolean {
  return (network ?? 'mainnet') === 'mainnet';
}

export function suppressFiatForNetwork(network: string | null | undefined): boolean {
  return network === 'testnet' || network === 'signet';
}

export function coinTypeForNetwork(network: string | null | undefined): number {
  return network === 'mainnet' || !network ? 0 : 1;
}

export function networksShareCoinType(
  first: string | null | undefined,
  second: string | null | undefined
): boolean {
  return coinTypeForNetwork(first) === coinTypeForNetwork(second);
}

export function countByNetwork<T extends { network?: string | null }>(
  items: T[]
): Record<TabNetwork, number> {
  return {
    mainnet: items.filter((item) => toTabNetwork(item.network) === 'mainnet').length,
    testnet: items.filter((item) => item.network === 'testnet').length,
    signet: items.filter((item) => item.network === 'signet').length,
  };
}

export function filterByNetwork<T extends { network?: string | null }>(
  items: T[],
  network: TabNetwork
): T[] {
  return items.filter((item) => toTabNetwork(item.network) === network);
}
