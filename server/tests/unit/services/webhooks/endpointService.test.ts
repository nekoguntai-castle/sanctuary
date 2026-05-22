import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookDelivery, WebhookEndpoint } from '../../../../src/generated/prisma/client';

const {
  mockCreateEndpoint,
  mockDeleteEndpoint,
  mockEncrypt,
  mockFindDeliveryById,
  mockFindEndpointForWallet,
  mockListDeliveries,
  mockListEndpoints,
  mockMarkDeliveryPendingForReplay,
  mockQueueWebhookDeliveryNotification,
  mockSendWebhookDelivery,
  mockUpdateEndpoint,
} = vi.hoisted(() => ({
  mockCreateEndpoint: vi.fn(),
  mockDeleteEndpoint: vi.fn(),
  mockEncrypt: vi.fn((value: string) => `encrypted:${value}`),
  mockFindDeliveryById: vi.fn(),
  mockFindEndpointForWallet: vi.fn(),
  mockListDeliveries: vi.fn(),
  mockListEndpoints: vi.fn(),
  mockMarkDeliveryPendingForReplay: vi.fn(),
  mockQueueWebhookDeliveryNotification: vi.fn(),
  mockSendWebhookDelivery: vi.fn(),
  mockUpdateEndpoint: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  webhookRepository: {
    createEndpoint: mockCreateEndpoint,
    deleteEndpoint: mockDeleteEndpoint,
    findDeliveryById: mockFindDeliveryById,
    findEndpointForWallet: mockFindEndpointForWallet,
    listDeliveries: mockListDeliveries,
    listEndpoints: mockListEndpoints,
    markDeliveryPendingForReplay: mockMarkDeliveryPendingForReplay,
    updateEndpoint: mockUpdateEndpoint,
  },
}));

vi.mock('../../../../src/infrastructure', () => ({
  queueWebhookDeliveryNotification: mockQueueWebhookDeliveryNotification,
}));

vi.mock('../../../../src/services/webhooks/deliveryService', () => ({
  sendWebhookDelivery: mockSendWebhookDelivery,
}));

vi.mock('../../../../src/utils/encryption', () => ({
  encrypt: mockEncrypt,
}));

import {
  createWalletWebhook,
  deleteWalletWebhook,
  getWalletWebhook,
  listWalletWebhookDeliveries,
  listWalletWebhooks,
  replayWalletWebhookDelivery,
  toWebhookDeliveryResponse,
  toWebhookEndpointResponse,
  updateWalletWebhook,
} from '../../../../src/services/webhooks/endpointService';

describe('webhook endpoint service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists, reads, creates, and deletes redacted wallet endpoints', async () => {
    const endpoint = makeEndpoint({
      secretEncrypted: 'encrypted-secret',
      lastDeliveredAt: new Date('2026-05-22T01:00:00.000Z'),
    });
    mockListEndpoints.mockResolvedValue([endpoint]);
    mockFindEndpointForWallet.mockResolvedValue(endpoint);
    mockCreateEndpoint.mockResolvedValue(endpoint);
    mockDeleteEndpoint.mockResolvedValue(true);

    await expect(listWalletWebhooks('wallet-1')).resolves.toEqual([
      expect.objectContaining({
        id: endpoint.id,
        hasSecret: true,
        lastDeliveredAt: '2026-05-22T01:00:00.000Z',
      }),
    ]);
    await expect(getWalletWebhook('wallet-1', endpoint.id)).resolves.toMatchObject({
      id: endpoint.id,
      hasSecret: true,
    });
    await expect(createWalletWebhook('wallet-1', 'user-1', {
      name: 'Endpoint',
      url: 'https://example.com/hook',
      eventTypes: ['wallet.transaction.received'],
      secret: 'raw-secret',
    })).resolves.toMatchObject({ id: endpoint.id, hasSecret: true });
    mockCreateEndpoint.mockResolvedValueOnce(makeEndpoint({ id: 'endpoint-no-secret' }));
    await expect(createWalletWebhook('wallet-1', 'user-1', {
      name: 'No Secret',
      url: 'https://example.com/no-secret',
      eventTypes: ['wallet.transaction.received'],
    })).resolves.toMatchObject({ id: 'endpoint-no-secret', hasSecret: false });
    await expect(deleteWalletWebhook('wallet-1', endpoint.id)).resolves.toBe(true);

    expect(mockCreateEndpoint).toHaveBeenCalledWith(expect.objectContaining({
      walletId: 'wallet-1',
      createdByUserId: 'user-1',
      secretEncrypted: 'encrypted:raw-secret',
    }));
    expect(mockCreateEndpoint).toHaveBeenCalledWith(expect.objectContaining({
      name: 'No Secret',
      secretEncrypted: null,
    }));
  });

  it('returns null for missing endpoints and clears secrets when auth is disabled', async () => {
    mockFindEndpointForWallet.mockResolvedValue(null);
    mockUpdateEndpoint.mockResolvedValue(makeEndpoint({ secretEncrypted: null }));

    await expect(getWalletWebhook('wallet-1', 'missing')).resolves.toBeNull();
    await expect(updateWalletWebhook('wallet-1', 'endpoint-1', { authType: 'none' }))
      .resolves.toMatchObject({ hasSecret: false });

    expect(mockUpdateEndpoint).toHaveBeenCalledWith('wallet-1', 'endpoint-1', {
      authType: 'none',
      secretEncrypted: null,
    });
  });

  it('updates all configurable endpoint fields and rotates secrets when provided', async () => {
    const updated = makeEndpoint({
      enabled: false,
      authType: 'bearer',
      secretEncrypted: 'encrypted-new-secret',
      headerConfig: { headers: { 'x-static': 'value' } },
      profileConfig: { body: { id: { path: 'eventId' } } },
      retryConfig: { initialDelayMs: 1000 },
      failureNotificationEnabled: false,
    });
    mockUpdateEndpoint.mockResolvedValue(updated);

    await expect(updateWalletWebhook('wallet-1', 'endpoint-1', {
      name: 'Updated',
      enabled: false,
      url: 'https://receiver.example/hook',
      eventTypes: ['*'],
      filters: { minAmountSats: '1000' },
      payloadProfile: 'mapped_json_v1',
      authType: 'bearer',
      secret: 'new-secret',
      headerConfig: { headers: { 'x-static': 'value' } },
      profileConfig: { body: { id: { path: 'eventId' } } },
      retryConfig: { initialDelayMs: 1000 },
      maxAttempts: 3,
      failureNotificationEnabled: false,
    })).resolves.toMatchObject({
      authType: 'bearer',
      enabled: false,
      hasSecret: true,
      failureNotificationEnabled: false,
    });

    expect(mockUpdateEndpoint).toHaveBeenCalledWith('wallet-1', 'endpoint-1', expect.objectContaining({
      enabled: false,
      eventTypes: ['*'],
      filters: { minAmountSats: '1000' },
      secretEncrypted: 'encrypted:new-secret',
    }));
  });

  it('returns null when an update does not find the endpoint', async () => {
    mockUpdateEndpoint.mockResolvedValue(null);

    await expect(updateWalletWebhook('wallet-1', 'missing', { name: 'Nope' })).resolves.toBeNull();
  });

  it('lists delivery diagnostics with nullable timestamps preserved', async () => {
    const delivery = makeDelivery({ deliveredAt: new Date('2026-05-22T02:00:00.000Z') });
    mockListDeliveries.mockResolvedValue([delivery]);

    await expect(listWalletWebhookDeliveries('wallet-1', 'endpoint-1', 10)).resolves.toEqual([
      expect.objectContaining({
        id: delivery.id,
        deliveredAt: '2026-05-22T02:00:00.000Z',
        nextAttemptAt: null,
      }),
    ]);

    expect(mockListDeliveries).toHaveBeenCalledWith('wallet-1', 'endpoint-1', 10);
  });

  it('replays inline when the worker queue is unavailable', async () => {
    const delivery = makeDelivery({ attemptCount: 4, status: 'dead' });
    const pendingDelivery = makeDelivery({
      attemptCount: 0,
      lastAttemptAt: null,
      status: 'pending',
    });
    const latestDelivery = makeDelivery({
      attemptCount: 1,
      lastStatusCode: 200,
      status: 'delivered',
    });
    mockFindDeliveryById
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce(latestDelivery);
    mockMarkDeliveryPendingForReplay.mockResolvedValue(pendingDelivery);
    mockQueueWebhookDeliveryNotification.mockResolvedValue(false);
    mockSendWebhookDelivery.mockResolvedValue({ success: true, statusCode: 200 });

    const result = await replayWalletWebhookDelivery('wallet-1', 'endpoint-1', delivery.id);

    expect(result).toMatchObject({
      success: true,
      queued: false,
      message: 'Webhook delivery replay sent inline',
      delivery: { id: delivery.id, status: 'delivered', lastStatusCode: 200 },
    });
    expect(mockSendWebhookDelivery).toHaveBeenCalledWith(delivery.id);
  });

  it('returns the replay reset row when an inline replay cannot reload the delivery', async () => {
    const delivery = makeDelivery({ attemptCount: 2, status: 'failed' });
    const pendingDelivery = makeDelivery({ attemptCount: 0, status: 'pending' });
    mockFindDeliveryById
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce(null);
    mockMarkDeliveryPendingForReplay.mockResolvedValue(pendingDelivery);
    mockQueueWebhookDeliveryNotification.mockResolvedValue(false);
    mockSendWebhookDelivery.mockResolvedValue({ success: false, error: 'network timeout' });

    await expect(replayWalletWebhookDelivery('wallet-1', 'endpoint-1', delivery.id))
      .resolves.toMatchObject({
        queued: false,
        delivery: { status: 'pending', attemptCount: 0 },
      });
  });

  it('does not replay deliveries outside the wallet or endpoint scope', async () => {
    mockFindDeliveryById.mockResolvedValue(makeDelivery({ endpointId: 'other-endpoint' }));

    await expect(replayWalletWebhookDelivery('wallet-1', 'endpoint-1', 'delivery-1'))
      .resolves.toBeNull();
    expect(mockMarkDeliveryPendingForReplay).not.toHaveBeenCalled();
  });

  it('converts endpoint and delivery records with null optional fields', () => {
    expect(toWebhookEndpointResponse(makeEndpoint())).toMatchObject({
      hasSecret: false,
      lastDeliveredAt: null,
    });
    expect(toWebhookDeliveryResponse(makeDelivery())).toMatchObject({
      deliveredAt: null,
      lastAttemptAt: '2026-05-22T01:00:00.000Z',
    });
  });
});

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'endpoint-1',
    walletId: 'wallet-1',
    name: 'Endpoint',
    enabled: true,
    url: 'https://example.com/hook',
    eventTypes: ['wallet.transaction.received'],
    filters: null,
    payloadProfile: 'sanctuary_wallet_event_v1',
    authType: 'none',
    secretEncrypted: null,
    headerConfig: null,
    profileConfig: null,
    retryConfig: null,
    maxAttempts: 5,
    failureNotificationEnabled: true,
    createdByUserId: 'user-1',
    lastDeliveryStatus: null,
    lastDeliveredAt: null,
    lastError: null,
    createdAt: new Date('2026-05-22T00:00:00.000Z'),
    updatedAt: new Date('2026-05-22T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'delivery-1',
    endpointId: 'endpoint-1',
    walletId: 'wallet-1',
    eventId: 'event-1',
    eventType: 'wallet.transaction.received',
    payloadProfile: 'sanctuary_wallet_event_v1',
    targetUrl: 'https://example.com/hook',
    eventPayload: {},
    requestBody: null,
    requestBodyHash: null,
    requestHeadersRedacted: null,
    status: 'failed',
    attemptCount: 2,
    nextAttemptAt: null,
    lastAttemptAt: new Date('2026-05-22T01:00:00.000Z'),
    deliveredAt: null,
    lastStatusCode: null,
    lastError: null,
    responseBodyHash: null,
    createdAt: new Date('2026-05-22T00:00:00.000Z'),
    updatedAt: new Date('2026-05-22T00:00:00.000Z'),
    ...overrides,
  };
}
