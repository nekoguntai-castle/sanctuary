/**
 * Notification Dispatcher
 *
 * Thin wrapper around a BullMQ Queue that dispatches notification jobs
 * to the worker's `notifications` queue for retry-capable delivery.
 *
 * Falls back to inline delivery when Redis is unavailable.
 */

import { Queue, type ConnectionOptions } from 'bullmq';
import { getRedisClient, isRedisConnected } from './redis';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('INFRA:NOTIFY_DISPATCH');

const QUEUE_NAME = 'notifications';
const QUEUE_PREFIX = 'sanctuary:worker';

let notificationQueue: Queue | null = null;

/**
 * Get or lazily create the BullMQ notifications queue.
 * Returns null if Redis is unavailable.
 */
function getQueue(): Queue | null {
  if (notificationQueue) return notificationQueue;

  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return null;

  const connection: ConnectionOptions = {
    host: redis.options.host,
    port: redis.options.port,
    password: redis.options.password,
    db: redis.options.db,
  };

  notificationQueue = new Queue(QUEUE_NAME, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 500,
      removeOnFail: 250,
    },
  });

  log.info('Notification dispatch queue created');
  return notificationQueue;
}

export interface TransactionNotificationPayload {
  walletId: string;
  txid: string;
  type: 'received' | 'sent' | 'consolidation';
  amount: string;
  feeSats?: string | null;
}

export interface ConsolidationSuggestionNotificationPayload {
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

/**
 * Queue a transaction notification for retry-capable delivery.
 * Returns true if the job was queued, false if Redis was unavailable.
 */
export async function queueTransactionNotification(
  payload: TransactionNotificationPayload,
): Promise<boolean> {
  const queue = getQueue();
  if (!queue) return false;

  try {
    await queue.add('transaction-notify', payload, {
      jobId: `txnotify:${payload.walletId}:${payload.txid}`,
    });
    log.debug('Transaction notification queued', {
      walletId: payload.walletId,
      txid: payload.txid,
    });
    return true;
  } catch (error) {
    log.warn('Failed to queue transaction notification, caller should fall back to inline', {
      error: getErrorMessage(error),
      txid: payload.txid,
    });
    return false;
  }
}

/**
 * Queue a low-fee consolidation suggestion notification for retry-capable delivery.
 * Returns true if the job was queued, false if Redis was unavailable.
 */
export async function queueConsolidationSuggestionNotification(
  payload: ConsolidationSuggestionNotificationPayload,
): Promise<boolean> {
  const queue = getQueue();
  if (!queue) return false;

  try {
    await queue.add('consolidation-suggestion-notify', payload, {
      jobId: `consolidation-suggestion:${payload.walletId}:${payload.queuedAt}`,
    });
    log.debug('Consolidation suggestion notification queued', {
      walletId: payload.walletId,
      feeRate: payload.feeRate,
    });
    return true;
  } catch (error) {
    log.warn('Failed to queue consolidation suggestion notification, caller should fall back to inline', {
      error: getErrorMessage(error),
      walletId: payload.walletId,
    });
    return false;
  }
}

/**
 * Shut down the notification dispatch queue (for graceful shutdown).
 */
export async function shutdownNotificationDispatcher(): Promise<void> {
  if (notificationQueue) {
    await notificationQueue.close();
    notificationQueue = null;
  }
}
