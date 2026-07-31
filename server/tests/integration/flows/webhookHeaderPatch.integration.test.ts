import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { updateWalletWebhook } from '../../../src/services/webhooks/endpointService';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';

const describeIntegration = canRunIntegrationTests() ? describe : describe.skip;

describeIntegration('webhook header patch concurrency', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('serializes concurrent deletion and replacement without reviving stale credentials', async () => {
    const wallet = await prisma.wallet.create({
      data: {
        name: 'Concurrent webhook wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
      },
    });
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        walletId: wallet.id,
        name: 'Concurrent receiver',
        url: 'https://example.com/hook',
        eventTypes: ['wallet.transaction.received'],
        headerConfig: {
          headers: {
            A: 'old-a',
            B: 'old-b',
          },
        },
      },
    });
    const heldLock = await holdEndpointRow(prisma, endpoint.id);

    const deletion = updateWalletWebhook(wallet.id, endpoint.id, {
      headerConfig: { headers: { A: null } },
    }, 'owner');
    const replacement = updateWalletWebhook(wallet.id, endpoint.id, {
      headerConfig: { headers: { B: 'new-b' } },
    }, 'owner');

    try {
      await waitForEndpointLockWaiters(prisma, 2);
    } finally {
      await heldLock.release();
    }

    await expect(Promise.all([deletion, replacement])).resolves.toEqual([
      expect.objectContaining({ configuredHeaderNames: expect.any(Array) }),
      expect.objectContaining({ configuredHeaderNames: expect.any(Array) }),
    ]);
    const persisted = await prisma.webhookEndpoint.findUniqueOrThrow({
      where: { id: endpoint.id },
      select: { headerConfig: true },
    });
    expect(persisted.headerConfig).toEqual({
      headers: {
        B: 'new-b',
      },
    });
  });

  it('scrubs legacy diagnostic values idempotently in the deployed migration', async () => {
    const wallet = await prisma.wallet.create({
      data: {
        name: 'Legacy diagnostic wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
      },
    });
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        walletId: wallet.id,
        name: 'Legacy receiver',
        url: 'https://example.com/hook',
        eventTypes: ['wallet.transaction.received'],
      },
    });
    await prisma.webhookDelivery.createMany({
      data: [
        makeDelivery(endpoint.id, wallet.id, 'legacy-object', {
          Authorization: 'Bearer legacy-secret',
          'X-Arbitrary': 'legacy-value',
        }),
        makeDelivery(endpoint.id, wallet.id, 'legacy-malformed', ['legacy-secret']),
      ],
    });
    const migrationSql = await readFile(
      new URL('../../../prisma/migrations/20260731000000_redact_webhook_delivery_headers/migration.sql', import.meta.url),
      'utf8',
    );

    await prisma.$executeRawUnsafe(migrationSql);
    await prisma.$executeRawUnsafe(migrationSql);

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
      orderBy: { eventId: 'asc' },
      select: { eventId: true, requestHeadersRedacted: true },
    });
    expect(deliveries).toEqual([
      { eventId: 'legacy-malformed', requestHeadersRedacted: null },
      {
        eventId: 'legacy-object',
        requestHeadersRedacted: {
          Authorization: '[REDACTED]',
          'X-Arbitrary': '[REDACTED]',
        },
      },
    ]);
  });
});

function makeDelivery(
  endpointId: string,
  walletId: string,
  eventId: string,
  requestHeadersRedacted: object,
) {
  return {
    endpointId,
    walletId,
    eventId,
    eventType: 'wallet.transaction.received',
    payloadProfile: 'sanctuary_wallet_event_v1',
    targetUrl: 'https://example.com/hook',
    eventPayload: { eventId },
    requestHeadersRedacted,
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function holdEndpointRow(prisma: PrismaClient, endpointId: string) {
  const ready = createDeferred();
  const release = createDeferred();
  const transaction = prisma.$transaction(async tx => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "webhook_endpoints"
      WHERE "id" = ${endpointId}
      FOR UPDATE
    `;
    ready.resolve();
    await release.promise;
  });
  await ready.promise;
  return {
    release: async () => {
      release.resolve();
      await transaction;
    },
  };
}

async function waitForEndpointLockWaiters(
  prisma: PrismaClient,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [waiters] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%FROM "webhook_endpoints"%'
        AND query ILIKE '%FOR NO KEY UPDATE%'
    `;
    if (Number(waiters?.count ?? 0) >= expectedCount) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expectedCount} webhook endpoint lock waiter(s)`);
}
