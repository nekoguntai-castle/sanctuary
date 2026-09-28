import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEndpoint, makeEvent } from './deliveryService.fixtures';

const mockCreateDelivery = vi.fn();
const mockFindDeliveryById = vi.fn();
const mockListEndpoints = vi.fn();
const mockQueueWebhookDeliveryNotification = vi.fn();

vi.mock('../../../../src/repositories', () => ({
  webhookRepository: {
    createDelivery: mockCreateDelivery,
    findDeliveryById: mockFindDeliveryById,
    listEndpoints: mockListEndpoints,
  },
}));

vi.mock('../../../../src/infrastructure', () => ({
  queueWebhookDeliveryNotification: mockQueueWebhookDeliveryNotification,
}));

describe('webhook delivery admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [
      'the URL changes',
      makeEndpoint({ url: 'https://old.example/hook', secretEncrypted: 'ciphertext-A' }),
      'endpoint_identity_changed',
      'Webhook endpoint changed before delivery could be queued',
    ],
    [
      'the signing secret rotates at the same URL',
      makeEndpoint({ url: 'https://same.example/hook', secretEncrypted: 'ciphertext-A' }),
      'endpoint_identity_changed',
      'Webhook endpoint changed before delivery could be queued',
    ],
    [
      'auth:none clears a stored secret',
      makeEndpoint({ authType: 'none', secretEncrypted: 'ciphertext-A' }),
      'endpoint_identity_changed',
      'Webhook endpoint changed before delivery could be queued',
    ],
    [
      'the endpoint is deleted before admission',
      makeEndpoint(),
      'endpoint_unavailable',
      'Webhook endpoint is unavailable for delivery',
    ],
  ])('does not queue or inline-send when %s after the endpoint snapshot', async (_case, endpoint, reason, errorSummary) => {
    const { queueWebhookEventsDeliveries } = await import('../../../../src/services/webhooks/deliveryService');
    mockListEndpoints.mockResolvedValueOnce([endpoint]);
    mockCreateDelivery.mockResolvedValueOnce({
      accepted: false,
      reason,
    });
    mockQueueWebhookDeliveryNotification.mockResolvedValueOnce(false);

    const result = await queueWebhookEventsDeliveries([makeEvent()]);

    expect(result).toEqual({
      queued: 0,
      errors: [errorSummary],
    });
    expect(mockCreateDelivery).toHaveBeenCalledWith(expect.objectContaining({
      expectedUrl: endpoint.url,
      expectedSecretEncrypted: endpoint.secretEncrypted,
      targetUrl: endpoint.url,
    }));
    expect(mockQueueWebhookDeliveryNotification).not.toHaveBeenCalled();
    expect(mockFindDeliveryById).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('ciphertext');
  });
});
