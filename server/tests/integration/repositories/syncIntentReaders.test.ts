import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  findActionableIncrementalSyncIntents,
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
