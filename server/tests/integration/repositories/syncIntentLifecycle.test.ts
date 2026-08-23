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
const SYNCED_AT = new Date('2026-08-22T07:06:00.000Z');

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
      expectedRequestedGeneration: 1,
    });
    expect(claim).toMatchObject({
      status: 'claimed',
      claim: { generation: 1 },
      state: {
        syncInProgress: true,
        lastSyncStatus: 'syncing',
        lastSyncError: null,
        syncExecutionOwner: 'worker',
        syncStartedAt: NOW,
        syncStateVersion: 1,
      },
    });

    const trailingRequests = await Promise.all(
      Array.from({ length: 5 }, () => requestIncrementalSync(walletId)),
    );
    expect(trailingRequests.filter(result => result.status === 'requested')).toHaveLength(1);
    expect(trailingRequests.filter(result => result.status === 'merged')).toHaveLength(4);

    await expect(completeIncrementalSync(
      walletId,
      { generation: 1, leaseToken: token },
      { syncedAt: SYNCED_AT, lastSyncedBlockHeight: 840_000 },
    )).resolves.toMatchObject({
      status: 'applied',
      trailingGenerationPending: true,
      state: {
        requestedIncrementalSyncGeneration: 2,
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 1,
        syncInProgress: false,
        lastSyncedAt: SYNCED_AT,
        lastSyncedBlockHeight: 840_000,
        lastSyncStatus: 'success',
        syncExecutionOwner: null,
        syncStartedAt: null,
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncActionRequiredAt: null,
        syncStateVersion: 2,
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
        expectedRequestedGeneration: 1,
      })
    )));
    expect(claims.filter(result => result.status === 'claimed')).toHaveLength(1);
    expect(claims.filter(result => result.status === 'already_claimed')).toHaveLength(5);
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
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'not_claimed' });
  });

  it('binds a wake-up to its expected requested generation', async () => {
    const walletId = await createWallet();
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        requestedIncrementalSyncGeneration: 2,
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 1,
      },
    });
    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'not_claimed' });
    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 2,
    })).resolves.toMatchObject({ status: 'claimed', claim: { generation: 2 } });
  });

  it('does not reclaim an expired incremental lease in Phase 2B', async () => {
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
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'already_claimed' });
    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
      expectedExpiredFence: { generation: 1, leaseToken: randomUUID() },
    })).rejects.toThrow('cannot be reclaimed');
  });

  it('does not acknowledge an active generation after a trailing request arrives', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    await claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    await requestIncrementalSync(walletId);

    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'already_claimed' });
  });

  it('releases retries and terminal failures without consuming pending intent', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    const firstToken = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken: firstToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    const retryAt = new Date('2026-08-22T07:10:00.000Z');
    await expect(releaseIncrementalSyncForRetry(
      walletId,
      { generation: 1, leaseToken: firstToken },
      {
        releasedAt: NOW,
        nextRetryAt: retryAt,
        errorMessage: 'Electrum unavailable',
        failureClass: 'electrum_unavailable',
      },
    )).resolves.toMatchObject({
      status: 'applied',
      state: {
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 0,
        processedIncrementalSyncGeneration: 0,
        syncRetryCount: 1,
        syncNextRetryAt: retryAt,
        syncInProgress: false,
        lastSyncStatus: 'retrying',
        lastSyncError: 'Electrum unavailable',
        lastSyncFailureClass: 'electrum_unavailable',
        syncExecutionOwner: 'worker',
        syncStartedAt: null,
        syncStateVersion: 2,
      },
    });

    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'not_claimed' });
    const secondToken = randomUUID();
    const secondClaimAt = new Date('2026-08-22T07:10:00.000Z');
    await claimIncrementalSync(walletId, {
      leaseToken: secondToken,
      claimedAt: secondClaimAt,
      leaseExpiresAt: new Date('2026-08-22T07:15:00.000Z'),
      expectedRequestedGeneration: 1,
    });
    const actionAt = new Date('2026-08-22T07:11:00.000Z');
    await expect(releaseIncrementalSyncAsActionRequired(
      walletId,
      { generation: 1, leaseToken: secondToken },
      {
        actionRequiredAt: actionAt,
        errorMessage: 'Descriptor requires repair',
        failureClass: 'descriptor_policy_missing',
      },
    )).resolves.toMatchObject({
      status: 'applied',
      state: {
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 0,
        processedIncrementalSyncGeneration: 0,
        syncRetryCount: 2,
        syncNextRetryAt: null,
        syncActionRequiredAt: actionAt,
        syncInProgress: false,
        lastSyncStatus: 'failed',
        lastSyncError: 'Descriptor requires repair',
        lastSyncFailureClass: 'descriptor_policy_missing',
        syncExecutionOwner: null,
        syncStartedAt: null,
        syncStateVersion: 4,
      },
    });
  });

  it('rejects a mismatched completion token without changing lifecycle state', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    const token = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken: token,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });

    await expect(completeIncrementalSync(
      walletId,
      { generation: 1, leaseToken: randomUUID() },
      { syncedAt: SYNCED_AT, lastSyncedBlockHeight: 840_000 },
    )).resolves.toEqual({ status: 'lost_fence' });
    await expect(prisma.wallet.findUnique({ where: { id: walletId } })).resolves.toMatchObject({
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
      incrementalSyncLeaseToken: token,
      syncInProgress: true,
      lastSyncStatus: 'syncing',
      syncStateVersion: 1,
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
