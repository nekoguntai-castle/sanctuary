import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  completeSubscriptionEnrollment,
  requestSubscriptionEnrollment,
} from '../../../src/repositories/subscriptionCheckpointRepository';
import {
  createTestAddress,
  createTestUser,
  createTestWallet,
} from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const NOW = new Date('2026-08-22T10:00:00.000Z');
const LATER = new Date('2026-08-22T10:05:00.000Z');
const SCRIPT_HASH = 'a'.repeat(64);
const OBSERVED_STATUS = 'b'.repeat(64);

describeWithDatabase('subscription checkpoint lifecycle', () => {
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

  async function createFixture(network: 'signet' | 'mainnet' = 'signet') {
    const user = await createTestUser(factoryClient);
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, { network });
    walletIds.push(wallet.id);
    const address = await createTestAddress(factoryClient, wallet.id);
    return { wallet, address };
  }

  it('creates one pending enrollment slot and coalesces repeated requests', async () => {
    const { address } = await createFixture();

    await expect(requestSubscriptionEnrollment(address.id, 'signet')).resolves.toMatchObject({
      status: 'requested',
      state: {
        addressId: address.id,
        network: 'signet',
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 0,
      },
    });
    await expect(requestSubscriptionEnrollment(address.id, 'signet')).resolves.toMatchObject({
      status: 'merged',
      state: {
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 0,
      },
    });
  });

  it('admits exactly one request when the initial checkpoint insert races', async () => {
    const { address } = await createFixture();

    const requests = await Promise.all(Array.from({ length: 6 }, () => (
      requestSubscriptionEnrollment(address.id, 'signet')
    )));
    expect(requests.filter(result => result.status === 'requested')).toHaveLength(1);
    expect(requests.filter(result => result.status === 'merged')).toHaveLength(5);
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        state: expect.objectContaining({
          requestedEnrollmentGeneration: 1,
          processedEnrollmentGeneration: 0,
        }),
      }),
    ]));
  });

  it('validates the supplied network against the owning wallet', async () => {
    const { address } = await createFixture('mainnet');

    await expect(requestSubscriptionEnrollment(address.id, 'signet'))
      .resolves.toEqual({ status: 'not_applied' });
    await expect(prisma.addressSubscriptionCheckpoint.findUnique({
      where: { addressId: address.id },
    })).resolves.toBeNull();
  });

  it('advances one generation after completion under concurrent requests', async () => {
    const { address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');
    await completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    });

    const requests = await Promise.all(Array.from({ length: 6 }, () => (
      requestSubscriptionEnrollment(address.id, 'signet')
    )));
    expect(requests.filter(result => result.status === 'requested')).toHaveLength(1);
    expect(requests.filter(result => result.status === 'merged')).toHaveLength(5);
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        state: expect.objectContaining({
          requestedEnrollmentGeneration: 2,
          processedEnrollmentGeneration: 1,
        }),
      }),
    ]));
  });

  it('atomically records exact completion evidence with authoritative null status', async () => {
    const { address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toMatchObject({
      status: 'applied',
      state: {
        statusKnown: true,
        observedStatus: null,
        lastObservedAt: NOW,
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 1,
      },
    });
  });

  it('completes the implicit first generation for a missing checkpoint row', async () => {
    const { address } = await createFixture();

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 2,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toEqual({ status: 'not_applied' });
    await expect(prisma.addressSubscriptionCheckpoint.findUnique({
      where: { addressId: address.id },
    })).resolves.toBeNull();

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toMatchObject({
      status: 'applied',
      state: {
        addressId: address.id,
        statusKnown: true,
        observedStatus: null,
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 1,
      },
    });
  });

  it('allows exactly one concurrent completion of a pending generation', async () => {
    const { address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');
    const input = {
      addressId: address.id,
      address: address.address,
      network: 'signet' as const,
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: NOW,
    };

    const completions = await Promise.all(Array.from({ length: 5 }, () => (
      completeSubscriptionEnrollment(input)
    )));
    expect(completions.filter(result => result.status === 'applied')).toHaveLength(1);
    expect(completions.filter(result => result.status === 'not_applied')).toHaveLength(4);
  });

  it('does not apply stale generations or evidence derived from a replaced address', async () => {
    const { address } = await createFixture();
    await requestSubscriptionEnrollment(address.id, 'signet');
    await completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    });
    await requestSubscriptionEnrollment(address.id, 'signet');

    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: LATER,
    })).resolves.toEqual({ status: 'not_applied' });

    await prisma.address.update({
      where: { id: address.id },
      data: { address: `${address.address}-replacement` },
    });
    await expect(completeSubscriptionEnrollment({
      addressId: address.id,
      address: address.address,
      network: 'signet',
      generation: 2,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: LATER,
    })).resolves.toEqual({ status: 'not_applied' });

    await expect(prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
      where: { addressId: address.id },
    })).resolves.toMatchObject({
      processedEnrollmentGeneration: 1,
      observedStatus: null,
      lastObservedAt: NOW,
    });
  });

  it('fails closed at the maximum enrollment generation', async () => {
    const { address } = await createFixture();
    await prisma.addressSubscriptionCheckpoint.create({
      data: {
        addressId: address.id,
        network: 'signet',
        scriptHash: SCRIPT_HASH,
        statusKnown: true,
        observedStatus: null,
        lastObservedAt: NOW,
        requestedEnrollmentGeneration: 2_147_483_647,
        processedEnrollmentGeneration: 2_147_483_647,
      },
    });

    await expect(requestSubscriptionEnrollment(address.id, 'signet'))
      .resolves.toEqual({ status: 'generation_exhausted' });
    await expect(prisma.addressSubscriptionCheckpoint.findUniqueOrThrow({
      where: { addressId: address.id },
    })).resolves.toMatchObject({
      requestedEnrollmentGeneration: 2_147_483_647,
      processedEnrollmentGeneration: 2_147_483_647,
    });
  });
});
