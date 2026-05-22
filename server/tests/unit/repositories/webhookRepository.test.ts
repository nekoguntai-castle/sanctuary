import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';

const { mockTx } = vi.hoisted(() => ({
  mockTx: {
    webhookDelivery: {
      update: vi.fn(),
    },
    webhookEndpoint: {
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: vi.fn((callback: (tx: typeof mockTx) => unknown) => callback(mockTx)),
    webhookDelivery: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    webhookEndpoint: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { webhookRepository } from '../../../src/repositories/webhookRepository';

describe('webhookRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists and finds webhook endpoints with scoped queries', async () => {
    const endpoint = makeEndpoint();
    (prisma.webhookEndpoint.findMany as Mock).mockResolvedValueOnce([endpoint]);
    (prisma.webhookEndpoint.findFirst as Mock).mockResolvedValueOnce(endpoint);
    (prisma.webhookEndpoint.findUnique as Mock).mockResolvedValueOnce(endpoint);

    await expect(webhookRepository.listEndpoints('wallet-1')).resolves.toEqual([endpoint]);
    await expect(webhookRepository.findEndpointForWallet('wallet-1', 'endpoint-1')).resolves.toBe(endpoint);
    await expect(webhookRepository.findEndpointById('endpoint-1')).resolves.toBe(endpoint);

    expect(prisma.webhookEndpoint.findMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1' },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
    expect(prisma.webhookEndpoint.findFirst).toHaveBeenCalledWith({
      where: { id: 'endpoint-1', walletId: 'wallet-1' },
    });
    expect(prisma.webhookEndpoint.findUnique).toHaveBeenCalledWith({ where: { id: 'endpoint-1' } });
  });

  it('finds enabled endpoints for exact, global, and prefix wildcard events', async () => {
    (prisma.webhookEndpoint.findMany as Mock).mockResolvedValueOnce([makeEndpoint()]);

    await webhookRepository.findEnabledEndpointsForEvent('wallet-1', 'wallet.transaction.received');
    await webhookRepository.findEnabledEndpointsForEvent('wallet-1', 'wallet');

    expect(prisma.webhookEndpoint.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        walletId: 'wallet-1',
        enabled: true,
        OR: [
          { eventTypes: { has: 'wallet.transaction.received' } },
          { eventTypes: { has: '*' } },
          { eventTypes: { has: 'wallet.transaction.*' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(prisma.webhookEndpoint.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ eventTypes: { has: '*' } }]),
      }),
    }));
  });

  it('creates endpoints with defaults and preserves explicit nullable JSON', async () => {
    const endpoint = makeEndpoint();
    (prisma.webhookEndpoint.create as Mock).mockResolvedValue(endpoint);

    await webhookRepository.createEndpoint({
      walletId: 'wallet-1',
      name: 'Endpoint',
      url: 'https://example.com/hook',
      eventTypes: ['*'],
      filters: null,
      headerConfig: null,
      profileConfig: null,
      retryConfig: null,
    });
    await webhookRepository.createEndpoint({
      walletId: 'wallet-1',
      name: 'Endpoint',
      enabled: false,
      url: 'https://example.com/hook',
      eventTypes: ['wallet.transaction.received'],
      filters: { minAmountSats: '1000' },
      payloadProfile: 'mapped_json_v1',
      authType: 'bearer',
      secretEncrypted: 'encrypted-secret',
      headerConfig: { headers: { 'x-static': 'value' } },
      profileConfig: { body: { id: { path: 'eventId' } } },
      retryConfig: { initialDelayMs: 1000 },
      maxAttempts: 3,
      failureNotificationEnabled: false,
      createdByUserId: 'user-1',
    });

    expect(prisma.webhookEndpoint.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        enabled: true,
        filters: Prisma.JsonNull,
        payloadProfile: 'sanctuary_wallet_event_v1',
        authType: 'none',
        secretEncrypted: null,
        maxAttempts: 5,
        failureNotificationEnabled: true,
        createdByUserId: null,
      }),
    });
    expect(prisma.webhookEndpoint.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        enabled: false,
        filters: { minAmountSats: '1000' },
        payloadProfile: 'mapped_json_v1',
        authType: 'bearer',
        secretEncrypted: 'encrypted-secret',
        maxAttempts: 3,
        failureNotificationEnabled: false,
        createdByUserId: 'user-1',
      }),
    });
  });

  it('updates endpoints only after wallet ownership is confirmed', async () => {
    (prisma.webhookEndpoint.findFirst as Mock).mockResolvedValueOnce(null);
    await expect(webhookRepository.updateEndpoint('wallet-1', 'missing', { name: 'Nope' }))
      .resolves.toBeNull();
    expect(prisma.webhookEndpoint.update).not.toHaveBeenCalled();

    (prisma.webhookEndpoint.findFirst as Mock)
      .mockResolvedValueOnce(makeEndpoint())
      .mockResolvedValueOnce(makeEndpoint())
      .mockResolvedValueOnce(makeEndpoint());
    (prisma.webhookEndpoint.update as Mock)
      .mockResolvedValueOnce(makeEndpoint({ name: 'Existing' }))
      .mockResolvedValueOnce(makeEndpoint({ name: 'Updated' }))
      .mockResolvedValueOnce(makeEndpoint({ name: 'Json Updated' }));

    await webhookRepository.updateEndpoint('wallet-1', 'endpoint-1', {});
    await webhookRepository.updateEndpoint('wallet-1', 'endpoint-1', {
      name: 'Updated',
      enabled: false,
      url: 'https://receiver.example/hook',
      eventTypes: ['*'],
      filters: null,
      payloadProfile: 'mapped_json_v1',
      authType: 'configured_hmac_sha256',
      secretEncrypted: null,
      headerConfig: null,
      profileConfig: null,
      retryConfig: null,
      maxAttempts: 2,
      failureNotificationEnabled: false,
    });
    await webhookRepository.updateEndpoint('wallet-1', 'endpoint-1', {
      filters: { minAmountSats: '1000' },
      headerConfig: { headers: { 'x-static': 'value' } },
      profileConfig: { body: { id: { path: 'eventId' } } },
      retryConfig: { maxDelayMs: 1000 },
    });

    expect(prisma.webhookEndpoint.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'endpoint-1' },
      data: {},
    });
    expect(prisma.webhookEndpoint.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'endpoint-1' },
      data: expect.objectContaining({
        name: 'Updated',
        enabled: false,
        filters: Prisma.JsonNull,
        secretEncrypted: null,
        failureNotificationEnabled: false,
      }),
    });
    expect(prisma.webhookEndpoint.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'endpoint-1' },
      data: expect.objectContaining({
        filters: { minAmountSats: '1000' },
        headerConfig: { headers: { 'x-static': 'value' } },
        profileConfig: { body: { id: { path: 'eventId' } } },
        retryConfig: { maxDelayMs: 1000 },
      }),
    });
  });

  it('deletes endpoints and reports whether a row was removed', async () => {
    (prisma.webhookEndpoint.deleteMany as Mock)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(webhookRepository.deleteEndpoint('wallet-1', 'endpoint-1')).resolves.toBe(true);
    await expect(webhookRepository.deleteEndpoint('wallet-1', 'missing')).resolves.toBe(false);
  });

  it('lists deliveries and redacted support package endpoint data', async () => {
    (prisma.webhookDelivery.findMany as Mock).mockResolvedValueOnce([makeDelivery()]);
    (prisma.webhookEndpoint.findMany as Mock).mockResolvedValueOnce([makeEndpoint()]);

    await webhookRepository.listDeliveries('wallet-1', 'endpoint-1', 25);
    await webhookRepository.listSupportPackageEndpoints();

    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', endpointId: 'endpoint-1' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    expect(prisma.webhookEndpoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        secretEncrypted: true,
        deliveries: expect.objectContaining({ take: 25 }),
      }),
    }));
  });

  it('upserts deliveries and applies optional request diagnostics', async () => {
    (prisma.webhookDelivery.upsert as Mock).mockResolvedValue(makeDelivery());

    await webhookRepository.createDelivery({
      endpointId: 'endpoint-1',
      walletId: 'wallet-1',
      eventId: 'event-1',
      eventType: 'wallet.transaction.received',
      payloadProfile: 'sanctuary_wallet_event_v1',
      targetUrl: 'https://example.com/hook',
      eventPayload: { eventId: 'event-1' },
    });
    await webhookRepository.createDelivery({
      endpointId: 'endpoint-1',
      walletId: 'wallet-1',
      eventId: 'event-2',
      eventType: 'wallet.transaction.sent',
      payloadProfile: 'mapped_json_v1',
      targetUrl: 'https://example.com/hook',
      eventPayload: { eventId: 'event-2' },
      requestBody: { id: 'event-2' },
      requestBodyHash: 'a'.repeat(64),
    });

    expect(prisma.webhookDelivery.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      create: expect.objectContaining({
        requestBody: undefined,
        requestBodyHash: null,
      }),
    }));
    expect(prisma.webhookDelivery.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        endpointId_eventId_payloadProfile: {
          endpointId: 'endpoint-1',
          eventId: 'event-2',
          payloadProfile: 'mapped_json_v1',
        },
      },
      create: expect.objectContaining({
        requestBody: { id: 'event-2' },
        requestBodyHash: 'a'.repeat(64),
      }),
    }));
  });

  it('finds deliveries with endpoint config and resets replay state', async () => {
    (prisma.webhookDelivery.findUnique as Mock).mockResolvedValueOnce(makeDelivery());
    (prisma.webhookDelivery.update as Mock).mockResolvedValueOnce(makeDelivery({ status: 'pending' }));

    await webhookRepository.findDeliveryById('delivery-1');
    await webhookRepository.markDeliveryPendingForReplay('delivery-1');

    expect(prisma.webhookDelivery.findUnique).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      include: { endpoint: true },
    });
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({
        status: 'pending',
        attemptCount: 0,
        lastAttemptAt: null,
      }),
    });
  });

  it('marks deliveries delivered, failed, and dead while updating endpoint health', async () => {
    mockTx.webhookDelivery.update
      .mockResolvedValueOnce(makeDelivery({ status: 'delivered' }))
      .mockResolvedValueOnce(makeDelivery({ status: 'delivered' }))
      .mockResolvedValueOnce(makeDelivery({ status: 'failed' }))
      .mockResolvedValueOnce({ ...makeDelivery({ status: 'dead' }), endpoint: makeEndpoint() })
      .mockResolvedValueOnce({ ...makeDelivery({ status: 'dead' }), endpoint: makeEndpoint() });
    mockTx.webhookEndpoint.update.mockResolvedValue(makeEndpoint());

    await webhookRepository.markDeliveryDelivered('delivery-1', {
      attemptCount: 1,
      statusCode: 204,
      requestBody: { id: 'event-1' },
      requestBodyHash: 'a'.repeat(64),
      requestHeadersRedacted: { authorization: '[REDACTED]' },
      responseBodyHash: null,
    });
    await webhookRepository.markDeliveryDelivered('delivery-2', {
      attemptCount: 1,
      statusCode: 200,
      requestBody: { id: 'event-2' },
      requestBodyHash: 'd'.repeat(64),
    });
    await webhookRepository.markDeliveryFailed({
      deliveryId: 'delivery-1',
      attemptCount: 2,
      statusCode: null,
      error: 'network timeout',
      nextAttemptAt: new Date('2026-05-22T03:00:00.000Z'),
    });
    await webhookRepository.markDeliveryDead({
      deliveryId: 'delivery-1',
      attemptCount: 5,
      statusCode: 503,
      error: 'Webhook endpoint returned HTTP 503',
      requestBody: { id: 'event-1' },
      requestBodyHash: 'b'.repeat(64),
      requestHeadersRedacted: null,
      responseBodyHash: 'c'.repeat(64),
    });
    await webhookRepository.markDeliveryDead({
      deliveryId: 'delivery-2',
      attemptCount: 1,
      error: 'policy blocked',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
    expect(mockTx.webhookDelivery.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        status: 'delivered',
        nextAttemptAt: null,
        responseBodyHash: null,
      }),
    }));
    expect(mockTx.webhookDelivery.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        status: 'delivered',
        requestHeadersRedacted: undefined,
      }),
    }));
    expect(mockTx.webhookDelivery.update).toHaveBeenNthCalledWith(3, expect.objectContaining({
      data: expect.objectContaining({
        status: 'failed',
        lastStatusCode: null,
        requestBody: undefined,
      }),
    }));
    expect(mockTx.webhookDelivery.update).toHaveBeenNthCalledWith(4, expect.objectContaining({
      include: { endpoint: true },
      data: expect.objectContaining({
        status: 'dead',
        lastStatusCode: 503,
        requestHeadersRedacted: undefined,
      }),
    }));
    expect(mockTx.webhookDelivery.update).toHaveBeenNthCalledWith(5, expect.objectContaining({
      data: expect.objectContaining({
        status: 'dead',
        lastStatusCode: null,
        requestBody: undefined,
        requestBodyHash: undefined,
        responseBodyHash: null,
      }),
    }));
    expect(mockTx.webhookEndpoint.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastDeliveryStatus: 'dead' }),
    }));
  });
});

function makeEndpoint(overrides: Record<string, unknown> = {}) {
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

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    endpointId: 'endpoint-1',
    walletId: 'wallet-1',
    eventId: 'event-1',
    eventType: 'wallet.transaction.received',
    payloadProfile: 'sanctuary_wallet_event_v1',
    targetUrl: 'https://example.com/hook',
    eventPayload: { eventId: 'event-1' },
    requestBody: null,
    requestBodyHash: null,
    requestHeadersRedacted: null,
    status: 'pending',
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    deliveredAt: null,
    lastStatusCode: null,
    lastError: null,
    responseBodyHash: null,
    createdAt: new Date('2026-05-22T00:00:00.000Z'),
    updatedAt: new Date('2026-05-22T00:00:00.000Z'),
    ...overrides,
  };
}
