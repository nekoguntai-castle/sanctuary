/**
 * Sync Service - Compatibility re-export
 *
 * This file preserves the original import path so existing code continues to work.
 * The remaining compatibility implementation is modularized into services/sync/:
 *
 *   sync/syncService.ts        - Status, confirmation, and subscription coordination
 *   sync/syncIntentAdmission.ts - Canonical durable wallet-history admission
 *   sync/subscriptionManager.ts - Electrum address/block subscriptions
 *   sync/types.ts              - Shared types and constants
 *   sync/index.ts              - Barrel re-exports
 */

export { default, getSyncService } from './sync';
export type { SyncJob, SyncResult, SyncHealthMetrics, SubscriptionOwnership, PollingMode } from './sync';
