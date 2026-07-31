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

let repositoryUpdateResult: WebhookEndpoint | null;
let persistedUpdateInputs: Array<Record<string, unknown>>;

describe('webhook endpoint service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindEndpointForWallet.mockResolvedValue(makeEndpoint());
    repositoryUpdateResult = makeEndpoint();
    persistedUpdateInputs = [];
    mockUpdateEndpoint.mockImplementation(async (
      _walletId: string,
      _endpointId: string,
      buildUpdate: (endpoint: WebhookEndpoint) => Record<string, unknown>,
    ) => {
      const existing = await mockFindEndpointForWallet();
      if (!existing) return null;
      persistedUpdateInputs.push(buildUpdate(existing));
      return repositoryUpdateResult;
    });
  });

  it('lists, reads, creates, and deletes redacted wallet endpoints', async () => {
    const endpoint = makeEndpoint({
      secretEncrypted: 'encrypted-secret',
      headerConfig: {
        algorithm: 'sha256',
        headers: {
          Authorization: 'Bearer owner-secret',
          'X-API-Key': 'api-secret',
          'X-Customer': 'customer-secret',
        },
      },
      lastDeliveredAt: new Date('2026-05-22T01:00:00.000Z'),
    });
    mockListEndpoints.mockResolvedValue([endpoint]);
    mockFindEndpointForWallet.mockResolvedValue(endpoint);
    mockCreateEndpoint.mockResolvedValue(endpoint);
    mockDeleteEndpoint.mockResolvedValue(true);

    await expect(listWalletWebhooks('wallet-1', 'viewer')).resolves.toEqual([
      expect.objectContaining({
        configuredHeaderNames: ['Authorization', 'X-API-Key', 'X-Customer'],
        headerConfig: { algorithm: 'sha256' },
        id: endpoint.id,
        hasSecret: true,
        lastDeliveredAt: '2026-05-22T01:00:00.000Z',
      }),
    ]);
    await expect(getWalletWebhook('wallet-1', endpoint.id, 'approver')).resolves.toMatchObject({
      id: endpoint.id,
      hasSecret: true,
    });
    await expect(createWalletWebhook('wallet-1', 'user-1', {
      name: 'Endpoint',
      url: 'https://example.com/hook',
      eventTypes: ['wallet.transaction.received'],
      secret: 'raw-secret',
    }, 'owner')).resolves.toMatchObject({ id: endpoint.id, hasSecret: true });
    mockCreateEndpoint.mockResolvedValueOnce(makeEndpoint({ id: 'endpoint-no-secret' }));
    await expect(createWalletWebhook('wallet-1', 'user-1', {
      name: 'No Secret',
      url: 'https://example.com/no-secret',
      eventTypes: ['wallet.transaction.received'],
    }, 'owner')).resolves.toMatchObject({ id: 'endpoint-no-secret', hasSecret: false });
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
    mockFindEndpointForWallet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeEndpoint());
    repositoryUpdateResult = makeEndpoint({ secretEncrypted: null });

    await expect(getWalletWebhook('wallet-1', 'missing', 'viewer')).resolves.toBeNull();
    await expect(updateWalletWebhook('wallet-1', 'endpoint-1', { authType: 'none' }, 'owner'))
      .resolves.toMatchObject({ hasSecret: false });

    expect(persistedUpdateInputs).toContainEqual({
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
    repositoryUpdateResult = updated;

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
    }, 'owner')).resolves.toMatchObject({
      authType: 'bearer',
      enabled: false,
      hasSecret: true,
      failureNotificationEnabled: false,
    });

    expect(persistedUpdateInputs).toContainEqual(expect.objectContaining({
      enabled: false,
      eventTypes: ['*'],
      filters: { minAmountSats: '1000' },
      secretEncrypted: 'encrypted:new-secret',
    }));
  });

  it('returns null when an update does not find the endpoint', async () => {
    mockFindEndpointForWallet.mockResolvedValue(null);

    await expect(updateWalletWebhook('wallet-1', 'missing', { name: 'Nope' }, 'owner'))
      .resolves.toBeNull();
  });

  it('returns null when the endpoint disappears during an update', async () => {
    repositoryUpdateResult = null;

    await expect(updateWalletWebhook('wallet-1', 'endpoint-1', { name: 'Nope' }, 'owner'))
      .resolves.toBeNull();
  });

  it('lists delivery diagnostics with nullable timestamps preserved', async () => {
    const delivery = makeDelivery({
      deliveredAt: new Date('2026-05-22T02:00:00.000Z'),
      requestHeadersRedacted: {
        Authorization: 'Bearer legacy-secret',
        'X-API-Key': 'legacy-api-key',
        'X-Arbitrary': 'legacy-arbitrary',
      },
    });
    mockListDeliveries.mockResolvedValue([delivery]);

    await expect(listWalletWebhookDeliveries('wallet-1', 'endpoint-1', 10, 'signer'))
      .resolves.toEqual([
      expect.objectContaining({
        id: delivery.id,
        deliveredAt: '2026-05-22T02:00:00.000Z',
        nextAttemptAt: null,
        requestHeadersRedacted: {
          Authorization: '[REDACTED]',
          'X-API-Key': '[REDACTED]',
          'X-Arbitrary': '[REDACTED]',
        },
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

    const result = await replayWalletWebhookDelivery(
      'wallet-1',
      'endpoint-1',
      delivery.id,
      'signer',
    );

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

    await expect(replayWalletWebhookDelivery('wallet-1', 'endpoint-1', delivery.id, 'owner'))
      .resolves.toMatchObject({
        queued: false,
        delivery: { status: 'pending', attemptCount: 0 },
      });
  });

  it('does not replay deliveries outside the wallet or endpoint scope', async () => {
    mockFindDeliveryById.mockResolvedValue(makeDelivery({ endpointId: 'other-endpoint' }));

    await expect(replayWalletWebhookDelivery('wallet-1', 'endpoint-1', 'delivery-1', 'owner'))
      .resolves.toBeNull();
    expect(mockMarkDeliveryPendingForReplay).not.toHaveBeenCalled();
  });

  it('converts endpoint and delivery records with null optional fields', () => {
    expect(toWebhookEndpointResponse(makeEndpoint(), 'viewer')).toMatchObject({
      configuredHeaderNames: [],
      hasSecret: false,
      lastDeliveredAt: null,
    });
    expect(toWebhookDeliveryResponse(makeDelivery(), 'signer')).toMatchObject({
      deliveredAt: null,
      lastAttemptAt: '2026-05-22T01:00:00.000Z',
    });
  });

  it.each(['owner', 'approver', 'signer', 'viewer'] as const)(
    'returns the same credential-free endpoint projection to %s',
    role => {
      const response = toWebhookEndpointResponse(makeEndpoint({
        headerConfig: {
          algorithm: 'sha512',
          headers: {
            Authorization: 'Bearer secret',
            'X-API-Key': 'api-secret',
            'X-Arbitrary': 'arbitrary-secret',
          },
        },
      }), role);

      expect(response.headerConfig).toEqual({ algorithm: 'sha512' });
      expect(response.configuredHeaderNames).toEqual([
        'Authorization',
        'X-API-Key',
        'X-Arbitrary',
      ]);
      expect(JSON.stringify(response)).not.toContain('secret');
    },
  );

  it('fails closed when endpoint or delivery projection has no valid wallet role', async () => {
    await expect(listWalletWebhooks('wallet-1', null)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(() => toWebhookEndpointResponse(makeEndpoint(), 'admin')).toThrow(/access/i);
    expect(() => toWebhookDeliveryResponse(makeDelivery(), undefined)).toThrow(/access/i);
    expect(mockListEndpoints).not.toHaveBeenCalled();
  });

  it('merges header updates case-insensitively without blanking omitted credentials', async () => {
    mockFindEndpointForWallet.mockResolvedValue(makeEndpoint({
      headerConfig: {
        algorithm: 'sha256',
        headers: {
          Authorization: 'old-bearer',
          'X-API-Key': 'old-key',
          'X-Preserve': 'keep-me',
        },
      },
    }));
    repositoryUpdateResult = makeEndpoint({
      authType: 'none',
      headerConfig: {
        algorithm: 'sha512',
        headers: {
          authorization: 'new-bearer',
          'X-New': 'new-value',
          'X-Preserve': 'keep-me',
        },
      },
    });

    await expect(updateWalletWebhook('wallet-1', 'endpoint-1', {
      authType: 'none',
      headerConfig: {
        algorithm: 'sha512',
        headers: {
          authorization: 'new-bearer',
          'x-api-key': null,
          'X-New': 'new-value',
        },
      },
    }, 'owner')).resolves.toMatchObject({
      configuredHeaderNames: ['authorization', 'X-New', 'X-Preserve'],
      headerConfig: { algorithm: 'sha512' },
    });

    expect(persistedUpdateInputs).toContainEqual(
      expect.objectContaining({
        authType: 'none',
        headerConfig: {
          algorithm: 'sha512',
          headers: {
            authorization: 'new-bearer',
            'X-New': 'new-value',
            'X-Preserve': 'keep-me',
          },
        },
        secretEncrypted: null,
      }),
    );
  });

  it('preserves stored headers when a config patch omits the nested header map', async () => {
    mockFindEndpointForWallet.mockResolvedValue(makeEndpoint({
      headerConfig: {
        algorithm: 'sha256',
        headers: { 'X-Existing': 'hidden-value' },
      },
    }));
    repositoryUpdateResult = makeEndpoint();

    await updateWalletWebhook('wallet-1', 'endpoint-1', {
      headerConfig: { algorithm: 'sha512' },
    }, 'owner');

    expect(persistedUpdateInputs).toContainEqual(
      expect.objectContaining({
        headerConfig: {
          algorithm: 'sha512',
          headers: { 'X-Existing': 'hidden-value' },
        },
      }),
    );
  });

  it('merges config into legacy empty storage and validates boundary-only malformed values', async () => {
    mockFindEndpointForWallet.mockResolvedValue(makeEndpoint({ headerConfig: null }));
    repositoryUpdateResult = makeEndpoint({
      headerConfig: { algorithm: 'sha512' },
    });

    await expect(updateWalletWebhook('wallet-1', 'endpoint-1', {
      headerConfig: { algorithm: 'sha512' },
    }, 'owner')).resolves.toMatchObject({
      headerConfig: { algorithm: 'sha512' },
      configuredHeaderNames: [],
    });
    expect(persistedUpdateInputs).toContainEqual(
      expect.objectContaining({ headerConfig: { algorithm: 'sha512' } }),
    );

    await expect(createWalletWebhook('wallet-1', 'user-1', {
      name: 'Malformed',
      url: 'https://example.com/hook',
      eventTypes: ['wallet.transaction.received'],
      headerConfig: [] as never,
    }, 'owner')).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateWalletWebhook('wallet-1', 'endpoint-1', {
      headerConfig: { headers: [] as never },
    }, 'owner')).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateWalletWebhook('wallet-1', 'endpoint-1', {
      headerConfig: { headers: { ' ': 'value' } },
    }, 'owner')).rejects.toMatchObject({ statusCode: 400 });
  });

  it.each([
    { headers: { Authorization: '[REDACTED]' } },
    { headers: { Authorization: 'one', authorization: 'two' } },
    { headers: { Authorization: 42 } },
  ])('rejects redaction markers and case-colliding header names', async headerConfig => {
    await expect(updateWalletWebhook('wallet-1', 'endpoint-1', {
      headerConfig: headerConfig as never,
    }, 'owner')).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUpdateEndpoint).not.toHaveBeenCalled();
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
    attemptLeaseToken: null,
    attemptLeaseExpiresAt: null,
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
