import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { webhookRepository } from '../../../src/repositories/webhookRepository';
import { updateWalletWebhook } from '../../../src/services/webhooks/endpointService';
import {
  canRunIntegrationTests,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';

const describeWithDatabase = canRunIntegrationTests() ? describe : describe.skip;
const BARRIER_TRANSACTION_TIMEOUT_MS = 15_000;
const LOCK_OBSERVATION_TIMEOUT_MS = 1_500;

describeWithDatabase('webhook endpoint enqueue ordering', () => {
  let prisma: PrismaClient;
  const walletIds: string[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    prisma = await setupTestDatabase();
  });

  afterEach(async () => {
    if (endpointIds.length > 0) {
      await prisma.webhookDelivery.deleteMany({ where: { endpointId: { in: endpointIds } } });
      await prisma.webhookEndpoint.deleteMany({ where: { id: { in: endpointIds } } });
      endpointIds.splice(0);
    }
    if (walletIds.length > 0) {
      await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
      walletIds.splice(0);
    }
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('retires an admitted delivery when create serializes before endpoint repoint', async () => {
    const { walletId, endpointId } = await createEndpointFixture(prisma);
    walletIds.push(walletId);
    endpointIds.push(endpointId);
    const input = createInput(endpointId, walletId);

    const tableBarrier = await holdWebhookDeliveryTable(prisma);
    const createTask = settle(webhookRepository.createDelivery(input));
    let updateTask: Promise<Settled<Awaited<ReturnType<typeof updateWalletWebhook>>>> | undefined;
    let setupError: unknown;
    let releaseError: unknown;
    try {
      const createBackendPid = await waitForBlockedDeliveryInsert(prisma, tableBarrier.backendPid);
      updateTask = settle(updateWalletWebhook(walletId, endpointId, {
        url: 'https://new.example/hook',
      }, 'owner'));
      await waitForEndpointLockWaiter(prisma, createBackendPid);
    } catch (error) {
      setupError = error;
    } finally {
      try {
        await tableBarrier.release();
      } catch (error) {
        releaseError = error;
      }
    }

    const created = await createTask;
    const updated = updateTask ? await updateTask : undefined;
    if (setupError) throw setupError;
    if (releaseError) throw releaseError;
    if ('error' in created) throw created.error;
    if (updated && 'error' in updated) throw updated.error;
    expect(created.value.accepted).toBe(true);
    if (!created.value.accepted) return;
    expect(updated && 'value' in updated ? updated.value : undefined)
      .toEqual(expect.objectContaining({ url: 'https://new.example/hook' }));

    const duplicateInput = {
      ...input,
      expectedUrl: 'https://new.example/hook',
      targetUrl: 'https://new.example/hook',
    };
    const duplicateResults = await Promise.all([
      webhookRepository.createDelivery(duplicateInput),
      webhookRepository.createDelivery(duplicateInput),
    ]);
    expect(duplicateResults.every(result => result.accepted)).toBe(true);
    expect(new Set(duplicateResults.flatMap(result => result.accepted ? [result.delivery.id] : [])))
      .toEqual(new Set([created.value.delivery.id]));
    await expect(prisma.webhookDelivery.count({ where: { endpointId } })).resolves.toBe(1);
    await expect(prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: created.value.delivery.id },
      select: { status: true },
    })).resolves.toEqual({ status: 'dead' });
  });

  it('refuses a stale create blocked behind an endpoint repoint', async () => {
    const { walletId, endpointId } = await createEndpointFixture(prisma);
    walletIds.push(walletId);
    endpointIds.push(endpointId);
    const heldUpdate = await holdEndpointRow(prisma, endpointId, async tx => {
      await tx.webhookEndpoint.update({
        where: { id: endpointId },
        data: { url: 'https://new.example/hook' },
      });
    });

    const staleCreate = settle(webhookRepository.createDelivery(createInput(endpointId, walletId)));
    let waitError: unknown;
    let releaseError: unknown;
    try {
      await waitForEndpointLockWaiter(prisma, heldUpdate.backendPid);
    } catch (error) {
      waitError = error;
    } finally {
      try {
        await heldUpdate.release();
      } catch (error) {
        releaseError = error;
      }
    }

    const staleResult = await staleCreate;
    if (waitError) throw waitError;
    if (releaseError) throw releaseError;
    if ('error' in staleResult) throw staleResult.error;
    expect(staleResult.value).toEqual({
      accepted: false,
      reason: 'endpoint_identity_changed',
    });
    await expect(prisma.webhookDelivery.count({ where: { endpointId } })).resolves.toBe(0);
  });
});

async function createEndpointFixture(prisma: PrismaClient): Promise<{
  walletId: string;
  endpointId: string;
}> {
  const suffix = randomUUID();
  const wallet = await prisma.wallet.create({
    data: {
      name: `webhook enqueue ordering ${suffix}`,
      type: 'single_sig',
      scriptType: 'native_segwit',
    },
  });
  const endpoint = await webhookRepository.createEndpoint({
    walletId: wallet.id,
    name: `enqueue ordering ${suffix}`,
    url: 'https://old.example/hook',
    eventTypes: ['wallet.transaction.received'],
    secretEncrypted: 'stored-ciphertext-A',
  });
  return { walletId: wallet.id, endpointId: endpoint.id };
}

function createInput(endpointId: string, walletId: string) {
  return {
    endpointId,
    walletId,
    expectedUrl: 'https://old.example/hook',
    expectedSecretEncrypted: 'stored-ciphertext-A',
    eventId: 'event-enqueue-ordering',
    eventType: 'wallet.transaction.received',
    payloadProfile: 'sanctuary_wallet_event_v1',
    targetUrl: 'https://old.example/hook',
    eventPayload: { eventId: 'event-enqueue-ordering' },
  };
}

async function holdEndpointRow(
  prisma: PrismaClient,
  endpointId: string,
  update?: (tx: PrismaClient) => Promise<void>,
) {
  let signalReady!: () => void;
  let signalRelease!: () => void;
  const ready = new Promise<void>(resolve => { signalReady = resolve; });
  const released = new Promise<void>(resolve => { signalRelease = resolve; });
  let backendPid = 0;
  const transaction = prisma.$transaction(async tx => {
    const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
      SELECT pg_backend_pid() AS pid
    `;
    backendPid = backend.pid;
    await tx.$queryRaw`
      SELECT "id"
      FROM "webhook_endpoints"
      WHERE "id" = ${endpointId}
      FOR UPDATE
    `;
    await update?.(tx as unknown as PrismaClient);
    signalReady();
    await released;
  }, { timeout: BARRIER_TRANSACTION_TIMEOUT_MS });
  await Promise.race([ready, transaction]);
  return {
    backendPid,
    release: async () => {
      signalRelease();
      await transaction;
    },
  };
}

async function holdWebhookDeliveryTable(prisma: PrismaClient) {
  let signalReady!: () => void;
  let signalRelease!: () => void;
  const ready = new Promise<void>(resolve => { signalReady = resolve; });
  const released = new Promise<void>(resolve => { signalRelease = resolve; });
  let backendPid = 0;
  const transaction = prisma.$transaction(async tx => {
    const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
      SELECT pg_backend_pid() AS pid
    `;
    backendPid = backend.pid;
    await tx.$executeRaw`LOCK TABLE "webhook_deliveries" IN SHARE MODE`;
    signalReady();
    await released;
  }, { timeout: BARRIER_TRANSACTION_TIMEOUT_MS });
  await Promise.race([ready, transaction]);
  return {
    backendPid,
    release: async () => {
      signalRelease();
      await transaction;
    },
  };
}

type Settled<T> = { value: T } | { error: unknown };

function settle<T>(operation: Promise<T>): Promise<Settled<T>> {
  return operation.then(value => ({ value }), error => ({ error }));
}

async function waitForBlockedDeliveryInsert(prisma: PrismaClient, blockerPid: number): Promise<number> {
  const deadline = Date.now() + LOCK_OBSERVATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [waiter] = await prisma.$queryRaw<Array<{ pid: number }>>`
      SELECT pid
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database()
        AND wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
        AND query ILIKE 'INSERT INTO %'
        AND query ILIKE '%"webhook_deliveries"%'
    `;
    if (waiter) return waiter.pid;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for createDelivery upsert to block on the table barrier');
}

async function waitForEndpointLockWaiter(prisma: PrismaClient, blockerPid: number): Promise<void> {
  const deadline = Date.now() + LOCK_OBSERVATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [waiters] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database()
        AND wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
        AND query ILIKE '%FROM "webhook_endpoints"%'
        AND query ILIKE '%FOR NO KEY UPDATE%'
    `;
    if (Number(waiters?.count ?? 0) > 0) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for a webhook endpoint row lock waiter');
}
