/**
 * Electrum Manager Types
 *
 * Shared types, interfaces, and configuration constants for
 * the Electrum subscription manager modules.
 */

import type { ElectrumClient } from '../../services/bitcoin/electrum';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';

export type BitcoinNetwork = NetworkType;

export interface AddressWalletInfo {
  walletId: string;
  network: BitcoinNetwork;
}

export function getAddressSubscriptionKey(
  network: BitcoinNetwork,
  address: string,
): string {
  return `${network}:${address}`;
}

export function getAddressFromSubscriptionKey(key: string): string {
  const separatorIndex = key.indexOf(':');
  return separatorIndex === -1 ? key : key.slice(separatorIndex + 1);
}

export interface ElectrumManagerCallbacks {
  /** Called when a new block is received */
  onNewBlock: (network: BitcoinNetwork, height: number, hash: string) => void;
  /** Called for an exact live Electrum scripthash status notification. */
  onAddressActivity: (
    network: BitcoinNetwork,
    scriptHash: string,
    status: string | null,
  ) => void;
  /** Called after a network connection is ready, before current addresses are reconciled. */
  onNetworkReady?: (network: BitcoinNetwork) => Promise<void>;
  /** Called with authoritative statuses returned while restoring subscriptions. */
  onSubscriptionStatuses?: (
    network: BitcoinNetwork,
    statuses: Map<string, string | null>,
  ) => Promise<void>;
}

export interface NetworkState {
  network: BitcoinNetwork;
  client: ElectrumClient;
  connected: boolean;
  subscribedToHeaders: boolean;
  subscribedAddresses: Set<string>;
  lastBlockHeight: number;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
}

// Configuration constants
export const RECONNECT_BASE_DELAY_MS = 5000; // 5 seconds
export const RECONNECT_MAX_DELAY_MS = 60000; // 1 minute
export const RECONNECT_MAX_ATTEMPTS = 10; // After this, log error but keep trying
export const HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds
export const SUBSCRIPTION_BATCH_SIZE = 500; // Max addresses per batch subscription
export const ELECTRUM_SUBSCRIPTION_LOCK_KEY = 'electrum:subscriptions';

function readPositiveMsEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }

  return Math.floor(parsed);
}

export const ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS = readPositiveMsEnv(
  'ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS',
  2 * 60 * 1000,
  5_000,
);
export const ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS = readPositiveMsEnv(
  'ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS',
  60 * 1000,
  1_000,
);
export const ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS = readPositiveMsEnv(
  'ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS',
  15_000,
  1_000,
);
