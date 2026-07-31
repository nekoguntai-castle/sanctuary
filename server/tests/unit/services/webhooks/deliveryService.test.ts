import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PinnedRequestOptions,
  PinnedResponse,
} from '../../../../src/services/outboundNetwork/nativeRequest';
import { makeDelivery, makeEndpoint, makeEvent } from './deliveryService.fixtures';

const outboundTransport = vi.hoisted(() => ({
  actual: null as ((options: PinnedRequestOptions) => Promise<PinnedResponse>) | null,
  request: vi.fn<(options: PinnedRequestOptions) => Promise<PinnedResponse>>(),
}));

const mockCreateDelivery = vi.fn();
const mockClaimDeliveryAttempt = vi.fn();
const mockDnsLookup = vi.fn();
const mockFindDeliveryById = vi.fn();
const mockListDueDeliveries = vi.fn();
const mockListEndpoints = vi.fn();
const mockMarkDeliveryDead = vi.fn();
const mockMarkDeliveryFailed = vi.fn();
const mockMarkDeliveryDelivered = vi.fn();
const mockMarkDeliveryPendingForReplay = vi.fn();
const mockQueueWebhookDeliveryNotification = vi.fn();
const mockWalletLog = vi.fn();
const realFetch = globalThis.fetch;

vi.mock('../../../../src/repositories', () => ({
  webhookRepository: {
    claimDeliveryAttempt: mockClaimDeliveryAttempt,
    createDelivery: mockCreateDelivery,
    findDeliveryById: mockFindDeliveryById,
    listDueDeliveries: mockListDueDeliveries,
    listEndpoints: mockListEndpoints,
    markDeliveryDead: mockMarkDeliveryDead,
    markDeliveryFailed: mockMarkDeliveryFailed,
    markDeliveryDelivered: mockMarkDeliveryDelivered,
    markDeliveryPendingForReplay: mockMarkDeliveryPendingForReplay,
  },
}));

vi.mock('../../../../src/infrastructure', () => ({
  queueWebhookDeliveryNotification: mockQueueWebhookDeliveryNotification,
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: mockWalletLog,
}));

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockDnsLookup },
  lookup: mockDnsLookup,
}));

vi.mock('../../../../src/services/outboundNetwork/nativeRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/services/outboundNetwork/nativeRequest')>();
  outboundTransport.actual = actual.requestPinnedAddress;
  return {
    ...actual,
    requestPinnedAddress: outboundTransport.request,
  };
});

describe('webhook delivery service', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockClaimDeliveryAttempt.mockImplementation(
      async () => mockFindDeliveryById.mock.results.at(-1)?.value,
    );
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
    delete process.env.WEBHOOK_ALLOW_HTTP;
    delete process.env.WEBHOOK_ALLOWED_CIDRS;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network timeout')));
    outboundTransport.request.mockImplementation(async (options) => {
      if (options.url.hostname === 'webhook.test' || globalThis.fetch === realFetch) {
        return outboundTransport.actual!(options);
      }
      const response = await globalThis.fetch(options.url.toString(), {
        body: options.body,
        headers: options.headers,
        method: options.method,
      });
      const bodyText = await response.text().catch(() => '');
      const captureLimit = options.responseCaptureByteLimit ?? Number.POSITIVE_INFINITY;
      return {
        body: Buffer.from(bodyText).subarray(0, captureLimit),
        ok: response.ok,
        status: response.status,
      };
    });
  });

  it('returns cleanly when a delivery is missing or already terminal', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');

    mockFindDeliveryById.mockResolvedValueOnce(null);
    await expect(sendWebhookDelivery('missing')).resolves.toEqual({
      success: false,
      error: 'Webhook delivery not found',
    });

    mockFindDeliveryById
      .mockResolvedValueOnce(makeDelivery({ status: 'delivered', endpoint: makeEndpoint() }))
      .mockResolvedValueOnce(makeDelivery({ status: 'dead', endpoint: makeEndpoint() }));

    await expect(sendWebhookDelivery('delivered')).resolves.toEqual({ success: true });
    await expect(sendWebhookDelivery('dead')).resolves.toEqual({ success: true });
  });

  it('does not send when another worker owns the expected attempt', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    mockFindDeliveryById.mockResolvedValueOnce(makeDelivery({
      attemptCount: 1,
      nextAttemptAt: new Date('2026-05-22T00:00:00.000Z'),
      endpoint: makeEndpoint(),
    }));
    mockClaimDeliveryAttempt.mockResolvedValueOnce(null);

    await expect(sendWebhookDelivery('delivery-1', 2)).resolves.toEqual({
      success: true,
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockMarkDeliveryDelivered).not.toHaveBeenCalled();
  });

  it('marks exhausted retry deliveries dead and wallet-logs the failure', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const delivery = makeDelivery({ attemptCount: 1, endpoint: makeEndpoint({ maxAttempts: 2 }) });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockMarkDeliveryDead.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'dead',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));

    const result = await sendWebhookDelivery(delivery.id);

    expect(result.success).toBe(false);
    expect(mockMarkDeliveryDead).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: delivery.id,
      expectedAttempt: 2,
      error: 'network timeout',
    }));
    expect(mockWalletLog).toHaveBeenCalledWith(
      'wallet-1',
      'error',
      'WEBHOOK',
      'Webhook "Endpoint" failed after 2 attempts',
      expect.objectContaining({ deliveryId: delivery.id, error: 'network timeout' })
    );
    expect(mockQueueWebhookDeliveryNotification).not.toHaveBeenCalled();
  });

  it('does not wallet-log dead deliveries when failure notifications are disabled', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const delivery = makeDelivery({
      attemptCount: 0,
      endpoint: makeEndpoint({
        failureNotificationEnabled: false,
        maxAttempts: 5,
        url: 'https://93.184.216.34/webhook',
      }),
    });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue('bad request'),
    } as any);
    mockMarkDeliveryDead.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'dead',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));

    const result = await sendWebhookDelivery(delivery.id);

    expect(result).toEqual({
      success: false,
      error: 'Webhook endpoint returned HTTP 400',
    });
    expect(mockMarkDeliveryDead).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: delivery.id,
      expectedAttempt: 1,
      requestBodyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(outboundTransport.request).toHaveBeenCalledWith(expect.objectContaining({
      resolvedAddress: '93.184.216.34',
      responseCaptureByteLimit: 4096,
      timeoutMessage: 'Webhook request timeout',
    }));
    expect(mockWalletLog).not.toHaveBeenCalled();
  });

  it('returns successful zero-status responses without marking the delivery delivered', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const delivery = makeDelivery({
      endpoint: makeEndpoint({ url: 'https://93.184.216.34/webhook' }),
    });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 0,
      text: vi.fn().mockResolvedValue(''),
    } as any);

    await expect(sendWebhookDelivery(delivery.id)).resolves.toEqual({
      success: true,
      statusCode: 0,
      responseBodyHash: undefined,
    });
    expect(mockMarkDeliveryDelivered).not.toHaveBeenCalled();
  });

  it('records endpoint policy failures without request diagnostics', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const delivery = makeDelivery({
      endpoint: makeEndpoint({
        maxAttempts: 3,
        url: 'http://192.168.5.10/hook',
      }),
    });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockMarkDeliveryDead.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'dead',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));

    await expect(sendWebhookDelivery(delivery.id)).resolves.toEqual({
      success: false,
      error: 'Webhook URL must use HTTPS unless explicitly allowlisted',
    });
    expect(mockMarkDeliveryDead).toHaveBeenCalledWith({
      deliveryId: delivery.id,
      error: 'Webhook URL must use HTTPS unless explicitly allowlisted',
      expectedAttempt: 1,
      leaseToken: expect.any(String),
    });
  });

  it('treats errors with non-string node codes as non-retryable', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const delivery = makeDelivery({
      endpoint: makeEndpoint({ url: 'https://93.184.216.34/webhook' }),
    });
    const error = Object.assign(new Error('receiver rejected'), { code: 7 });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(error);
    mockMarkDeliveryDead.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'dead',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));

    await expect(sendWebhookDelivery(delivery.id)).resolves.toEqual({
      success: false,
      error: 'receiver rejected',
    });
    expect(mockMarkDeliveryDead).toHaveBeenCalledWith(expect.objectContaining({
      error: 'receiver rejected',
    }));
  });

  it('retries retryable HTTP statuses and response text read failures', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const statuses = [408, 409, 425, 429, 500];

    for (const status of statuses) {
      const endpoint = makeEndpoint({
        maxAttempts: 3,
        retryConfig: { initialDelayMs: 10, maxDelayMs: 20, backoffMultiplier: 2 },
        url: 'https://93.184.216.34/webhook',
      });
      const delivery = makeDelivery({ id: `delivery-${status}`, endpoint });
      mockFindDeliveryById.mockResolvedValueOnce(delivery);
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: false,
        status,
        text: vi.fn().mockRejectedValue(new Error('body read failed')),
      } as any);
      mockMarkDeliveryFailed.mockImplementationOnce(async input => ({
        ...delivery,
        status: 'failed',
        attemptCount: input.expectedAttempt,
        lastError: input.error,
      }));
      mockQueueWebhookDeliveryNotification.mockResolvedValueOnce(true);

      await expect(sendWebhookDelivery(delivery.id)).resolves.toEqual({
        success: false,
        error: `Webhook endpoint returned HTTP ${status}`,
      });
    }

    expect(mockMarkDeliveryFailed).toHaveBeenCalledTimes(statuses.length);
    expect(mockQueueWebhookDeliveryNotification).toHaveBeenCalledTimes(statuses.length);
  });

  it('keeps a retry durably due when delayed enqueue returns false', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T00:00:00.000Z'));
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const delivery = makeDelivery({
      attemptCount: 0,
      nextAttemptAt: new Date('2026-05-22T00:00:00.000Z'),
      endpoint: makeEndpoint({
        maxAttempts: 3,
        retryConfig: { initialDelayMs: 10_000, maxDelayMs: 10_000, backoffMultiplier: 2 },
        url: 'https://93.184.216.34/webhook',
      }),
    });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockClaimDeliveryAttempt.mockResolvedValueOnce(delivery);
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('network timeout'));
    mockMarkDeliveryFailed.mockResolvedValueOnce(delivery);
    mockQueueWebhookDeliveryNotification.mockResolvedValueOnce(false);

    await expect(sendWebhookDelivery(delivery.id, 1)).resolves.toEqual({
      success: false,
      error: 'network timeout',
    });

    expect(mockMarkDeliveryFailed).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: delivery.id,
      expectedAttempt: 1,
      nextAttemptAt: new Date('2026-05-22T00:00:10.000Z'),
      leaseToken: expect.any(String),
    }));
    expect(mockQueueWebhookDeliveryNotification).toHaveBeenCalledWith(
      { deliveryId: delivery.id, attempt: 2 },
      { delayMs: 10_000 },
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('re-enqueues due rows without changing their eligibility first', async () => {
    const { recoverDueWebhookDeliveries } = await import('../../../../src/services/webhooks/deliveryService');
    mockListDueDeliveries.mockResolvedValueOnce([
      makeDelivery({ id: 'due-1', attemptCount: 1, endpoint: makeEndpoint() }),
      makeDelivery({ id: 'due-2', attemptCount: 3, endpoint: makeEndpoint() }),
    ]);
    mockQueueWebhookDeliveryNotification
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(recoverDueWebhookDeliveries(20)).resolves.toEqual({
      selected: 2,
      queued: 1,
      failed: 1,
    });

    expect(mockListDueDeliveries).toHaveBeenCalledWith(expect.any(Date), 20);
    expect(mockQueueWebhookDeliveryNotification).toHaveBeenNthCalledWith(1, {
      deliveryId: 'due-1',
      attempt: 2,
    });
    expect(mockQueueWebhookDeliveryNotification).toHaveBeenNthCalledWith(2, {
      deliveryId: 'due-2',
      attempt: 4,
    });
    expect(mockClaimDeliveryAttempt).not.toHaveBeenCalled();
  });

  it('bounds invalid webhook recovery batch sizes', async () => {
    const { recoverDueWebhookDeliveries } = await import('../../../../src/services/webhooks/deliveryService');
    mockListDueDeliveries.mockResolvedValue([]);

    await recoverDueWebhookDeliveries(0);
    await recoverDueWebhookDeliveries(900);
    await recoverDueWebhookDeliveries(Number.NaN);

    expect(mockListDueDeliveries).toHaveBeenNthCalledWith(1, expect.any(Date), 1);
    expect(mockListDueDeliveries).toHaveBeenNthCalledWith(2, expect.any(Date), 500);
    expect(mockListDueDeliveries).toHaveBeenNthCalledWith(3, expect.any(Date), 100);
  });

  it('does not enqueue a retry after stale ownership loses the failure transition', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const delivery = makeDelivery({
      nextAttemptAt: new Date('2026-05-22T00:00:00.000Z'),
      endpoint: makeEndpoint({ maxAttempts: 3, url: 'https://93.184.216.34/webhook' }),
    });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockClaimDeliveryAttempt.mockResolvedValueOnce(delivery);
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('network timeout'));
    mockMarkDeliveryFailed.mockResolvedValueOnce(null);

    await expect(sendWebhookDelivery(delivery.id, 1)).resolves.toEqual({
      success: false,
      error: 'network timeout',
    });
    expect(mockQueueWebhookDeliveryNotification).not.toHaveBeenCalled();
  });

  it('does not publish terminal failure state after stale ownership loses the dead transition', async () => {
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const delivery = makeDelivery({
      nextAttemptAt: new Date('2026-05-22T00:00:00.000Z'),
      endpoint: makeEndpoint({ maxAttempts: 1 }),
    });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockClaimDeliveryAttempt.mockResolvedValueOnce(delivery);
    mockMarkDeliveryDead.mockResolvedValueOnce(null);

    await expect(sendWebhookDelivery(delivery.id, 1)).resolves.toEqual({
      success: false,
      error: 'network timeout',
    });
    expect(mockWalletLog).not.toHaveBeenCalled();
  });

  it('replays an existing delivery row without minting a new event id', async () => {
    const { replayWalletWebhookDelivery } = await import('../../../../src/services/webhooks/endpointService');
    const delivery = makeDelivery({ attemptCount: 2, status: 'dead', endpoint: makeEndpoint() });
    const pendingDelivery = {
      ...delivery,
      attemptCount: 0,
      status: 'pending',
      nextAttemptAt: new Date('2026-05-22T01:00:00.000Z'),
    };
    mockFindDeliveryById.mockResolvedValueOnce(delivery).mockResolvedValueOnce(pendingDelivery);
    mockMarkDeliveryPendingForReplay.mockResolvedValue(pendingDelivery);
    mockQueueWebhookDeliveryNotification.mockResolvedValue(true);

    const result = await replayWalletWebhookDelivery('wallet-1', 'endpoint-1', delivery.id);

    expect(result).toMatchObject({
      success: true,
      queued: true,
      delivery: {
        id: delivery.id,
        eventId: delivery.eventId,
        status: 'pending',
      },
    });
    expect(mockMarkDeliveryPendingForReplay).toHaveBeenCalledWith(delivery.id);
    expect(mockQueueWebhookDeliveryNotification).toHaveBeenCalledWith({
      deliveryId: delivery.id,
      attempt: 1,
    });
  });

  it('queues a single event, filters non-matching endpoints, and falls back to inline send', async () => {
    const { queueWebhookEventDeliveries } = await import('../../../../src/services/webhooks/deliveryService');
    const matchingEndpoint = makeEndpoint({ id: 'matching-endpoint' });
    mockListEndpoints.mockResolvedValueOnce([
      matchingEndpoint,
      makeEndpoint({ id: 'disabled-endpoint', enabled: false }),
      makeEndpoint({ id: 'wrong-event', eventTypes: ['wallet.draft.created'] }),
      makeEndpoint({ id: 'below-threshold', filters: { minAmountSats: '999999' } }),
    ]);
    mockCreateDelivery.mockResolvedValueOnce({
      id: 'delivery-inline',
      attemptCount: 0,
    });
    mockQueueWebhookDeliveryNotification.mockResolvedValueOnce(false);
    mockFindDeliveryById.mockResolvedValueOnce(makeDelivery({
      id: 'delivery-inline',
      endpoint: matchingEndpoint,
    }));
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
      text: vi.fn().mockResolvedValue(''),
    } as any);
    mockMarkDeliveryDelivered.mockImplementationOnce(async (_deliveryId, input) => ({
      ...makeDelivery({ id: 'delivery-inline', endpoint: matchingEndpoint }),
      status: 'delivered',
      attemptCount: input.expectedAttempt,
      lastStatusCode: input.statusCode,
    }));

    await expect(queueWebhookEventDeliveries(makeEvent())).resolves.toEqual({
      queued: 1,
      errors: [],
    });

    expect(mockCreateDelivery).toHaveBeenCalledTimes(1);
    expect(mockFindDeliveryById).toHaveBeenCalledWith('delivery-inline');
    expect(mockMarkDeliveryDelivered).toHaveBeenCalled();
  });

  it('continues queueing when one endpoint create fails', async () => {
    const { queueWebhookEventsDeliveries } = await import('../../../../src/services/webhooks/deliveryService');
    mockListEndpoints.mockResolvedValueOnce([
      makeEndpoint({ id: 'bad-endpoint' }),
      makeEndpoint({ id: 'good-endpoint' }),
    ]);
    mockCreateDelivery
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ id: 'delivery-good', attemptCount: 0 });
    mockQueueWebhookDeliveryNotification.mockResolvedValueOnce(true);

    await expect(queueWebhookEventsDeliveries([makeEvent()])).resolves.toEqual({
      queued: 1,
      errors: ['database unavailable'],
    });
  });

  it('delivers to a local receiver with HMAC headers, idempotency, and no secret leakage', async () => {
    vi.stubGlobal('fetch', realFetch);
    process.env.WEBHOOK_ALLOWED_HOSTS = '127.0.0.1';
    process.env.WEBHOOK_ALLOW_HTTP = 'true';

    const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
    const receiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = 202;
        res.end('ok');
      });
    });

    await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
    try {
      const address = receiver.address();
      if (!address || typeof address === 'string') throw new Error('receiver did not bind to a TCP port');
      const endpoint = makeEndpoint({
        authType: 'configured_hmac_sha256',
        secretEncrypted: 'shared-secret',
        url: `http://127.0.0.1:${address.port}/hook`,
        headerConfig: {
          hmac: {
            timestampHeader: 'x-webhook-timestamp',
            nonceHeader: 'x-webhook-nonce',
            idempotencyKeyHeader: 'x-webhook-idempotency-key',
            payloadHashHeader: 'x-webhook-payload-sha256',
            signatureHeader: 'x-webhook-signature',
            canonical: ['method', 'path', 'timestamp', 'nonce', 'idempotencyKey', 'bodyHash'],
          },
        },
      });
      const delivery = makeDelivery({ endpoint });
      mockFindDeliveryById.mockResolvedValueOnce(delivery);
      mockMarkDeliveryDelivered.mockImplementationOnce(async (_deliveryId, input) => ({
        ...delivery,
        status: 'delivered',
        attemptCount: input.expectedAttempt,
        lastStatusCode: input.statusCode,
        requestBodyHash: input.requestBodyHash,
        requestHeadersRedacted: input.requestHeadersRedacted,
      }));

      const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
      const result = await sendWebhookDelivery(delivery.id);

      expect(result).toMatchObject({ success: true, statusCode: 202 });
      expect(received).toHaveLength(1);
      const request = received[0]!;
      const timestamp = String(request.headers['x-webhook-timestamp']);
      const nonce = String(request.headers['x-webhook-nonce']);
      const bodyHash = String(request.headers['x-webhook-payload-sha256']);
      const canonical = ['POST', '/hook', timestamp, nonce, delivery.eventId, bodyHash].join('\n');
      expect(request.headers['x-webhook-idempotency-key']).toBe(delivery.eventId);
      expect(request.headers['x-webhook-signature']).toBe(
        createHmac('sha256', 'shared-secret').update(canonical).digest('hex'),
      );
      expect(request.body).toContain('"eventId":"event-1"');
      expect(request.body).not.toContain('shared-secret');
      expect(mockMarkDeliveryDelivered).toHaveBeenCalledWith(delivery.id, expect.objectContaining({
        expectedAttempt: 1,
        statusCode: 202,
        requestHeadersRedacted: expect.objectContaining({
          'x-webhook-signature': '[REDACTED]',
        }),
      }));
    } finally {
      await new Promise<void>((resolve, reject) => {
        receiver.close(error => error ? reject(error) : resolve());
      });
    }
  });

  it('pins DNS webhook sends to the validated address and preserves the original host header', async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = 'webhook.test';
    process.env.WEBHOOK_ALLOW_HTTP = 'true';
    mockDnsLookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);

    const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
    const receiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = 200;
        res.end('accepted');
      });
    });

    await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
    try {
      const address = receiver.address();
      if (!address || typeof address === 'string') throw new Error('receiver did not bind to a TCP port');
      const endpoint = makeEndpoint({ url: `http://webhook.test:${address.port}/hook` });
      const delivery = makeDelivery({ endpoint });
      mockFindDeliveryById.mockResolvedValueOnce(delivery);
      mockMarkDeliveryDelivered.mockImplementationOnce(async (_deliveryId, input) => ({
        ...delivery,
        status: 'delivered',
        attemptCount: input.expectedAttempt,
        lastStatusCode: input.statusCode,
      }));

      const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
      const result = await sendWebhookDelivery(delivery.id);

      expect(result).toMatchObject({ success: true, statusCode: 200 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(received).toHaveLength(1);
      expect(received[0]!.headers.host).toBe(`webhook.test:${address.port}`);
      expect(received[0]!.body).toContain('"eventId":"event-1"');
      expect(mockMarkDeliveryDelivered).toHaveBeenCalledWith(delivery.id, expect.objectContaining({
        responseBodyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }));
    } finally {
      await new Promise<void>((resolve, reject) => {
        receiver.close(error => error ? reject(error) : resolve());
      });
    }
  });

  it('treats pinned DNS connection errors as retryable delivery failures', async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = 'webhook.test';
    process.env.WEBHOOK_ALLOW_HTTP = 'true';
    mockDnsLookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const port = await allocateClosedPort();
    const endpoint = makeEndpoint({
      maxAttempts: 2,
      url: `http://webhook.test:${port}/hook`,
    });
    const delivery = makeDelivery({ endpoint });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockMarkDeliveryFailed.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'dead',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));

    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const result = await sendWebhookDelivery(delivery.id);

    expect(result.success).toBe(false);
    expect(mockMarkDeliveryFailed).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: delivery.id,
      expectedAttempt: 1,
    }));
    expect(mockQueueWebhookDeliveryNotification).toHaveBeenCalledWith(
      { deliveryId: delivery.id, attempt: 2 },
      expect.objectContaining({ delayMs: expect.any(Number) }),
    );
  });

  it('treats empty DNS resolution as retryable', async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = 'webhook.test';
    process.env.WEBHOOK_ALLOW_HTTP = 'true';
    mockDnsLookup.mockResolvedValueOnce([]);
    const endpoint = makeEndpoint({
      maxAttempts: 2,
      url: 'http://webhook.test/hook',
    });
    const delivery = makeDelivery({ endpoint });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockMarkDeliveryFailed.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'failed',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));
    mockQueueWebhookDeliveryNotification.mockResolvedValue(true);

    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    await expect(sendWebhookDelivery(delivery.id)).resolves.toEqual({
      success: false,
      error: 'Webhook URL did not resolve to an address',
    });

    expect(mockMarkDeliveryFailed).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: delivery.id,
      error: 'Webhook URL did not resolve to an address',
    }));
  });

  it('treats pinned response stream errors as retryable delivery failures', async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = 'webhook.test';
    process.env.WEBHOOK_ALLOW_HTTP = 'true';
    mockDnsLookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const endpoint = makeEndpoint({
      maxAttempts: 2,
      url: 'http://webhook.test/hook',
    });
    const delivery = makeDelivery({ endpoint });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockMarkDeliveryFailed.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'failed',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));
    mockMarkDeliveryDead.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'dead',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));
    mockQueueWebhookDeliveryNotification.mockResolvedValue(true);

    const request = new EventEmitter() as EventEmitter & {
      destroy: (error?: Error) => void;
      end: (body?: string) => void;
    };
    request.destroy = (error?: Error) => request.emit('error', error ?? new Error('destroyed'));
    request.end = () => undefined;
    const requestSpy = vi.spyOn(http, 'request').mockImplementationOnce(((_options, callback) => {
      const response = new EventEmitter() as EventEmitter & {
        setEncoding: (encoding: string) => void;
        statusCode?: number;
      };
      response.statusCode = 200;
      response.setEncoding = () => undefined;
      callback?.(response as any);
      queueMicrotask(() => response.emit('error', new Error('response stream failed')));
      return request as any;
    }) as typeof http.request);

    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    await expect(sendWebhookDelivery(delivery.id)).resolves.toEqual({
      success: false,
      error: 'response stream failed',
    });

    expect(requestSpy).toHaveBeenCalled();
    expect(mockMarkDeliveryDead).toHaveBeenCalledWith(expect.objectContaining({
      error: 'response stream failed',
    }));
  });

  it('pins HTTPS DNS sends with SNI and default port handling', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const endpoint = makeEndpoint({
      url: 'https://webhook.test/hook',
    });
    const delivery = makeDelivery({ endpoint });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockMarkDeliveryDead.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'dead',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));

    const request = new EventEmitter() as EventEmitter & {
      destroy: (error?: Error) => void;
      end: (body?: string) => void;
    };
    request.destroy = (error?: Error) => request.emit('error', error ?? new Error('destroyed'));
    request.end = () => {
      queueMicrotask(() => {
        response.emit('data', 'a'.repeat(4096));
        response.emit('data', 'tail');
        response.emit('end');
      });
    };
    const response = new EventEmitter() as EventEmitter & {
      setEncoding: (encoding: string) => void;
      statusCode?: number;
    };
    response.setEncoding = () => undefined;
    const requestSpy = vi.spyOn(https, 'request').mockImplementationOnce(((options, callback) => {
      callback?.(response as any);
      expect(options).toMatchObject({
        protocol: 'https:',
        hostname: '93.184.216.34',
        port: 443,
        servername: 'webhook.test',
      });
      return request as any;
    }) as typeof https.request);

    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    await expect(sendWebhookDelivery(delivery.id)).resolves.toEqual({
      success: false,
      error: 'Webhook endpoint returned HTTP 0',
    });

    expect(requestSpy).toHaveBeenCalled();
    expect(mockMarkDeliveryDead).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Webhook endpoint returned HTTP 0',
    }));
  });

  it('fails pinned DNS sends on the absolute request deadline', async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = 'webhook.test';
    process.env.WEBHOOK_ALLOW_HTTP = 'true';
    mockDnsLookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const receivedRequest = deferred<void>();
    const receiver = http.createServer((req) => {
      req.resume();
      receivedRequest.resolve();
    });

    await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
    vi.useFakeTimers();
    try {
      const address = receiver.address();
      if (!address || typeof address === 'string') throw new Error('receiver did not bind to a TCP port');
      const endpoint = makeEndpoint({
        maxAttempts: 2,
        url: `http://webhook.test:${address.port}/hook`,
      });
      const delivery = makeDelivery({ endpoint });
      mockFindDeliveryById.mockResolvedValueOnce(delivery);
      mockMarkDeliveryFailed.mockImplementationOnce(async input => ({
        ...delivery,
        status: 'failed',
        attemptCount: input.expectedAttempt,
        lastError: input.error,
      }));
      mockQueueWebhookDeliveryNotification.mockResolvedValue(true);

      const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
      const deliveryResult = sendWebhookDelivery(delivery.id);
      await receivedRequest.promise;
      await vi.advanceTimersByTimeAsync(10_001);
      const result = await deliveryResult;

      expect(result).toMatchObject({
        success: false,
        error: 'Webhook request timeout',
      });
      expect(mockMarkDeliveryFailed).toHaveBeenCalledWith(expect.objectContaining({
        deliveryId: delivery.id,
        expectedAttempt: 1,
        error: 'Webhook request timeout',
      }));
    } finally {
      vi.useRealTimers();
      await new Promise<void>((resolve, reject) => {
        receiver.close(error => error ? reject(error) : resolve());
      });
    }
  });

  it('queues batched events with one endpoint lookup per wallet', async () => {
    const wallet1Endpoint = makeEndpoint({
      id: 'endpoint-wallet-1',
      eventTypes: ['wallet.transaction.*'],
      walletId: 'wallet-1',
    });
    const wallet2Endpoint = makeEndpoint({
      id: 'endpoint-wallet-2',
      eventTypes: ['wallet.transaction.received'],
      walletId: 'wallet-2',
    });
    mockListEndpoints.mockImplementation(async walletId => {
      if (walletId === 'wallet-1') return [wallet1Endpoint];
      if (walletId === 'wallet-2') return [wallet2Endpoint];
      return [];
    });
    mockCreateDelivery.mockImplementation(async input => ({
      id: `delivery-${input.endpointId}-${input.eventId}`,
      attemptCount: 0,
    }));
    mockQueueWebhookDeliveryNotification.mockResolvedValue(true);

    const { queueWebhookEventsDeliveries } = await import('../../../../src/services/webhooks/deliveryService');
    const result = await queueWebhookEventsDeliveries([
      makeEvent({ eventId: 'event-wallet-1-received', eventType: 'wallet.transaction.received' }),
      makeEvent({ eventId: 'event-wallet-1-sent', eventType: 'wallet.transaction.sent' }),
      makeEvent({
        eventId: 'event-wallet-2-received',
        eventType: 'wallet.transaction.received',
        wallet: { id: 'wallet-2', name: 'Cold', network: 'mainnet' },
      }),
    ]);

    expect(result).toEqual({ queued: 3, errors: [] });
    expect(mockListEndpoints).toHaveBeenCalledTimes(2);
    expect(mockListEndpoints).toHaveBeenNthCalledWith(1, 'wallet-1');
    expect(mockListEndpoints).toHaveBeenNthCalledWith(2, 'wallet-2');
    expect(mockCreateDelivery).toHaveBeenCalledTimes(3);
    expect(mockQueueWebhookDeliveryNotification).toHaveBeenCalledTimes(3);
  });
});

async function allocateClosedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('port allocator did not bind to a TCP port');
  }
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}
