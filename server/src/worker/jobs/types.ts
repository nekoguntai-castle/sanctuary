/**
 * Worker Job Types
 *
 * Type definitions for background worker jobs.
 */

import type { Job, JobsOptions } from 'bullmq';
import type { SyncPriority } from '@sanctuary/shared/constants/sync';
import type { JobExecutionContext } from '../../jobs/types';
import type {
  NotificationFailureClass,
  NotificationOutcome,
  SafeChannelOutcome,
} from '../../services/notifications/outcomes';

export type { JobExecutionContext } from '../../jobs/types';

/**
 * Worker job handler definition
 */
export interface WorkerJobHandler<T = unknown, R = void> {
  /** Job name (unique identifier) */
  name: string;
  /** Queue this job belongs to */
  queue: 'sync' | 'notifications' | 'confirmations' | 'maintenance';
  /** Job handler function */
  handler: (job: Job<T>, execution?: JobExecutionContext) => Promise<R>;
  /** Default job options */
  options?: JobsOptions;
  /** Lock options for distributed locking */
  lockOptions?: {
    /** Function to generate lock key from job data */
    lockKey: (data: T) => string;
    /** Lock TTL in milliseconds */
    lockTtlMs?: number;
    /** Delay without consuming an attempt when lock contention must retain work. */
    retryDelayMsIfUnavailable?: (data: T) => number | null;
    /** Wall-clock budget for re-delaying under contention (default: the lock TTL). */
    maxLockRetryWindowMs?: number;
    /** Record what abandoning the job means for the resource the lock guards. */
    onLockRetryBudgetExhausted?: (
      data: unknown,
      detail: LockRetryBudgetExhaustedDetail,
    ) => Promise<void>;
  };
}

/** What the processor can tell a handler about a give-up on lock contention. */
export interface LockRetryBudgetExhaustedDetail {
  lockKey: string;
  retryWindowMs: number;
  message: string;
  /**
   * Whether the queue will retry this job. Giving up on the lock still throws,
   * which consumes one BullMQ attempt of several - so a handler that reports
   * the outcome must not claim the retries are spent when they are not.
   */
  isFinalAttempt: boolean;
}

/**
 * Sync job data types
 */
export interface SyncWalletJobData {
  walletId: string;
  priority?: SyncPriority;
  reason?: string;
  /** Reset sync-derived wallet state once after exclusive lock acquisition. */
  fullResync?: boolean;
  /** Durable monotonic generation for exactly-once reset preparation across retries. */
  fullResyncGeneration?: number;
}

export interface CheckStaleWalletsJobData {
  /** Override stale threshold in ms */
  staleThresholdMs?: number;
  /** Override the number of stale wallets to return */
  maxWallets?: number;
  /** Priority to use when queueing resulting sync jobs */
  priority?: SyncPriority;
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
  /** Fee in satoshis (as string for BigInt serialization) */
  feeSats?: string | null;
}

export interface DraftNotifyJobData {
  walletId: string;
  draftId: string;
  /** Null when the draft was created by an autonomous agent. */
  creatorUserId: string | null;
  /** Resolved username; the worker can also resolve from creatorUserId. */
  creatorUsername?: string;
  /** Display label used when creatorUserId is null (e.g. agent name). */
  creatorLabel?: string;
  /** Agent metadata — only present for agent-created drafts. */
  agentId?: string | null;
  agentName?: string | null;
  agentOperationalWalletId?: string | null;
  agentSigned?: boolean;
  /** Stable key to dedupe re-queues of the same logical notification. */
  dedupeKey?: string;
}

export interface ConfirmationNotifyJobData {
  walletId: string;
  txid: string;
  confirmations: number;
  previousConfirmations: number;
}

export interface ConsolidationSuggestionNotifyJobData {
  walletId: string;
  walletName: string;
  feeRate: number;
  utxoHealth: {
    totalUtxos: number;
    dustCount: number;
    dustValue: string;
    totalValue: string;
    avgUtxoSize?: string;
    smallestUtxo?: string;
    largestUtxo?: string;
    consolidationCandidates?: number;
  };
  estimatedSavings: string;
  reason: string;
  notifyTelegram: boolean;
  notifyPush: boolean;
  queuedAt: string;
}

export interface WebhookDeliveryJobData {
  deliveryId: string;
  attempt?: number;
}

export interface WebhookRecoveryJobData {
  batchSize?: number;
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
  priority: SyncPriority;
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
  version?: 1;
  success: boolean;
  channelsNotified: number;
  errors?: string[];
  outcome?: NotificationOutcome;
  failureClass?: NotificationFailureClass;
  channelOutcomes?: SafeChannelOutcome[];
}
