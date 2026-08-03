import type { NetworkType, NetworkColors, PresetServer } from './types';
import { getNodeNetworkDefaults } from '@sanctuary/shared/constants/nodeConfig';

const mainnetDefaults = getNodeNetworkDefaults('mainnet');
const testnet3Defaults = getNodeNetworkDefaults('testnet3');
const signetDefaults = getNodeNetworkDefaults('signet');

// Preset servers for each network
export const PRESET_SERVERS: Record<NetworkType, PresetServer[]> = {
  mainnet: [
    { name: 'Blockstream (SSL)', host: mainnetDefaults.singletonHost, port: mainnetDefaults.singletonPort, useSsl: true },
    { name: 'Blockstream (TCP)', host: mainnetDefaults.singletonHost, port: 50001, useSsl: false },
    { name: 'BlueWallet (TCP)', host: 'electrum1.bluewallet.io', port: 50001, useSsl: false },
  ],
  testnet3: [
    { name: 'Blockstream Testnet', host: testnet3Defaults.singletonHost, port: testnet3Defaults.singletonPort, useSsl: true },
    { name: 'Aranguren Testnet', host: 'testnet.aranguren.org', port: 51002, useSsl: true },
  ],
  testnet4: [],
  signet: [
    { name: 'Mutinynet Signet', host: signetDefaults.singletonHost, port: signetDefaults.singletonPort, useSsl: true },
    { name: 'Mempool Signet', host: 'mempool.space', port: 60602, useSsl: true },
  ],
};

// Network color schemes (theme-aware)
// Note: In dark mode, network color scales are inverted (lower numbers = darker)
// Use 500+ shades for text in dark mode to ensure good contrast
export const NETWORK_COLORS: Record<NetworkType, NetworkColors> = {
  mainnet: {
    bg: 'bg-mainnet-50 dark:bg-mainnet-900/20',
    border: 'border-mainnet-200 dark:border-mainnet-800',
    text: 'text-mainnet-700 dark:text-mainnet-500',
    accent: 'bg-mainnet-100 dark:bg-mainnet-900/30 text-mainnet-600 dark:text-mainnet-500',
    badge: 'bg-mainnet-500',
  },
  testnet3: {
    bg: 'bg-testnet-50 dark:bg-testnet-900/20',
    border: 'border-testnet-200 dark:border-testnet-800',
    text: 'text-testnet-700 dark:text-testnet-500',
    accent: 'bg-testnet-100 dark:bg-testnet-900/30 text-testnet-600 dark:text-testnet-500',
    badge: 'bg-testnet-500',
  },
  testnet4: {
    bg: 'bg-teal-50 dark:bg-teal-900/20',
    border: 'border-teal-200 dark:border-teal-800',
    text: 'text-teal-700 dark:text-teal-500',
    accent: 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-500',
    badge: 'bg-teal-500',
  },
  signet: {
    bg: 'bg-signet-50 dark:bg-signet-900/20',
    border: 'border-signet-200 dark:border-signet-800',
    text: 'text-signet-700 dark:text-signet-500',
    accent: 'bg-signet-100 dark:bg-signet-900/30 text-signet-600 dark:text-signet-500',
    badge: 'bg-signet-500',
  },
};
