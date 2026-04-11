/**
 * Sync Service - Public API
 *
 * Barrel file that re-exports the public API so external imports don't break.
 * All external code should import from this module:
 *
 *   import SyncService, { getSyncService } from './services/sync';
 *   import { getSyncService } from './services/syncService';  // still works via old file
 */

export { default, getSyncService } from './syncService';
export { SyncCoordinator, getSyncCoordinator, resetSyncCoordinatorForTests } from './syncCoordinator';
export type { SyncJob, SyncResult, SyncHealthMetrics, SubscriptionOwnership, PollingMode } from './types';
export type {
  SyncPriority,
  WalletSyncResponse,
  QueuedWalletSyncResponse,
  QueueUserWalletsResponse,
  ResetWalletSyncResponse,
  ResyncWalletResponse,
  QueueNetworkSyncResponse,
  ResyncNetworkResponse,
  NetworkSyncStatusResponse,
  LegacyWalletSyncResponse,
  UpdateConfirmationsResponse,
} from './syncCoordinator';
