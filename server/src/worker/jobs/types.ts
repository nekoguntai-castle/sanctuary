/**
 * Worker Job Types
 *
 * Type definitions for background worker jobs.
 */

import type {
  NotificationFailureClass,
  NotificationOutcome,
  SafeChannelOutcome,
} from '../../services/notifications/outcomes';

export type {
  JobExecutionContext,
  JobLockOptions,
  LockRetryBudgetExhaustedDetail,
  WorkerJobHandler,
} from '../../jobs/types';

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
