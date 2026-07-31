import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';

const mockQueueWebhookDeliveryNotification = vi.hoisted(() => vi.fn());

vi.mock('../../../src/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/infrastructure')>();
  return {
    ...actual,
    queueWebhookDeliveryNotification: mockQueueWebhookDeliveryNotification,
  };
});

const describeIntegration = canRunIntegrationTests() ? describe : describe.skip;

describeIntegration('webhook retry recovery', () => {
  let prisma: PrismaClient;
  let receiver: http.Server;
  let receiverUrl: string;
  let requestCount = 0;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
    receiver = http.createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(requestCount === 1 ? 503 : 204);
      response.end();
    });
    await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/webhook`;
  });

  beforeEach(async () => {
    await cleanupTestData();
    requestCount = 0;
    mockQueueWebhookDeliveryNotification.mockReset();
    process.env.WEBHOOK_ALLOWED_HOSTS = '127.0.0.1';
    process.env.WEBHOOK_ALLOW_HTTP = 'true';
  });

  afterEach(() => {
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
    delete process.env.WEBHOOK_ALLOW_HTTP;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      receiver.close(error => error ? reject(error) : resolve());
    });
    await teardownTestDatabase();
  });

  it('recovers a persisted retry after enqueue rejection without duplicate delivery', async () => {
    const wallet = await prisma.wallet.create({
      data: {
        name: 'Webhook recovery wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
      },
    });
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        walletId: wallet.id,
        name: 'Recovery receiver',
        url: receiverUrl,
        eventTypes: ['wallet.transaction.received'],
        maxAttempts: 3,
        retryConfig: {
          initialDelayMs: 60_000,
          maxDelayMs: 60_000,
          backoffMultiplier: 1,
        },
      },
    });
    const delivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        walletId: wallet.id,
        eventId: 'event-recovery-1',
        eventType: 'wallet.transaction.received',
        payloadProfile: endpoint.payloadProfile,
        targetUrl: receiverUrl,
        nextAttemptAt: new Date(),
        eventPayload: {
          schemaVersion: 'v1',
          eventId: 'event-recovery-1',
          eventType: 'wallet.transaction.received',
          occurredAt: '2026-07-30T00:00:00.000Z',
          wallet: { id: wallet.id, name: wallet.name, network: wallet.network },
          transaction: {
            txid: 'tx-recovery-1',
            type: 'received',
            amountSats: '1',
            feeSats: null,
            confirmations: 1,
            blockHeight: null,
            blockTime: null,
            memo: null,
            label: null,
            counterpartyAddress: null,
          },
          source: { service: 'sanctuary', dispatchPath: 'integration-test' },
        },
      },
    });
    mockQueueWebhookDeliveryNotification.mockResolvedValue(false);

    const {
      recoverDueWebhookDeliveries,
      sendWebhookDelivery,
    } = await import('../../../src/services/webhooks/deliveryService');
    const { webhookDeliveryJob } = await import('../../../src/worker/jobs/webhookDeliveryJobs');

    await expect(sendWebhookDelivery(delivery.id, 1)).resolves.toEqual({
      success: false,
      error: 'Webhook endpoint returned HTTP 503',
    });
    expect(requestCount).toBe(1);
    expect(await prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      select: {
        attemptCount: true,
        attemptLeaseToken: true,
        nextAttemptAt: true,
        status: true,
      },
    })).toMatchObject({
      attemptCount: 1,
      attemptLeaseToken: null,
      status: 'failed',
      nextAttemptAt: expect.any(Date),
    });

    mockQueueWebhookDeliveryNotification.mockClear();
    await expect(recoverDueWebhookDeliveries()).resolves.toEqual({
      selected: 0,
      queued: 0,
      failed: 0,
    });
    expect(requestCount).toBe(1);

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    mockQueueWebhookDeliveryNotification.mockResolvedValue(false);
    await expect(recoverDueWebhookDeliveries()).resolves.toEqual({
      selected: 1,
      queued: 0,
      failed: 1,
    });
    expect(requestCount).toBe(1);
    expect(await prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      select: {
        attemptCount: true,
        attemptLeaseToken: true,
        nextAttemptAt: true,
        status: true,
      },
    })).toMatchObject({
      attemptCount: 1,
      attemptLeaseToken: null,
      nextAttemptAt: expect.any(Date),
      status: 'failed',
    });

    // A later recovery pass (including after a worker restart) needs no
    // in-memory state from the failed enqueue: the unchanged due row is enough.
    mockQueueWebhookDeliveryNotification.mockClear();
    mockQueueWebhookDeliveryNotification.mockResolvedValue(true);
    await expect(recoverDueWebhookDeliveries()).resolves.toEqual({
      selected: 1,
      queued: 1,
      failed: 0,
    });
    expect(mockQueueWebhookDeliveryNotification).toHaveBeenCalledWith({
      deliveryId: delivery.id,
      attempt: 2,
    });

    const recoveryJob = {
      id: `webhook-delivery:${delivery.id}:2`,
      data: { deliveryId: delivery.id, attempt: 2 },
    } as Job<{ deliveryId: string; attempt: number }>;
    await expect(webhookDeliveryJob.handler(recoveryJob)).resolves.toEqual({
      success: true,
      channelsNotified: 1,
    });
    expect(requestCount).toBe(2);
    expect(await prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      select: { attemptCount: true, attemptLeaseToken: true, status: true },
    })).toEqual({
      attemptCount: 2,
      attemptLeaseToken: null,
      status: 'delivered',
    });

    await expect(webhookDeliveryJob.handler(recoveryJob)).resolves.toEqual({
      success: true,
      channelsNotified: 1,
    });
    expect(requestCount).toBe(2);
  });
});
