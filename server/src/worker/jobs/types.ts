/**
 * Worker Job Types
 *
 * Type definitions for background worker jobs.
 */

import type { Job, JobsOptions } from 'bullmq';

/**
 * Worker job handler definition
 */
export interface WorkerJobHandler<T = unknown, R = void> {
  /** Job name (unique identifier) */
  name: string;
  /** Queue this job belongs to */
  queue: 'sync' | 'notifications' | 'confirmations' | 'maintenance';
  /** Job handler function */
  handler: (job: Job<T>) => Promise<R>;
  /** Default job options */
  options?: JobsOptions;
  /** Lock options for distributed locking */
  lockOptions?: {
    /** Function to generate lock key from job data */
    lockKey: (data: T) => string;
    /** Lock TTL in milliseconds */
    lockTtlMs?: number;
  };
}

/**
 * Sync job data types
 */
export interface SyncWalletJobData {
  walletId: string;
  priority?: 'high' | 'normal' | 'low';
  reason?: string;
}

export interface CheckStaleWalletsJobData {
  /** Override stale threshold in ms */
  staleThresholdMs?: number;
  /** Override the number of stale wallets to return */
  maxWallets?: number;
  /** Priority to use when queueing resulting sync jobs */
  priority?: 'high' | 'normal' | 'low';
  /** Delay between queued sync jobs */
  staggerDelayMs?: number;
  /** Free-form reason for observability */
  reason?: string;
}

export interface UpdateConfirmationsJobData {
  /** Current block height (from new block event) */
  height?: number;
  /** Block hash */
  hash?: string;
}

/**
 * Notification job data types
 */
export interface TransactionNotifyJobData {
  walletId: string;
  txid: string;
  type: 'received' | 'sent' | 'consolidation';
  /** Amount in satoshis (as string for BigInt serialization) */
  amount: string;
}

export interface DraftNotifyJobData {
  walletId: string;
  draftId: string;
  creatorUserId: string;
  creatorUsername: string;
}

export interface ConfirmationNotifyJobData {
  walletId: string;
  txid: string;
  confirmations: number;
  previousConfirmations: number;
}

/**
 * Sync job results
 */
export interface SyncWalletJobResult {
  success: boolean;
  duration: number;
  transactionsFound?: number;
  utxosUpdated?: number;
  error?: string;
}

export interface CheckStaleWalletsResult {
  staleWalletIds: string[];
  queued: number;
  priority: 'high' | 'normal' | 'low';
  staggerDelayMs: number;
  reason: string;
  maxWallets: number;
}

export interface UpdateConfirmationsResult {
  updated: number;
  notified: number;
}

/**
 * Notification job results
 */
export interface NotifyJobResult {
  success: boolean;
  channelsNotified: number;
  errors?: string[];
}
