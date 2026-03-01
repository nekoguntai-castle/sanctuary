/**
 * Sync Service - Compatibility re-export
 *
 * This file preserves the original import path so existing code continues to work.
 * The actual implementation has been modularized into services/sync/:
 *
 *   sync/syncService.ts        - Main orchestrator (~300 lines)
 *   sync/syncQueue.ts          - Queue management, priority ordering
 *   sync/walletSync.ts         - Per-wallet sync execution with retry logic
 *   sync/subscriptionManager.ts - Electrum address/block subscriptions
 *   sync/types.ts              - Shared types and constants
 *   sync/index.ts              - Barrel re-exports
 */

export { default, getSyncService } from './sync';
export type { SyncJob, SyncResult, SyncHealthMetrics, SubscriptionOwnership } from './sync';
