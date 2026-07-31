import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { ConflictError, ForbiddenError, InvalidInputError } from '../../../src/errors';
import { transferRepository } from '../../../src/repositories';
import { confirmTransfer, initiateTransfer } from '../../../src/services/transferService';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';

const describeIntegration = canRunIntegrationTests() ? describe : describe.skip;

describeIntegration('ownership transfer consistency', () => {
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

  it('commits expired status before returning the expiration error', async () => {
    const { owner, recipient, wallet } = await createTransferFixture(prisma);
    const transfer = await prisma.ownershipTransfer.create({
      data: {
        resourceType: 'wallet',
        resourceId: wallet.id,
        fromUserId: owner.id,
        toUserId: recipient.id,
        status: 'accepted',
        acceptedAt: new Date(Date.now() - 2_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    await expect(confirmTransfer(owner.id, transfer.id)).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    await expect(prisma.ownershipTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { status: true },
    })).resolves.toEqual({ status: 'expired' });
  });

  it('allows only one active transfer under concurrent initiation', async () => {
    const { owner, recipient, wallet } = await createTransferFixture(prisma);
    const secondRecipient = await createUser(prisma, 'second-recipient');

    const results = await Promise.allSettled([
      initiateTransfer(owner.id, {
        resourceType: 'wallet',
        resourceId: wallet.id,
        toUserId: recipient.id,
      }),
      initiateTransfer(owner.id, {
        resourceType: 'wallet',
        resourceId: wallet.id,
        toUserId: secondRecipient.id,
      }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictError),
    });
    await expect(prisma.ownershipTransfer.count({
      where: {
        resourceType: 'wallet',
        resourceId: wallet.id,
        status: { in: ['pending', 'accepted'] },
      },
    })).resolves.toBe(1);
  });

  it('rejects stale initiation after a locked ownership handoff commits', async () => {
    const { owner, recipient, wallet } = await createTransferFixture(prisma);
    const newOwner = await createUser(prisma, 'new-owner');
    const handoffReady = createDeferred<void>();
    const releaseHandoff = createDeferred<void>();

    const handoff = prisma.$transaction(async tx => {
      await transferRepository.lockResourceOwnership('wallet', wallet.id, tx);
      await tx.walletUser.updateMany({
        where: { walletId: wallet.id, userId: owner.id, role: 'owner' },
        data: { role: 'viewer' },
      });
      await tx.walletUser.create({
        data: { walletId: wallet.id, userId: newOwner.id, role: 'owner' },
      });
      handoffReady.resolve();
      await releaseHandoff.promise;
    });

    let initiation:
      | Promise<
          | { status: 'fulfilled' }
          | { status: 'rejected'; reason: unknown }
        >
      | undefined;

    try {
      await handoffReady.promise;
      let initiationSettled = false;
      initiation = initiateTransfer(owner.id, {
        resourceType: 'wallet',
        resourceId: wallet.id,
        toUserId: recipient.id,
      }).then(
        () => {
          initiationSettled = true;
          return { status: 'fulfilled' as const };
        },
        reason => {
          initiationSettled = true;
          return { status: 'rejected' as const, reason };
        },
      );

      await waitForOwnershipFenceWaiter(prisma);
      expect(initiationSettled).toBe(false);

      releaseHandoff.resolve();
      await handoff;

      const result = await initiation;
      expect(result).toMatchObject({
        status: 'rejected',
        reason: expect.any(ForbiddenError),
      });
      await expect(prisma.ownershipTransfer.count({
        where: {
          resourceType: 'wallet',
          resourceId: wallet.id,
          fromUserId: owner.id,
        },
      })).resolves.toBe(0);
    } finally {
      releaseHandoff.resolve();
      await handoff.catch(() => undefined);
      await initiation;
    }
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForOwnershipFenceWaiter(prisma: PrismaClient): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [waiter] = await prisma.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE '%UPDATE "wallets" SET "updatedAt" = "updatedAt"%'
      ) AS present
    `;
    if (waiter?.present) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for initiation to block on the ownership fence');
}

async function createTransferFixture(prisma: PrismaClient) {
  const owner = await createUser(prisma, 'owner');
  const recipient = await createUser(prisma, 'recipient');
  const wallet = await prisma.wallet.create({
    data: {
      name: 'Transfer wallet',
      type: 'single_sig',
      scriptType: 'native_segwit',
      users: {
        create: { userId: owner.id, role: 'owner' },
      },
    },
  });
  return { owner, recipient, wallet };
}

async function createUser(prisma: PrismaClient, prefix: string) {
  const suffix = randomUUID();
  return prisma.user.create({
    data: {
      username: `${prefix}-${suffix}`,
      password: 'integration-test-password',
      email: `${prefix}-${suffix}@example.com`,
    },
  });
}
