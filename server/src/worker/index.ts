/**
 * Worker Module Index
 *
 * Background worker for persistent Electrum subscriptions,
 * wallet sync job processing, and notification delivery.
 *
 * @module worker
 */

export { ElectrumSubscriptionManager, type BitcoinNetwork } from './electrumManager';
export { WorkerJobQueue, type WorkerJobQueueConfig } from './workerJobQueue';
export { startHealthServer, type HealthCheckProvider, type HealthServerHandle } from './healthServer';
export { createSyncJobs, notificationJobs, registerWorkerJobs } from './jobs';
export type {
  WorkerJobHandler,
  TransactionNotifyJobData,
  DraftNotifyJobData,
  ConfirmationNotifyJobData,
  NotifyJobResult,
} from './jobs/types';
export type {
  SyncWalletJobData,
  SyncWalletJobResult,
  CheckStaleWalletsJobData,
  CheckStaleWalletsResult,
} from '../jobs/syncJobContract';
