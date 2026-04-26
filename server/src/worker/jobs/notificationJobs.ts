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
  ConsolidationSuggestionNotifyJobData,
  NotifyJobResult,
} from './types';
import { draftRepository, transactionRepository, walletRepository } from '../../repositories';
import { notificationChannelRegistry } from '../../services/notifications/channels';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import {
  NotificationJobDispatchError,
  buildConsolidationSuggestion,
  createNotificationJobFailure,
  getConsolidationCapableChannelIds,
  getEnabledConsolidationChannelIds,
  getSupportedConsolidationChannelIds,
  recordNotificationJobResult,
  recordNotificationSummary,
  shouldFailBullMqNotificationJob,
  summarizeNotificationResults,
} from './notificationJobHelpers';

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
        /* v8 ignore start -- missing fee is normalized to null for legacy queued jobs */
        feeSats: feeSats ? BigInt(feeSats) : null,
        /* v8 ignore stop */
      }];

      // Send via all channels
      const results = await notificationChannelRegistry.notifyTransactions(
        walletId,
        transactions
      );

      const summary = summarizeNotificationResults(
        results,
        'No transaction notification channels registered'
      );
      recordNotificationSummary(
        transactionNotifyJob.name,
        summary,
        'No transaction notification channels registered'
      );

      // Log failures
      if (summary.errors?.length) {
        log.warn(`Transaction notification had errors: ${txid}`, {
          errors: summary.errors,
          attemptsMade: job.attemptsMade,
        });

        // Log final failure for monitoring
        if (job.attemptsMade >= (job.opts.attempts ?? 5) - 1) {
          log.error('Transaction notification permanently failed', {
            walletId,
            txid,
            errors: summary.errors,
            totalAttempts: job.attemptsMade + 1,
          });
        }
      }

      if (shouldFailBullMqNotificationJob(summary)) {
        throw createNotificationJobFailure(summary, 'Transaction notification failed');
      }

      if (summary.channelsNotified > 0) {
        log.info(`Transaction notification sent: ${txid}`, {
          channelsNotified: summary.channelsNotified,
          type,
        });
      }

      return summary;
    } catch (error) {
      if (error instanceof NotificationJobDispatchError) {
        throw error;
      }

      const errorMsg = getErrorMessage(error);

      log.error(`Transaction notification failed: ${txid}`, {
        error: errorMsg,
        attemptsMade: job.attemptsMade,
      });
      recordNotificationJobResult(transactionNotifyJob.name, 'exception');

      // Log final failure for monitoring
      if (job.attemptsMade >= (job.opts.attempts ?? 5) - 1) {
        log.error('Transaction notification permanently failed', {
          walletId,
          txid,
          error: errorMsg,
          totalAttempts: job.attemptsMade + 1,
        });
      }

      throw error instanceof Error ? error : new Error(errorMsg);
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
    const {
      walletId,
      draftId,
      creatorUserId,
      creatorUsername,
      creatorLabel,
      agentId,
      agentName,
      agentOperationalWalletId,
      agentSigned,
    } = job.data;

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
        recordNotificationJobResult(draftNotifyJob.name, 'skipped');
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
        agentId: agentId ?? null,
        agentName: agentName ?? null,
        agentOperationalWalletId: agentOperationalWalletId ?? null,
        agentSigned: agentSigned ?? false,
      };

      // Send via all channels — pass creatorLabel so agent-created drafts
      // surface the agent name when there's no human creator.
      const results = await notificationChannelRegistry.notifyDraft(
        walletId,
        draftNotification,
        creatorUserId,
        creatorLabel,
      );

      const summary = summarizeNotificationResults(
        results,
        'No draft notification channels registered'
      );
      recordNotificationSummary(
        draftNotifyJob.name,
        summary,
        'No draft notification channels registered'
      );

      if (shouldFailBullMqNotificationJob(summary)) {
        throw createNotificationJobFailure(summary, 'Draft notification failed');
      }

      if (summary.channelsNotified > 0) {
        log.info(`Draft notification sent: ${draftId}`, {
          channelsNotified: summary.channelsNotified,
          walletId,
        });
      }

      return summary;
    } catch (error) {
      if (error instanceof NotificationJobDispatchError) {
        throw error;
      }

      const errorMsg = getErrorMessage(error);

      log.error(`Draft notification failed: ${draftId}`, {
        error: errorMsg,
        attemptsMade: job.attemptsMade,
      });
      recordNotificationJobResult(draftNotifyJob.name, 'exception');

      throw error instanceof Error ? error : new Error(errorMsg);
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
      recordNotificationJobResult(confirmationNotifyJob.name, 'skipped');
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
        recordNotificationJobResult(confirmationNotifyJob.name, 'skipped');
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
        /* v8 ignore start -- wallet name is optional in legacy queued jobs */
        walletName: walletName || undefined,
        /* v8 ignore stop */
      }];

      const results = await notificationChannelRegistry.notifyTransactions(
        walletId,
        transactions
      );

      const summary = summarizeNotificationResults(
        results,
        'No transaction notification channels registered'
      );
      recordNotificationSummary(
        confirmationNotifyJob.name,
        summary,
        'No transaction notification channels registered'
      );

      if (shouldFailBullMqNotificationJob(summary)) {
        throw createNotificationJobFailure(summary, 'Confirmation notification failed');
      }

      if (summary.channelsNotified > 0) {
        log.info(`Confirmation notification sent: ${txid}`, {
          confirmations,
          channelsNotified: summary.channelsNotified,
        });
      }

      return summary;
    } catch (error) {
      if (error instanceof NotificationJobDispatchError) {
        throw error;
      }

      const errorMsg = getErrorMessage(error);

      log.error(`Confirmation notification failed: ${txid}`, {
        error: errorMsg,
        confirmations,
        attemptsMade: job.attemptsMade,
      });
      recordNotificationJobResult(confirmationNotifyJob.name, 'exception');

      throw error instanceof Error ? error : new Error(errorMsg);
    }
  },
};

// =============================================================================
// Consolidation Suggestion Notification Job
// =============================================================================

/**
 * Send a low-fee consolidation suggestion through the shared notification worker.
 */
export const consolidationSuggestionNotifyJob: WorkerJobHandler<
  ConsolidationSuggestionNotifyJobData,
  NotifyJobResult
> = {
  name: 'consolidation-suggestion-notify',
  queue: 'notifications',
  options: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  },
  handler: async (job: Job<ConsolidationSuggestionNotifyJobData>): Promise<NotifyJobResult> => {
    const { walletId, feeRate } = job.data;
    const enabledChannelIds = getEnabledConsolidationChannelIds(job.data);

    log.debug('Sending consolidation suggestion notification', {
      walletId,
      feeRate,
      jobId: job.id,
      enabledChannelIds,
    });

    if (enabledChannelIds.length === 0) {
      recordNotificationJobResult(consolidationSuggestionNotifyJob.name, 'skipped');
      return { success: true, channelsNotified: 0 };
    }

    const capableChannelIds = getConsolidationCapableChannelIds();
    if (capableChannelIds.length === 0) {
      const summary: NotifyJobResult = {
        success: false,
        channelsNotified: 0,
        errors: ['No consolidation suggestion notification channels registered'],
      };
      recordNotificationSummary(
        consolidationSuggestionNotifyJob.name,
        summary,
        'No consolidation suggestion notification channels registered'
      );
      throw createNotificationJobFailure(summary, 'Consolidation suggestion notification failed');
    }

    const supportedChannelIds = getSupportedConsolidationChannelIds(
      enabledChannelIds,
      capableChannelIds
    );
    if (supportedChannelIds.length === 0) {
      recordNotificationJobResult(consolidationSuggestionNotifyJob.name, 'skipped');
      log.warn('No enabled channels support consolidation suggestion notifications', {
        walletId,
        enabledChannelIds,
      });
      return { success: true, channelsNotified: 0 };
    }

    try {
      const suggestion = buildConsolidationSuggestion(job.data);
      const results = await notificationChannelRegistry.notifyConsolidationSuggestion(
        walletId,
        suggestion,
        supportedChannelIds
      );

      const summary = summarizeNotificationResults(
        results,
        'No consolidation suggestion notification channels registered'
      );
      recordNotificationSummary(
        consolidationSuggestionNotifyJob.name,
        summary,
        'No consolidation suggestion notification channels registered'
      );

      if (shouldFailBullMqNotificationJob(summary)) {
        throw createNotificationJobFailure(summary, 'Consolidation suggestion notification failed');
      }

      if (summary.channelsNotified > 0) {
        log.info('Consolidation suggestion notification sent', {
          walletId,
          channelsNotified: summary.channelsNotified,
          feeRate,
        });
      }

      return summary;
    } catch (error) {
      if (error instanceof NotificationJobDispatchError) {
        throw error;
      }

      const errorMsg = getErrorMessage(error);

      log.error('Consolidation suggestion notification failed', {
        walletId,
        feeRate,
        error: errorMsg,
        attemptsMade: job.attemptsMade,
      });
      recordNotificationJobResult(consolidationSuggestionNotifyJob.name, 'exception');

      throw error instanceof Error ? error : new Error(errorMsg);
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
  consolidationSuggestionNotifyJob as WorkerJobHandler<unknown, unknown>,
];
