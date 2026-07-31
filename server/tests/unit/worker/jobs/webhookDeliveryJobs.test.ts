import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRecoverDueWebhookDeliveries,
  mockRecordNotificationJobResult,
  mockSendWebhookDelivery,
} = vi.hoisted(() => ({
  mockRecoverDueWebhookDeliveries: vi.fn(),
  mockRecordNotificationJobResult: vi.fn(),
  mockSendWebhookDelivery: vi.fn(),
}));

vi.mock('../../../../src/services/webhooks/deliveryService', () => ({
  recoverDueWebhookDeliveries: mockRecoverDueWebhookDeliveries,
  sendWebhookDelivery: mockSendWebhookDelivery,
}));

vi.mock('../../../../src/worker/jobs/notificationJobHelpers', () => ({
  recordNotificationJobResult: mockRecordNotificationJobResult,
}));

import {
  webhookDeliveryJob,
  webhookDeliveryJobs,
  webhookRecoveryJob,
} from '../../../../src/worker/jobs/webhookDeliveryJobs';

describe('webhook delivery worker job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records success when the delivery service sends the webhook', async () => {
    mockSendWebhookDelivery.mockResolvedValue({ success: true, statusCode: 204 });

    await expect(webhookDeliveryJob.handler(makeJob('delivery-1', 2))).resolves.toEqual({
      success: true,
      channelsNotified: 1,
    });

    expect(mockSendWebhookDelivery).toHaveBeenCalledWith('delivery-1', 2);
    expect(mockRecordNotificationJobResult).toHaveBeenCalledWith('webhook-delivery', 'success');
  });

  it('records channel errors and propagates delivery errors', async () => {
    mockSendWebhookDelivery.mockResolvedValue({ success: false, error: 'network timeout' });

    await expect(webhookDeliveryJob.handler(makeJob('delivery-2', 3))).resolves.toEqual({
      success: false,
      channelsNotified: 0,
      errors: ['network timeout'],
    });

    expect(mockRecordNotificationJobResult).toHaveBeenCalledWith('webhook-delivery', 'channel_error');
  });

  it('returns a generic error when the delivery service gives no message', async () => {
    mockSendWebhookDelivery.mockResolvedValue({ success: false });

    await expect(webhookDeliveryJob.handler(makeJob('delivery-3', 1))).resolves.toEqual({
      success: false,
      channelsNotified: 0,
      errors: ['Webhook delivery failed'],
    });
  });

  it('exports the job list used by the worker registry', () => {
    expect(webhookDeliveryJobs).toContain(webhookDeliveryJob);
    expect(webhookDeliveryJobs).toContain(webhookRecoveryJob);
    expect(webhookDeliveryJob.options).toEqual({ attempts: 1 });
  });

  it('recovers a bounded batch of due webhook deliveries', async () => {
    mockRecoverDueWebhookDeliveries.mockResolvedValue({
      selected: 3,
      queued: 2,
      failed: 1,
    });

    await expect(webhookRecoveryJob.handler({
      id: 'recovery-job',
      data: { batchSize: 25 },
    } as any)).resolves.toEqual({
      selected: 3,
      queued: 2,
      failed: 1,
    });

    expect(mockRecoverDueWebhookDeliveries).toHaveBeenCalledWith(25);
    expect(webhookRecoveryJob.queue).toBe('maintenance');
  });
});

function makeJob(deliveryId: string, attempt: number) {
  return {
    id: `job-${deliveryId}`,
    data: { deliveryId, attempt },
  } as any;
}
