import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';

const {
  accessCalls,
  deniedAccessLevels,
  mockCreateWalletWebhook,
  mockDeleteWalletWebhook,
  mockGetWalletWebhook,
  mockListWalletWebhookDeliveries,
  mockListWalletWebhooks,
  mockReplayWalletWebhookDelivery,
  mockUpdateWalletWebhook,
  mockValidateWebhookEndpointUrl,
} = vi.hoisted(() => ({
  accessCalls: [] as string[],
  deniedAccessLevels: new Set<string>(),
  mockCreateWalletWebhook: vi.fn(),
  mockDeleteWalletWebhook: vi.fn(),
  mockGetWalletWebhook: vi.fn(),
  mockListWalletWebhookDeliveries: vi.fn(),
  mockListWalletWebhooks: vi.fn(),
  mockReplayWalletWebhookDelivery: vi.fn(),
  mockUpdateWalletWebhook: vi.fn(),
  mockValidateWebhookEndpointUrl: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'user-1', username: 'alice', isAdmin: false },
}));

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: (level: string) => (req: any, res: any, next: () => void) => {
    accessCalls.push(level);
    if (deniedAccessLevels.has(level)) {
      res.status(403).json({ message: 'forbidden' });
      return;
    }
    req.user = { userId: 'user-1', username: 'alice', isAdmin: false };
    req.walletId = req.params.walletId || req.params.id;
    req.walletRole = level === 'owner' ? 'owner' : 'signer';
    next();
  },
}));

vi.mock('../../../src/services/webhooks', () => ({
  createWalletWebhook: mockCreateWalletWebhook,
  deleteWalletWebhook: mockDeleteWalletWebhook,
  getWalletWebhook: mockGetWalletWebhook,
  listWalletWebhookDeliveries: mockListWalletWebhookDeliveries,
  listWalletWebhooks: mockListWalletWebhooks,
  replayWalletWebhookDelivery: mockReplayWalletWebhookDelivery,
  updateWalletWebhook: mockUpdateWalletWebhook,
}));

vi.mock('../../../src/services/webhooks/endpointPolicy', () => ({
  validateWebhookEndpointUrl: mockValidateWebhookEndpointUrl,
}));

import webhooksRouter from '../../../src/api/wallets/webhooks';

describe('wallet webhook routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/wallets', webhooksRouter);
    app.use(errorHandler);

    accessCalls.length = 0;
    deniedAccessLevels.clear();
    vi.clearAllMocks();

    mockListWalletWebhooks.mockResolvedValue([makeWebhook()]);
    mockGetWalletWebhook.mockResolvedValue(makeWebhook());
    mockCreateWalletWebhook.mockResolvedValue(makeWebhook());
    mockUpdateWalletWebhook.mockResolvedValue(makeWebhook());
    mockDeleteWalletWebhook.mockResolvedValue(true);
    mockListWalletWebhookDeliveries.mockResolvedValue([makeDelivery()]);
    mockReplayWalletWebhookDelivery.mockResolvedValue({
      success: true,
      queued: true,
      message: 'Webhook delivery replay queued',
      delivery: makeDelivery({ status: 'pending' }),
    });
    mockValidateWebhookEndpointUrl.mockResolvedValue({
      url: new URL('https://example.com/hook'),
      resolvedAddresses: ['93.184.216.34'],
    });
  });

  it('creates webhook endpoints without returning submitted secrets', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/webhooks')
      .send({
        name: 'Accounting',
        url: 'https://example.com/hook',
        eventTypes: ['wallet.transaction.received'],
        authType: 'hmac_sha256',
        secret: 'raw-secret',
      })
      .expect(201);

    expect(accessCalls).toEqual(['owner']);
    expect(mockCreateWalletWebhook).toHaveBeenCalledWith(
      'wallet-1',
      'user-1',
      expect.objectContaining({ secret: 'raw-secret' }),
    );
    expect(response.body.webhook.hasSecret).toBe(true);
    expect(response.body.webhook).not.toHaveProperty('secret');
    expect(JSON.stringify(response.body)).not.toContain('raw-secret');
  });

  it('lists, reads, and deletes wallet webhook endpoints', async () => {
    const list = await request(app)
      .get('/api/v1/wallets/wallet-1/webhooks')
      .expect(200);
    const read = await request(app)
      .get('/api/v1/wallets/wallet-1/webhooks/webhook-1')
      .expect(200);
    const deleted = await request(app)
      .delete('/api/v1/wallets/wallet-1/webhooks/webhook-1')
      .expect(200);

    expect(accessCalls).toEqual(['view', 'view', 'owner']);
    expect(list.body.webhooks).toHaveLength(1);
    expect(read.body.webhook.id).toBe('webhook-1');
    expect(deleted.body).toEqual({ success: true, message: 'Webhook endpoint deleted' });
    expect(mockDeleteWalletWebhook).toHaveBeenCalledWith('wallet-1', 'webhook-1');
  });

  it('returns not found when read, update, delete, test, diagnostics, or replay targets are missing', async () => {
    mockGetWalletWebhook.mockResolvedValue(null);
    mockUpdateWalletWebhook.mockResolvedValue(null);
    mockDeleteWalletWebhook.mockResolvedValue(false);
    mockReplayWalletWebhookDelivery.mockResolvedValue(null);

    await request(app)
      .get('/api/v1/wallets/wallet-1/webhooks/missing')
      .expect(404);
    await request(app)
      .patch('/api/v1/wallets/wallet-1/webhooks/missing')
      .send({ name: 'Missing' })
      .expect(404);
    await request(app)
      .delete('/api/v1/wallets/wallet-1/webhooks/missing')
      .expect(404);
    await request(app)
      .post('/api/v1/wallets/wallet-1/webhooks/missing/test')
      .expect(404);
    await request(app)
      .get('/api/v1/wallets/wallet-1/webhooks/missing/deliveries')
      .expect(404);
    await request(app)
      .post('/api/v1/wallets/wallet-1/webhooks/missing/deliveries/delivery-1/replay')
      .expect(404);

    mockGetWalletWebhook.mockResolvedValue(makeWebhook());
    await request(app)
      .post('/api/v1/wallets/wallet-1/webhooks/webhook-1/deliveries/missing/replay')
      .expect(404);
  });

  it('rotates secrets through patch without exposing the new secret', async () => {
    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/webhooks/webhook-1')
      .send({ secret: 'new-secret' })
      .expect(200);

    expect(accessCalls).toEqual(['owner']);
    expect(mockUpdateWalletWebhook).toHaveBeenCalledWith(
      'wallet-1',
      'webhook-1',
      { secret: 'new-secret' },
    );
    expect(response.body.webhook.hasSecret).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('new-secret');
  });

  it('validates stored endpoint URLs through the test action', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/webhooks/webhook-1/test')
      .expect(200);

    expect(accessCalls).toEqual(['owner']);
    expect(mockValidateWebhookEndpointUrl).toHaveBeenCalledWith('https://example.com/hook');
    expect(response.body).toEqual({ success: true, message: 'Webhook endpoint URL is allowed' });
  });

  it('requires signer-level access for delivery diagnostics', async () => {
    await request(app)
      .get('/api/v1/wallets/wallet-1/webhooks/webhook-1/deliveries?limit=20')
      .expect(200);

    expect(accessCalls).toEqual(['edit']);
    expect(mockListWalletWebhookDeliveries).toHaveBeenCalledWith('wallet-1', 'webhook-1', 20);
  });

  it('uses the default delivery diagnostics limit when none is provided', async () => {
    await request(app)
      .get('/api/v1/wallets/wallet-1/webhooks/webhook-1/deliveries')
      .expect(200);

    expect(mockListWalletWebhookDeliveries).toHaveBeenCalledWith('wallet-1', 'webhook-1', 50);
  });

  it('blocks delivery diagnostics before handlers when edit access is denied', async () => {
    deniedAccessLevels.add('edit');

    await request(app)
      .get('/api/v1/wallets/wallet-1/webhooks/webhook-1/deliveries')
      .expect(403);

    expect(accessCalls).toEqual(['edit']);
    expect(mockListWalletWebhookDeliveries).not.toHaveBeenCalled();
  });

  it('replays a delivery on the same delivery id', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/webhooks/webhook-1/deliveries/delivery-1/replay')
      .expect(200);

    expect(accessCalls).toEqual(['edit']);
    expect(mockReplayWalletWebhookDelivery).toHaveBeenCalledWith('wallet-1', 'webhook-1', 'delivery-1');
    expect(response.body).toMatchObject({
      success: true,
      queued: true,
      delivery: { id: 'delivery-1', eventId: 'event-1' },
    });
  });

  it('blocks replay when the endpoint is disabled', async () => {
    mockGetWalletWebhook.mockResolvedValue(makeWebhook({ enabled: false }));

    await request(app)
      .post('/api/v1/wallets/wallet-1/webhooks/webhook-1/deliveries/delivery-1/replay')
      .expect(400);

    expect(mockReplayWalletWebhookDelivery).not.toHaveBeenCalled();
  });
});

function makeWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-1',
    walletId: 'wallet-1',
    name: 'Accounting',
    enabled: true,
    url: 'https://example.com/hook',
    eventTypes: ['wallet.transaction.received'],
    filters: null,
    payloadProfile: 'sanctuary_wallet_event_v1',
    authType: 'hmac_sha256',
    hasSecret: true,
    headerConfig: null,
    profileConfig: null,
    retryConfig: null,
    maxAttempts: 5,
    failureNotificationEnabled: true,
    createdByUserId: 'user-1',
    lastDeliveryStatus: null,
    lastDeliveredAt: null,
    lastError: null,
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
    ...overrides,
  };
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    endpointId: 'webhook-1',
    walletId: 'wallet-1',
    eventId: 'event-1',
    eventType: 'wallet.transaction.received',
    payloadProfile: 'sanctuary_wallet_event_v1',
    status: 'failed',
    attemptCount: 2,
    nextAttemptAt: null,
    lastAttemptAt: '2026-05-22T00:00:00.000Z',
    deliveredAt: null,
    lastStatusCode: 503,
    lastError: 'Webhook endpoint returned HTTP 503',
    requestBodyHash: 'a'.repeat(64),
    requestHeadersRedacted: { 'x-sanctuary-signature': '[REDACTED]' },
    responseBodyHash: 'b'.repeat(64),
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
    ...overrides,
  };
}
