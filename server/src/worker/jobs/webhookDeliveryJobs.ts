import type { Job } from 'bullmq';
import type {
  NotifyJobResult,
  WebhookDeliveryJobData,
  WebhookRecoveryJobData,
  WorkerJobHandler,
} from './types';
import {
  recoverDueWebhookDeliveries,
  sendWebhookDelivery,
  type RecoverDueWebhookDeliveriesResult,
} from '../../services/webhooks/deliveryService';
import { createLogger } from '../../utils/logger';
import { recordNotificationJobResult } from './notificationJobHelpers';

const log = createLogger('JOB:WEBHOOK_DELIVERY');

/**
 * Send one durable webhook delivery attempt.
 *
 * The webhook delivery service owns endpoint-specific retry scheduling and
 * max-retry wallet visibility. This BullMQ job is the transport trigger.
 */
export const webhookDeliveryJob: WorkerJobHandler<WebhookDeliveryJobData, NotifyJobResult> = {
  name: 'webhook-delivery',
  queue: 'notifications',
  options: {
    attempts: 1,
  },
  handler: async (job: Job<WebhookDeliveryJobData>): Promise<NotifyJobResult> => {
    const { attempt, deliveryId } = job.data;

    log.debug('Sending webhook delivery', {
      deliveryId,
      jobId: job.id,
    });

    const result = await sendWebhookDelivery(deliveryId, attempt);
    if (result.success) {
      recordNotificationJobResult(webhookDeliveryJob.name, 'success');
      return { success: true, channelsNotified: 1 };
    }

    recordNotificationJobResult(webhookDeliveryJob.name, 'channel_error');
    return {
      success: false,
      channelsNotified: 0,
      errors: result.error ? [result.error] : ['Webhook delivery failed'],
    };
  },
};

export const webhookRecoveryJob: WorkerJobHandler<
  WebhookRecoveryJobData,
  RecoverDueWebhookDeliveriesResult
> = {
  name: 'webhook:recover-due-deliveries',
  queue: 'maintenance',
  options: {
    attempts: 1,
  },
  handler: async (job: Job<WebhookRecoveryJobData>) => {
    return recoverDueWebhookDeliveries(job.data.batchSize);
  },
};

export const webhookDeliveryJobs: WorkerJobHandler<unknown, unknown>[] = [
  webhookDeliveryJob as WorkerJobHandler<unknown, unknown>,
  webhookRecoveryJob as WorkerJobHandler<unknown, unknown>,
];
