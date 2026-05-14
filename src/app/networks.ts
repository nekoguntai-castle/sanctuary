import {
  BITCOIN_NETWORKS,
  normalizeLegacyNetworkType,
  type NetworkType,
} from '@sanctuary/shared/constants/bitcoin';

export type TabNetwork = Exclude<NetworkType, 'regtest'>;
export type LegacyTabNetwork = TabNetwork | 'testnet';

export const TAB_NETWORKS = BITCOIN_NETWORKS.filter(
  (network): network is TabNetwork => network !== 'regtest',
);

export interface NetworkConfig {
  label: string;
  dotColor: string;
}

export type NetworkColorVariant =
  | 'activeTab'
  | 'borderedBadge'
  | 'iconBackground'
  | 'iconText'
  | 'subtleBadge'
  | 'switchActive'
  | 'warningPanel';

export const networkConfigs: Record<TabNetwork, NetworkConfig> = {
  mainnet: {
    label: 'Mainnet',
    dotColor: 'bg-mainnet-500',
  },
  testnet3: {
    label: 'Testnet3',
    dotColor: 'bg-testnet-500',
  },
  testnet4: {
    label: 'Testnet4',
    dotColor: 'bg-teal-500',
  },
  signet: {
    label: 'Signet',
    dotColor: 'bg-signet-500',
  },
};

const networkColorClasses: Record<TabNetwork, Record<NetworkColorVariant, string>> = {
  mainnet: {
    activeTab: 'border-mainnet-500 text-mainnet-600 dark:text-mainnet-400',
    borderedBadge: 'bg-mainnet-100/50 dark:bg-mainnet-900/20 text-mainnet-700 dark:text-mainnet-300 border-mainnet-200 dark:border-mainnet-700',
    iconBackground: 'bg-mainnet-100 dark:bg-mainnet-900/20',
    iconText: 'text-mainnet-500 dark:text-mainnet-200',
    subtleBadge: 'bg-mainnet-500/8 dark:bg-mainnet-400/10 text-mainnet-600 dark:text-mainnet-400',
    switchActive: 'border-mainnet-500 bg-mainnet-500',
    warningPanel: 'bg-mainnet-50 dark:bg-mainnet-900/10 border-mainnet-300 dark:border-mainnet-600 text-mainnet-700 dark:text-mainnet-200',
  },
  testnet3: {
    activeTab: 'border-testnet-500 text-testnet-600 dark:text-testnet-400',
    borderedBadge: 'bg-testnet-100/50 dark:bg-testnet-900/20 text-testnet-700 dark:text-testnet-300 border-testnet-200 dark:border-testnet-700',
    iconBackground: 'bg-testnet-100 dark:bg-testnet-900/20',
    iconText: 'text-testnet-500 dark:text-testnet-200',
    subtleBadge: 'bg-testnet-500/8 dark:bg-testnet-400/10 text-testnet-600 dark:text-testnet-400',
    switchActive: 'border-testnet-500 bg-testnet-500',
    warningPanel: 'bg-testnet-50 dark:bg-testnet-900/10 border-testnet-300 dark:border-testnet-600 text-testnet-700 dark:text-testnet-950',
  },
  testnet4: {
    activeTab: 'border-teal-500 text-teal-600 dark:text-teal-400',
    borderedBadge: 'bg-teal-100/50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700',
    iconBackground: 'bg-teal-100 dark:bg-teal-900/20',
    iconText: 'text-teal-500 dark:text-teal-200',
    subtleBadge: 'bg-teal-500/8 dark:bg-teal-400/10 text-teal-600 dark:text-teal-400',
    switchActive: 'border-teal-500 bg-teal-500',
    warningPanel: 'bg-teal-50 dark:bg-teal-900/10 border-teal-300 dark:border-teal-600 text-teal-700 dark:text-teal-200',
  },
  signet: {
    activeTab: 'border-signet-500 text-signet-600 dark:text-signet-400',
    borderedBadge: 'bg-signet-100/50 dark:bg-signet-900/20 text-signet-700 dark:text-signet-300 border-signet-200 dark:border-signet-700',
    iconBackground: 'bg-signet-100 dark:bg-signet-900/20',
    iconText: 'text-signet-500 dark:text-signet-200',
    subtleBadge: 'bg-signet-500/8 dark:bg-signet-400/10 text-signet-600 dark:text-signet-400',
    switchActive: 'border-signet-500 bg-signet-500',
    warningPanel: 'bg-signet-50 dark:bg-signet-900/10 border-signet-300 dark:border-signet-600 text-signet-700 dark:text-signet-950',
  },
};

export function isTabNetwork(value: unknown): value is TabNetwork {
  return typeof value === 'string' && TAB_NETWORKS.includes(value as TabNetwork);
}

export function toTabNetwork(value: unknown, fallback: TabNetwork = 'mainnet'): TabNetwork {
  const normalized = normalizeLegacyNetworkType(value, fallback);
  return isTabNetwork(normalized) ? normalized : fallback;
}

export function formatNetworkTitle(network: TabNetwork): string {
  return networkConfigs[network].label;
}

export function getNetworkColorClass(
  network: TabNetwork,
  variant: NetworkColorVariant,
): string {
  return networkColorClasses[network][variant];
}

export function isMainnetNetwork(network: string | null | undefined): boolean {
  return (network ?? 'mainnet') === 'mainnet';
}

export function suppressFiatForNetwork(network: string | null | undefined): boolean {
  return Boolean(network && network !== 'mainnet');
}

export function coinTypeForNetwork(network: string | null | undefined): number {
  if (!network || network === 'mainnet') return 0;
  return 1;
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
    testnet3: items.filter((item) => toTabNetwork(item.network) === 'testnet3').length,
    testnet4: items.filter((item) => toTabNetwork(item.network) === 'testnet4').length,
    signet: items.filter((item) => toTabNetwork(item.network) === 'signet').length,
  };
}

export function filterByNetwork<T extends { network?: string | null }>(
  items: T[],
  network: TabNetwork
): T[] {
  return items.filter((item) => toTabNetwork(item.network) === network);
}
