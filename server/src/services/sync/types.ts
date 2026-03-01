/**
 * Sync Service Types
 *
 * Shared types and constants for the sync service modules.
 */

import type { DistributedLock } from '../../infrastructure';

export interface SyncJob {
  walletId: string;
  priority: 'high' | 'normal' | 'low';
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

export interface SyncHealthMetrics {
  isRunning: boolean;
  queueLength: number;
  activeSyncs: number;
  subscribedAddresses: number;
  subscriptionsEnabled: boolean;
  subscriptionOwnership: SubscriptionOwnership;
}

export type SubscriptionOwnership = 'self' | 'external' | 'disabled';

/**
 * Shared mutable state accessed by multiple sync sub-modules.
 *
 * This object is owned by the main SyncService and passed by reference
 * to sub-modules so they can coordinate without circular dependencies.
 */
export interface SyncState {
  isRunning: boolean;
  syncQueue: SyncJob[];
  activeSyncs: Set<string>;
  activeLocks: Map<string, DistributedLock>;
  addressToWalletMap: Map<string, string>;
  pendingRetries: Map<string, NodeJS.Timeout>;
  subscriptionLock: DistributedLock | null;
  subscriptionLockRefresh: NodeJS.Timeout | null;
  subscriptionsEnabled: boolean;
  subscriptionOwnership: SubscriptionOwnership;
  subscribedToHeaders: boolean;
}

// Maximum sync queue size to prevent unbounded memory growth
export const MAX_QUEUE_SIZE = 1000;

// Electrum subscription distributed lock settings
export const ELECTRUM_SUBSCRIPTION_LOCK_KEY = 'electrum:subscriptions';
export const ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS = 2 * 60 * 1000;
export const ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS = 60 * 1000;
