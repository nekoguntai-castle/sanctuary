/**
 * Notification Job Definitions
 *
 * Background jobs for notification delivery with retries.
 * These jobs handle:
 * - Transaction notifications (Telegram, Push)
 * - Draft notifications
 * - Confirmation milestone notifications
 */

import type { Job } from 'bullmq';
import type { WorkerJobHandler } from './types';
import type {
  TransactionNotifyJobData,
  DraftNotifyJobData,
  ConfirmationNotifyJobData,
  NotifyJobResult,
} from './types';
import { draftRepository, transactionRepository, walletRepository } from '../../repositories';
import { notificationChannelRegistry } from '../../services/notifications/channels/registry';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

const log = createLogger('JOB:NOTIFY');

// =============================================================================
// Transaction Notification Job
// =============================================================================

/**
 * Send transaction notification via all channels
 *
 * Handles retries with exponential backoff.
 * Failed notifications are recorded in the dead letter queue.
 */
export const transactionNotifyJob: WorkerJobHandler<TransactionNotifyJobData, NotifyJobResult> = {
  name: 'transaction-notify',
  queue: 'notifications',
  options: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 3000 },
  },
  handler: async (job: Job<TransactionNotifyJobData>): Promise<NotifyJobResult> => {
    const { walletId, txid, type, amount, feeSats } = job.data;

    log.debug(`Sending transaction notification: ${txid}`, {
      walletId,
      type,
      jobId: job.id,
    });

    try {
      // Build transaction notification object
      const transactions = [{
        txid,
        type,
        amount: BigInt(amount),
        feeSats: feeSats ? BigInt(feeSats) : null,
      }];

      // Send via all channels
      const results = await notificationChannelRegistry.notifyTransactions(
        walletId,
        transactions
      );

      // Check results
      let channelsNotified = 0;
      const errors: string[] = [];

      for (const result of results) {
        if (result.success) {
          channelsNotified += result.usersNotified;
        } else if (result.errors) {
          errors.push(...result.errors);
        }
      }

      // Log failures
      if (errors.length > 0) {
        log.warn(`Transaction notification had errors: ${txid}`, {
          errors,
          attemptsMade: job.attemptsMade,
        });

        // Log final failure for monitoring
        if (job.attemptsMade >= (job.opts.attempts ?? 5) - 1) {
          log.error('Transaction notification permanently failed', {
            walletId,
            txid,
            errors,
            totalAttempts: job.attemptsMade + 1,
          });
        }
      }

      if (channelsNotified > 0) {
        log.info(`Transaction notification sent: ${txid}`, {
          channelsNotified,
          type,
        });
      }

      return {
        success: errors.length === 0,
        channelsNotified,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      const errorMsg = getErrorMessage(error);

      log.error(`Transaction notification failed: ${txid}`, {
        error: errorMsg,
        attemptsMade: job.attemptsMade,
      });

      // Log final failure for monitoring
      if (job.attemptsMade >= (job.opts.attempts ?? 5) - 1) {
        log.error('Transaction notification permanently failed', {
          walletId,
          txid,
          error: errorMsg,
          totalAttempts: job.attemptsMade + 1,
        });
      }

      return {
        success: false,
        channelsNotified: 0,
        errors: [errorMsg],
      };
    }
  },
};

// =============================================================================
// Draft Notification Job
// =============================================================================

/**
 * Send draft transaction notification
 *
 * Notifies all users of a shared wallet when someone creates a draft.
 */
export const draftNotifyJob: WorkerJobHandler<DraftNotifyJobData, NotifyJobResult> = {
  name: 'draft-notify',
  queue: 'notifications',
  options: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  },
  handler: async (job: Job<DraftNotifyJobData>): Promise<NotifyJobResult> => {
    const { walletId, draftId, creatorUserId, creatorUsername } = job.data;

    log.debug(`Sending draft notification: ${draftId}`, {
      walletId,
      creatorUsername,
      jobId: job.id,
    });

    try {
      // Get draft details
      const draft = await draftRepository.findById(draftId);

      if (!draft) {
        log.warn(`Draft not found: ${draftId}`);
        return { success: true, channelsNotified: 0 };
      }

      // Build draft notification object matching DraftNotification type
      const draftNotification = {
        id: draft.id,
        amount: draft.amount,
        recipient: draft.recipient,
        feeRate: draft.feeRate,
        label: draft.label,
        createdByUsername: creatorUsername,
      };

      // Send via all channels
      const results = await notificationChannelRegistry.notifyDraft(
        walletId,
        draftNotification,
        creatorUserId
      );

      // Check results
      let channelsNotified = 0;
      const errors: string[] = [];

      for (const result of results) {
        if (result.success) {
          channelsNotified += result.usersNotified;
        } else if (result.errors) {
          errors.push(...result.errors);
        }
      }

      if (channelsNotified > 0) {
        log.info(`Draft notification sent: ${draftId}`, {
          channelsNotified,
          walletId,
        });
      }

      return {
        success: errors.length === 0,
        channelsNotified,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      const errorMsg = getErrorMessage(error);

      log.error(`Draft notification failed: ${draftId}`, {
        error: errorMsg,
        attemptsMade: job.attemptsMade,
      });

      return {
        success: false,
        channelsNotified: 0,
        errors: [errorMsg],
      };
    }
  },
};

// =============================================================================
// Confirmation Notification Job
// =============================================================================

/**
 * Send confirmation milestone notification
 *
 * Notifies users when a transaction reaches key confirmation milestones (1, 3, 6).
 */
export const confirmationNotifyJob: WorkerJobHandler<ConfirmationNotifyJobData, NotifyJobResult> = {
  name: 'confirmation-notify',
  queue: 'notifications',
  options: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 2000 },
  },
  handler: async (job: Job<ConfirmationNotifyJobData>): Promise<NotifyJobResult> => {
    const { walletId, txid, confirmations, previousConfirmations } = job.data;

    // Only notify on milestone confirmations
    // Skip if we already notified for this milestone
    const MILESTONES = [1, 3, 6];
    const isNewMilestone = MILESTONES.includes(confirmations) &&
      !MILESTONES.includes(previousConfirmations);

    if (!isNewMilestone) {
      return { success: true, channelsNotified: 0 };
    }

    log.debug(`Sending confirmation notification: ${txid}`, {
      confirmations,
      walletId,
      jobId: job.id,
    });

    try {
      // Get transaction details
      const transaction = await transactionRepository.findByTxid(txid, walletId);

      if (!transaction) {
        log.warn(`Transaction not found: ${txid}`);
        return { success: true, channelsNotified: 0 };
      }

      // Get wallet name for notification context
      const walletName = await walletRepository.getName(walletId);

      // Build a confirmation update as a transaction notification
      // The notification service handles the formatting
      const transactions = [{
        txid,
        type: transaction.type as 'received' | 'sent' | 'consolidation',
        amount: transaction.amount,
        confirmations,
        walletName: walletName || undefined,
      }];

      const results = await notificationChannelRegistry.notifyTransactions(
        walletId,
        transactions
      );

      let channelsNotified = 0;
      const errors: string[] = [];

      for (const result of results) {
        if (result.success) {
          channelsNotified += result.usersNotified;
        } else if (result.errors) {
          errors.push(...result.errors);
        }
      }

      if (channelsNotified > 0) {
        log.info(`Confirmation notification sent: ${txid}`, {
          confirmations,
          channelsNotified,
        });
      }

      return {
        success: errors.length === 0,
        channelsNotified,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      const errorMsg = getErrorMessage(error);

      log.error(`Confirmation notification failed: ${txid}`, {
        error: errorMsg,
        confirmations,
        attemptsMade: job.attemptsMade,
      });

      return {
        success: false,
        channelsNotified: 0,
        errors: [errorMsg],
      };
    }
  },
};

// =============================================================================
// Export all notification jobs
// =============================================================================

export const notificationJobs: WorkerJobHandler<unknown, unknown>[] = [
  transactionNotifyJob as WorkerJobHandler<unknown, unknown>,
  draftNotifyJob as WorkerJobHandler<unknown, unknown>,
  confirmationNotifyJob as WorkerJobHandler<unknown, unknown>,
];
