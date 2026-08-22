import { randomUUID } from 'node:crypto';
import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  claimIncrementalSync,
  completeIncrementalSync,
  releaseIncrementalSyncAsActionRequired,
  releaseIncrementalSyncForRetry,
  requestIncrementalSync,
} from '../../../src/repositories/syncIntentRepository';
import { createTestUser, createTestWallet } from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const NOW = new Date('2026-08-22T07:00:00.000Z');
const LEASE_END = new Date('2026-08-22T07:05:00.000Z');

describeWithDatabase('sync intent lifecycle', () => {
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

  async function createWallet(): Promise<string> {
    const identity = randomUUID();
    const user = await createTestUser(factoryClient, {
      username: `sync-intent-${identity}`,
      email: `sync-intent-${identity}@example.com`,
    });
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id);
    walletIds.push(wallet.id);
    return wallet.id;
  }

  it('coalesces races before pickup and activity during execution into one trailing pass', async () => {
    const walletId = await createWallet();
    const requests = await Promise.all(
      Array.from({ length: 8 }, () => requestIncrementalSync(walletId)),
    );
    expect(requests.filter(result => result.status === 'requested')).toHaveLength(1);
    expect(requests.filter(result => result.status === 'merged')).toHaveLength(7);

    const token = randomUUID();
    const claim = await claimIncrementalSync(walletId, {
      leaseToken: token,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
    });
    expect(claim).toMatchObject({ status: 'claimed', claim: { generation: 1 } });

    const trailingRequests = await Promise.all(
      Array.from({ length: 5 }, () => requestIncrementalSync(walletId)),
    );
    expect(trailingRequests.filter(result => result.status === 'requested')).toHaveLength(1);
    expect(trailingRequests.filter(result => result.status === 'merged')).toHaveLength(4);

    await expect(completeIncrementalSync(walletId, {
      generation: 1,
      leaseToken: token,
    })).resolves.toMatchObject({
      status: 'applied',
      trailingGenerationPending: true,
      state: {
        requestedIncrementalSyncGeneration: 2,
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 1,
      },
    });
  });

  it('admits exactly one concurrent claim', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    const claims = await Promise.all(Array.from({ length: 6 }, () => (
      claimIncrementalSync(walletId, {
        leaseToken: randomUUID(),
        claimedAt: NOW,
        leaseExpiresAt: LEASE_END,
      })
    )));
    expect(claims.filter(result => result.status === 'claimed')).toHaveLength(1);
    expect(claims.filter(result => result.status === 'not_claimed')).toHaveLength(5);
  });

  it('preserves action-required retry state until explicit reopen', async () => {
    const walletId = await createWallet();
    const actionRequiredAt = new Date('2026-08-22T06:00:00.000Z');
    const retryAt = new Date('2026-08-22T08:00:00.000Z');
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        requestedIncrementalSyncGeneration: 1,
        syncRetryCount: 3,
        syncNextRetryAt: retryAt,
        syncActionRequiredAt: actionRequiredAt,
      },
    });

    await expect(requestIncrementalSync(walletId)).resolves.toMatchObject({
      status: 'merged',
      state: {
        syncRetryCount: 3,
        syncNextRetryAt: retryAt,
        syncActionRequiredAt: actionRequiredAt,
      },
    });
    await expect(requestIncrementalSync(walletId, 'explicit_reopen')).resolves.toMatchObject({
      status: 'merged',
      state: {
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncActionRequiredAt: null,
      },
    });
  });

  it('blocks incremental claims while a full resync is pending', async () => {
    const walletId = await createWallet();
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        requestedIncrementalSyncGeneration: 1,
        requestedFullResyncGeneration: 1,
      },
    });
    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
    })).resolves.toEqual({ status: 'not_claimed' });
  });

  it('reclaims an expired claim only through its exact previous fence', async () => {
    const walletId = await createWallet();
    const oldToken = randomUUID();
    const oldClaimedAt = new Date('2026-08-22T06:00:00.000Z');
    const oldExpiry = new Date('2026-08-22T06:05:00.000Z');
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 1,
        incrementalSyncLeaseToken: oldToken,
        incrementalSyncClaimedAt: oldClaimedAt,
        incrementalSyncLeaseExpiresAt: oldExpiry,
      },
    });

    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
    })).resolves.toEqual({ status: 'not_claimed' });
    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedExpiredFence: { generation: 1, leaseToken: randomUUID() },
    })).resolves.toEqual({ status: 'not_claimed' });

    const newToken = randomUUID();
    await expect(claimIncrementalSync(walletId, {
      leaseToken: newToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedExpiredFence: { generation: 1, leaseToken: oldToken },
    })).resolves.toMatchObject({
      status: 'claimed',
      claim: { generation: 1, leaseToken: newToken },
    });
    await expect(completeIncrementalSync(walletId, {
      generation: 1,
      leaseToken: oldToken,
    })).resolves.toEqual({ status: 'lost_fence' });
  });

  it('releases retries and terminal failures without consuming pending intent', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    const firstToken = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken: firstToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
    });
    const retryAt = new Date('2026-08-22T07:10:00.000Z');
    await expect(releaseIncrementalSyncForRetry(
      walletId,
      { generation: 1, leaseToken: firstToken },
      { releasedAt: NOW, nextRetryAt: retryAt },
    )).resolves.toMatchObject({
      status: 'applied',
      state: {
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 0,
        processedIncrementalSyncGeneration: 0,
        syncRetryCount: 1,
        syncNextRetryAt: retryAt,
      },
    });

    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
    })).resolves.toEqual({ status: 'not_claimed' });
    const secondToken = randomUUID();
    const secondClaimAt = new Date('2026-08-22T07:10:00.000Z');
    await claimIncrementalSync(walletId, {
      leaseToken: secondToken,
      claimedAt: secondClaimAt,
      leaseExpiresAt: new Date('2026-08-22T07:15:00.000Z'),
    });
    const actionAt = new Date('2026-08-22T07:11:00.000Z');
    await expect(releaseIncrementalSyncAsActionRequired(
      walletId,
      { generation: 1, leaseToken: secondToken },
      actionAt,
    )).resolves.toMatchObject({
      status: 'applied',
      state: {
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 0,
        processedIncrementalSyncGeneration: 0,
        syncRetryCount: 2,
        syncNextRetryAt: null,
        syncActionRequiredAt: actionAt,
      },
    });
  });

  it('fails closed instead of overflowing the generation bound', async () => {
    const walletId = await createWallet();
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        requestedIncrementalSyncGeneration: 2_147_483_647,
        claimedIncrementalSyncGeneration: 2_147_483_647,
        processedIncrementalSyncGeneration: 2_147_483_647,
      },
    });
    await expect(requestIncrementalSync(walletId)).resolves
      .toEqual({ status: 'generation_exhausted' });
  });
});
