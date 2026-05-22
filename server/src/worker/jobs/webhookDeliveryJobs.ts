import type { Job } from 'bullmq';
import type {
  NotifyJobResult,
  WebhookDeliveryJobData,
  WorkerJobHandler,
} from './types';
import { sendWebhookDelivery } from '../../services/webhooks/deliveryService';
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
    const { deliveryId } = job.data;

    log.debug('Sending webhook delivery', {
      deliveryId,
      jobId: job.id,
    });

    const result = await sendWebhookDelivery(deliveryId);
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

export const webhookDeliveryJobs: WorkerJobHandler<unknown, unknown>[] = [
  webhookDeliveryJob as WorkerJobHandler<unknown, unknown>,
];
