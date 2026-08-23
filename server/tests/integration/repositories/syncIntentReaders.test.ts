import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  findActionableIncrementalSyncIntents,
  findExpiredIncrementalSyncClaims,
  findIncrementalSyncIntent,
} from '../../../src/repositories/syncIntentRepository';
import {
  findPendingSubscriptionEnrollments,
  findSubscriptionCheckpoint,
} from '../../../src/repositories/subscriptionCheckpointRepository';
import {
  createTestAddress,
  createTestUser,
  createTestWallet,
} from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase('sync intent readers', () => {
  const userIds: string[] = [];
  const walletIds: string[] = [];
  const factoryClient = prisma as unknown as PrismaClient;

  afterEach(async () => {
    if (walletIds.length > 0) {
      await prisma.wallet.deleteMany({ where: { id: { in: walletIds.splice(0) } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createFixture() {
    const user = await createTestUser(factoryClient);
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, { network: 'signet' });
    walletIds.push(wallet.id);
    const address = await createTestAddress(factoryClient, wallet.id);
    return { wallet, address };
  }

  it('reads actionable generations without admitting action-required intent', async () => {
    const { wallet } = await createFixture();
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { requestedIncrementalSyncGeneration: 1 },
    });

    await expect(findIncrementalSyncIntent(wallet.id)).resolves.toMatchObject({
      requestedIncrementalSyncGeneration: 1,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
    });
    await expect(findActionableIncrementalSyncIntents({ now: new Date() }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: wallet.id })]));

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { syncActionRequiredAt: new Date() },
    });
    await expect(findActionableIncrementalSyncIntents({ now: new Date() }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: wallet.id })]));

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        syncActionRequiredAt: null,
        requestedFullResyncGeneration: 1,
      },
    });
    await expect(findActionableIncrementalSyncIntents({ now: new Date() }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: wallet.id })]));
  });

  it('does not reclaim an expired incremental claim during wake-up repair', async () => {
    const { wallet } = await createFixture();
    const claimedAt = new Date('2026-08-22T10:00:00.000Z');
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 0,
        incrementalSyncLeaseToken: '10000000-0000-4000-8000-000000000001',
        incrementalSyncClaimedAt: claimedAt,
        incrementalSyncLeaseExpiresAt: new Date('2026-08-22T10:05:00.000Z'),
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncStartedAt: claimedAt,
      },
    });

    await expect(findActionableIncrementalSyncIntents({
      now: new Date('2026-08-22T11:00:00.000Z'),
    })).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: wallet.id }),
    ]));
  });

  it('pages only actionable expired claims by lease expiry and wallet ID', async () => {
    const now = new Date('2026-08-22T11:00:00.000Z');
    const earlierExpiry = new Date('2026-08-22T10:00:00.000Z');
    const sharedExpiry = new Date('2026-08-22T10:30:00.000Z');
    const claimedAt = new Date('2026-08-22T09:00:00.000Z');
    const fixtures: Awaited<ReturnType<typeof createFixture>>[] = [];
    for (let index = 0; index < 7; index += 1) {
      fixtures.push(await createFixture());
    }
    const [earlier, sharedA, sharedB, future, fullResync, actionRequired, unclaimed] =
      fixtures.map(({ wallet }) => wallet);

    async function setClaim(
      walletId: string,
      leaseToken: string,
      leaseExpiresAt: Date,
      extra: { requestedFullResyncGeneration?: number; syncActionRequiredAt?: Date } = {},
    ): Promise<void> {
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          requestedIncrementalSyncGeneration: 2,
          claimedIncrementalSyncGeneration: 1,
          processedIncrementalSyncGeneration: 0,
          incrementalSyncLeaseToken: leaseToken,
          incrementalSyncClaimedAt: claimedAt,
          incrementalSyncLeaseExpiresAt: leaseExpiresAt,
          syncInProgress: true,
          syncExecutionOwner: 'worker',
          syncStartedAt: claimedAt,
          ...extra,
        },
      });
    }

    await setClaim(
      earlier.id,
      '10000000-0000-4000-8000-000000000001',
      earlierExpiry,
    );
    await setClaim(
      sharedA.id,
      '20000000-0000-4000-8000-000000000002',
      sharedExpiry,
    );
    await setClaim(
      sharedB.id,
      '30000000-0000-4000-8000-000000000003',
      sharedExpiry,
    );
    await setClaim(
      future.id,
      '40000000-0000-4000-8000-000000000004',
      new Date('2026-08-22T12:00:00.000Z'),
    );
    await setClaim(
      fullResync.id,
      '50000000-0000-4000-8000-000000000005',
      earlierExpiry,
      { requestedFullResyncGeneration: 1 },
    );
    await setClaim(
      actionRequired.id,
      '60000000-0000-4000-8000-000000000006',
      earlierExpiry,
      { syncActionRequiredAt: now },
    );
    await prisma.wallet.update({
      where: { id: unclaimed.id },
      data: { requestedIncrementalSyncGeneration: 1 },
    });

    const firstPage = await findExpiredIncrementalSyncClaims({ now, limit: 2 });
    expect(firstPage).toHaveLength(2);
    expect(firstPage[0]).toMatchObject({
      walletId: earlier.id,
      generation: 1,
      leaseToken: '10000000-0000-4000-8000-000000000001',
      leaseExpiresAt: earlierExpiry,
    });
    const secondPage = await findExpiredIncrementalSyncClaims({
      now,
      cursor: {
        leaseExpiresAt: firstPage[1].leaseExpiresAt,
        walletId: firstPage[1].walletId,
      },
      limit: 2,
    });
    const allRows = [...firstPage, ...secondPage];
    expect(allRows.map(row => row.walletId).sort()).toEqual(
      [earlier.id, sharedA.id, sharedB.id].sort(),
    );
    expect(allRows.slice(1).map(row => row.leaseExpiresAt)).toEqual([
      sharedExpiry,
      sharedExpiry,
    ]);
    expect(allRows.slice(1).map(row => row.walletId)).toEqual(
      [sharedA.id, sharedB.id].sort(),
    );
    expect(allRows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ walletId: future.id }),
      expect.objectContaining({ walletId: fullResync.id }),
      expect.objectContaining({ walletId: actionRequired.id }),
      expect.objectContaining({ walletId: unclaimed.id }),
    ]));
  });

  it('distinguishes a missing checkpoint from authoritative null status', async () => {
    const { address } = await createFixture();

    await expect(findPendingSubscriptionEnrollments({ network: 'signet' }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ addressId: address.id, checkpointMissing: true }),
      ]));

    await prisma.addressSubscriptionCheckpoint.create({
      data: {
        addressId: address.id,
        network: 'signet',
        scriptHash: 'a'.repeat(64),
        statusKnown: true,
        observedStatus: null,
        lastObservedAt: new Date(),
        processedEnrollmentGeneration: 1,
      },
    });

    await expect(findSubscriptionCheckpoint(address.id)).resolves.toMatchObject({
      statusKnown: true,
      observedStatus: null,
      requestedEnrollmentGeneration: 1,
      processedEnrollmentGeneration: 1,
    });
    await expect(findPendingSubscriptionEnrollments({ network: 'signet' }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ addressId: address.id })]));
  });
});
