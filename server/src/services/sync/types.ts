/**
 * Sync Service Types
 *
 * Shared types and constants for the sync service modules.
 */

import type { SyncPriority } from '@sanctuary/shared/constants/sync';

export interface SyncJob {
  walletId: string;
  priority: SyncPriority;
  requestedAt: Date;
  retryCount?: number;
  lastError?: string;
}

export interface SyncResult {
  success: boolean;
  addresses: number;
  transactions: number;
  utxos: number;
  error?: string;
}

export type PollingMode = 'worker-delegated' | 'in-process';

export interface SyncHealthMetrics {
  isRunning: boolean;
  subscribedAddresses: number;
  subscriptionsEnabled: boolean;
  subscriptionOwnership: SubscriptionOwnership;
  pollingMode: PollingMode;
}

export type SubscriptionOwnership = 'self' | 'external' | 'unavailable' | 'disabled';

/**
 * Shared mutable state accessed by multiple sync sub-modules.
 *
 * This object is owned by the main SyncService and passed by reference
 * to sub-modules so they can coordinate without circular dependencies.
 */
export interface SyncState {
  isRunning: boolean;
  pendingRetries: Map<string, NodeJS.Timeout>;
  subscriptionsEnabled: boolean;
  subscriptionOwnership: SubscriptionOwnership;
  subscribedToHeaders: boolean;
  pollingMode: PollingMode;
}

// Electrum subscription distributed lock settings
export const ELECTRUM_SUBSCRIPTION_LOCK_KEY = 'electrum:subscriptions';
export const ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS = 2 * 60 * 1000;
export const ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS = 60 * 1000;
