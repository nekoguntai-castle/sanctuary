import type { NetworkType, NetworkColors, PresetServer } from './types';

// Preset servers for each network
export const PRESET_SERVERS: Record<NetworkType, PresetServer[]> = {
  mainnet: [
    { name: 'Blockstream (SSL)', host: 'electrum.blockstream.info', port: 50002, useSsl: true },
    { name: 'Blockstream (TCP)', host: 'electrum.blockstream.info', port: 50001, useSsl: false },
    { name: 'BlueWallet (TCP)', host: 'electrum1.bluewallet.io', port: 50001, useSsl: false },
  ],
  testnet: [
    { name: 'Blockstream Testnet', host: 'electrum.blockstream.info', port: 60002, useSsl: true },
    { name: 'Aranguren Testnet', host: 'testnet.aranguren.org', port: 51002, useSsl: true },
  ],
  signet: [
    { name: 'Mutinynet Signet', host: 'electrum.mutinynet.com', port: 50002, useSsl: true },
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
  testnet: {
    bg: 'bg-testnet-50 dark:bg-testnet-900/20',
    border: 'border-testnet-200 dark:border-testnet-800',
    text: 'text-testnet-700 dark:text-testnet-500',
    accent: 'bg-testnet-100 dark:bg-testnet-900/30 text-testnet-600 dark:text-testnet-500',
    badge: 'bg-testnet-500',
  },
  signet: {
    bg: 'bg-signet-50 dark:bg-signet-900/20',
    border: 'border-signet-200 dark:border-signet-800',
    text: 'text-signet-700 dark:text-signet-500',
    accent: 'bg-signet-100 dark:bg-signet-900/30 text-signet-600 dark:text-signet-500',
    badge: 'bg-signet-500',
  },
};
