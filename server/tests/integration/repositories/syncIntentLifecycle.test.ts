import { randomUUID } from 'node:crypto';
import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  claimIncrementalSync,
  completeIncrementalSync,
  releaseIncrementalSyncAsActionRequired,
  releaseIncrementalSyncForRetry,
  resetIncrementalSyncAttempt,
  requestIncrementalSync,
  WalletSyncMutationFenceLostError,
  withWalletSyncMutationFence,
} from '../../../src/repositories/syncIntentRepository';
import {
  completeFencedWalletFullResync,
  findStrandedFullResyncWalletsPage,
  isExactFullResyncPending,
  requestFullResyncGeneration,
  resetWalletForFullResync,
} from '../../../src/repositories/resyncRepository';
import { createTestTransaction, createTestUser, createTestWallet } from './setup';
import { runWalletSyncMutation } from '../../../src/services/bitcoin/sync/mutationBoundary';
import { persistGapLimitExpansion } from '../../../src/services/bitcoin/sync/addressDiscovery';
import { executeInChunks } from '../../../src/services/bitcoin/sync/confirmations/batchUpdates';
import { buildCanonicalAddressEvidence } from '../../../src/services/wallet/addressGeneration';
import { addressRepository } from '../../../src/repositories';
import { getNotificationService } from '../../../src/websocket/notifications';
import { getWalletSyncAggregates } from '../../../src/repositories/supportWalletSyncDiagnosticsRepository';

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
        syncStateVersion: 2,
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
        syncStateVersion: 4,
      },
    });
  });

  it('counts only a request behind an active claim as trailing', async () => {
    const trailingCount = async (): Promise<number> => {
      const aggregates = await getWalletSyncAggregates({ staleThresholdMs: 600_000 });
      return aggregates.networks.find(row => row.network === 'testnet3')
        ?.trailingIncrementalRequest ?? 0;
    };
    const baseline = await trailingCount();
    const walletId = await createWallet();

    await requestIncrementalSync(walletId);
    await expect(trailingCount()).resolves.toBe(baseline);

    const leaseToken = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    await requestIncrementalSync(walletId);

    await expect(trailingCount()).resolves.toBe(baseline + 1);
  });

  it('does not clear a newer successful lifecycle state from an older stale snapshot', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    const leaseToken = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    const staleSnapshot = await prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: {
        syncStateVersion: true,
        syncExecutionOwner: true,
        syncStartedAt: true,
      },
    });
    await completeIncrementalSync(
      walletId,
      { generation: 1, leaseToken },
      { syncedAt: SYNCED_AT, lastSyncedBlockHeight: 840_000 },
    );

    await expect(resetIncrementalSyncAttempt(walletId, staleSnapshot)).resolves.toBeNull();
    await expect(prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
      select: {
        lastSyncStatus: true,
        lastSyncedAt: true,
        incrementalSyncLeaseToken: true,
      },
    })).resolves.toEqual({
      lastSyncStatus: 'success',
      lastSyncedAt: SYNCED_AT,
      incrementalSyncLeaseToken: null,
    });
  });

  it('holds terminal full resyncs out of recovery until explicit exact reopen', async () => {
    const walletId = await createWallet();
    await expect(requestFullResyncGeneration(walletId)).resolves.toMatchObject({
      status: 'requested', generation: 1, incrementalGeneration: 1,
      state: { id: walletId, syncStateVersion: 1 },
    });
    const leaseToken = randomUUID();
    await expect(claimIncrementalSync(walletId, {
      leaseToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
      fullResyncGeneration: 1,
    })).resolves.toMatchObject({ status: 'claimed' });
    await expect(releaseIncrementalSyncAsActionRequired(
      walletId,
      { generation: 1, leaseToken },
      {
        actionRequiredAt: SYNCED_AT,
        errorMessage: 'operator repair required',
        failureClass: 'other',
      },
    )).resolves.toMatchObject({
      status: 'applied',
      state: { syncActionRequiredAt: SYNCED_AT },
    });

    await expect(findStrandedFullResyncWalletsPage()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: walletId })]),
    );
    await expect(isExactFullResyncPending(walletId, 1, 1)).resolves.toBe(false);
    await expect(requestFullResyncGeneration(walletId)).resolves.toMatchObject({
      status: 'merged', generation: 1, incrementalGeneration: 1,
      state: { id: walletId, syncStateVersion: 4 },
    });
    await expect(isExactFullResyncPending(walletId, 1, 1)).resolves.toBe(true);
  });

  it('coalesces concurrent full-resync requests into one exact outstanding generation', async () => {
    const walletId = await createWallet();

    const requests = await Promise.all(
      Array.from({ length: 8 }, () => requestFullResyncGeneration(walletId)),
    );

    expect(requests.filter(result => result.status === 'requested')).toHaveLength(1);
    expect(requests.filter(result => result.status === 'merged')).toHaveLength(7);
    expect(requests.every(result => (
      'generation' in result
      && result.generation === 1
      && result.incrementalGeneration === 1
    ))).toBe(true);
    await expect(prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        requestedFullResyncGeneration: true,
        requestedIncrementalSyncGeneration: true,
        processedFullResyncGeneration: true,
      },
    })).resolves.toEqual({
      requestedFullResyncGeneration: 1,
      requestedIncrementalSyncGeneration: 1,
      processedFullResyncGeneration: 0,
    });
  });

  it('admits only the exact fenced full-resync generation and completes both intents', async () => {
    const walletId = await createWallet();
    await expect(requestFullResyncGeneration(walletId)).resolves.toMatchObject({
      status: 'requested',
      generation: 1,
      incrementalGeneration: 1,
      state: { id: walletId, syncStateVersion: 1 },
    });
    const ordinaryToken = randomUUID();
    await expect(claimIncrementalSync(walletId, {
      leaseToken: ordinaryToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'not_claimed' });

    const leaseToken = randomUUID();
    await expect(claimIncrementalSync(walletId, {
      leaseToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
      fullResyncGeneration: 1,
    })).resolves.toMatchObject({
      status: 'claimed',
      claim: { generation: 1, leaseToken },
    });
    const fence = Object.freeze({ walletId, generation: 1, leaseToken });
    await expect(resetWalletForFullResync(walletId, 1, fence)).resolves.toEqual({
      deletedTransactions: 0,
      resetPerformed: true,
    });
    await expect(resetWalletForFullResync(walletId, 1, {
      ...fence,
      leaseToken: randomUUID(),
    })).rejects.toBeInstanceOf(WalletSyncMutationFenceLostError);
    await expect(completeFencedWalletFullResync(
      walletId,
      1,
      fence,
      { syncedAt: SYNCED_AT, lastSyncedBlockHeight: 840_000 },
    )).resolves.toMatchObject({
      completionRecorded: true,
      syncState: {
        requestedFullResyncGeneration: 1,
        processedFullResyncGeneration: 1,
        requestedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 1,
        incrementalSyncLeaseToken: null,
        lastSyncStatus: 'success',
      },
    });
  });

  it('keeps a full resync claimable when requested behind an active older generation', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    const oldToken = randomUUID();
    await expect(claimIncrementalSync(walletId, {
      leaseToken: oldToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    })).resolves.toMatchObject({ status: 'claimed' });
    await expect(requestFullResyncGeneration(walletId)).resolves.toMatchObject({
      status: 'requested', generation: 1, incrementalGeneration: 2,
      state: { id: walletId, syncStateVersion: 3 },
    });

    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 2,
      fullResyncGeneration: 1,
    })).resolves.toEqual({ status: 'already_claimed' });

    await completeIncrementalSync(
      walletId,
      { generation: 1, leaseToken: oldToken },
      { syncedAt: SYNCED_AT, lastSyncedBlockHeight: 840_000 },
    );
    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 2,
      fullResyncGeneration: 1,
    })).resolves.toMatchObject({ status: 'claimed', claim: { generation: 2 } });
  });

  it('explicitly reopens terminal full-resync intent without allocating a new generation', async () => {
    const walletId = await createWallet();
    await requestFullResyncGeneration(walletId);
    const failedToken = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken: failedToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
      fullResyncGeneration: 1,
    });
    await releaseIncrementalSyncAsActionRequired(
      walletId,
      { generation: 1, leaseToken: failedToken },
      {
        actionRequiredAt: NOW,
        errorMessage: 'terminal full-resync failure',
        failureClass: 'other',
      },
    );

    await expect(requestFullResyncGeneration(walletId)).resolves.toMatchObject({
      status: 'merged', generation: 1, incrementalGeneration: 1,
      state: { id: walletId, syncStateVersion: 4, syncRetryCount: 0 },
    });
    await expect(claimIncrementalSync(walletId, {
      leaseToken: randomUUID(),
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
      fullResyncGeneration: 1,
    })).resolves.toMatchObject({ status: 'claimed' });
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
        syncStateVersion: 0,
      },
    });
    await expect(requestIncrementalSync(walletId, 'explicit_reopen')).resolves.toMatchObject({
      status: 'merged',
      state: {
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncActionRequiredAt: null,
        syncStateVersion: 1,
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

  it('reclaims only the exact expired incremental lease and rotates its token', async () => {
    const walletId = await createWallet();
    const oldToken = randomUUID();
    const oldClaimedAt = new Date('2026-08-22T06:00:00.000Z');
    const oldExpiry = new Date('2026-08-22T06:05:00.000Z');
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        requestedIncrementalSyncGeneration: 2,
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
      expectedExpiredFence: { walletId, generation: 1, leaseToken: randomUUID() },
    })).resolves.toEqual({ status: 'already_claimed' });

    const newToken = randomUUID();
    await expect(claimIncrementalSync(walletId, {
      leaseToken: newToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
      expectedExpiredFence: { walletId, generation: 1, leaseToken: oldToken },
    })).resolves.toMatchObject({
      status: 'claimed',
      claim: { walletId, generation: 1, leaseToken: newToken },
      state: {
        requestedIncrementalSyncGeneration: 2,
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 0,
        incrementalSyncLeaseToken: newToken,
      },
    });
  });

  it('serializes an old fenced mutation before reclaim then rejects its stale token', async () => {
    const walletId = await createWallet();
    const oldToken = randomUUID();
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 1,
        incrementalSyncLeaseToken: oldToken,
        incrementalSyncClaimedAt: new Date('2026-08-22T06:00:00.000Z'),
        incrementalSyncLeaseExpiresAt: new Date('2026-08-22T06:05:00.000Z'),
      },
    });

    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    let reportMutationStarted!: () => void;
    const mutationStarted = new Promise<void>((resolve) => { reportMutationStarted = resolve; });
    const oldFence = { walletId, generation: 1, leaseToken: oldToken };
    const oldMutation = withWalletSyncMutationFence(oldFence, async (tx) => {
      await tx.wallet.update({
        where: { id: walletId },
        data: { lastSyncedBlockHeight: 840_001 },
      });
      reportMutationStarted();
      await mutationGate;
    });
    await mutationStarted;

    const newToken = randomUUID();
    let reclaimSettled = false;
    const reclaim = claimIncrementalSync(walletId, {
      leaseToken: newToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
      expectedExpiredFence: oldFence,
    });
    void reclaim.then(() => { reclaimSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(reclaimSettled).toBe(false);

    releaseMutation();
    await oldMutation;
    await expect(reclaim).resolves.toMatchObject({
      status: 'claimed',
      claim: { walletId, generation: 1, leaseToken: newToken },
    });
    await expect(withWalletSyncMutationFence(oldFence, async () => undefined))
      .rejects.toBeInstanceOf(WalletSyncMutationFenceLostError);
    await expect(prisma.wallet.findUnique({ where: { id: walletId } })).resolves.toMatchObject({
      lastSyncedBlockHeight: 840_001,
      incrementalSyncLeaseToken: newToken,
    });
  });

  it('rolls back on connection loss and releases the row lock for pooled reuse', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    const token = randomUUID();
    const claim = await claimIncrementalSync(walletId, {
      leaseToken: token,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    expect(claim).toMatchObject({ status: 'claimed' });
    const fence = { walletId, generation: 1, leaseToken: token };

    await expect(withWalletSyncMutationFence(fence, async (tx) => {
      await tx.wallet.update({
        where: { id: walletId },
        data: { lastSyncedBlockHeight: 840_002 },
      });
      await tx.$queryRawUnsafe('SELECT pg_terminate_backend(pg_backend_pid())');
    })).rejects.toThrow();
    await expect(prisma.wallet.findUnique({ where: { id: walletId } })).resolves.toMatchObject({
      lastSyncedBlockHeight: null,
    });

    await expect(withWalletSyncMutationFence(fence, async (tx) => tx.wallet.update({
      where: { id: walletId },
      data: { lastSyncedBlockHeight: 840_003 },
    }))).resolves.toMatchObject({ lastSyncedBlockHeight: 840_003 });
  });

  it('serializes manual reset behind a mutation and revokes the former owner', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    const leaseToken = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    const fence = { walletId, generation: 1, leaseToken };
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>(resolve => { releaseMutation = resolve; });
    let reportMutationStarted!: () => void;
    const mutationStarted = new Promise<void>(resolve => { reportMutationStarted = resolve; });
    const mutation = withWalletSyncMutationFence(fence, async (tx) => {
      await tx.wallet.update({
        where: { id: walletId },
        data: { lastSyncedBlockHeight: 840_004 },
      });
      reportMutationStarted();
      await mutationGate;
    });
    await mutationStarted;

    let resetSettled = false;
    const reset = resetIncrementalSyncAttempt(walletId);
    void reset.then(() => { resetSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(resetSettled).toBe(false);
    releaseMutation();
    await mutation;
    await expect(reset).resolves.toMatchObject({
      requestedIncrementalSyncGeneration: 1,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
      incrementalSyncLeaseToken: null,
      syncInProgress: false,
      lastSyncStatus: null,
      lastSyncedBlockHeight: 840_004,
    });
    await expect(withWalletSyncMutationFence(fence, async () => undefined))
      .rejects.toBeInstanceOf(WalletSyncMutationFenceLostError);
  });

  it('preserves committed progress and suppresses post-commit effects on rollback', async () => {
    const walletId = await createWallet();
    await requestIncrementalSync(walletId);
    const token = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken: token,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    const mutationFence = { walletId, generation: 1, leaseToken: token };
    const published: string[] = [];

    await runWalletSyncMutation(
      { walletId, mutationFence },
      'gap_limit_expansion',
      async (tx, deferPostCommit) => {
        await tx!.wallet.update({
          where: { id: walletId },
          data: { lastSyncedBlockHeight: 840_010 },
        });
        deferPostCommit(() => {
          published.push('gap-limit-committed');
        });
      },
    );
    const rollback = new Error('missing-field chunk failed');
    await expect(runWalletSyncMutation(
      { walletId, mutationFence },
      'missing_field_chunk',
      async (tx, deferPostCommit) => {
        await tx!.wallet.update({
          where: { id: walletId },
          data: { lastSyncedBlockHeight: 840_011 },
        });
        deferPostCommit(() => {
          published.push('must-not-publish');
        });
        throw rollback;
      },
    )).rejects.toBe(rollback);

    await expect(prisma.wallet.findUnique({ where: { id: walletId } })).resolves.toMatchObject({
      lastSyncedBlockHeight: 840_010,
    });
    expect(published).toEqual(['gap-limit-committed']);
  });

  it('rejects a cross-wallet mutation target before opening the fenced transaction', async () => {
    const walletId = await createWallet();
    const otherWalletId = await createWallet();
    await requestIncrementalSync(walletId);
    const leaseToken = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    const mutationFence = { walletId, generation: 1, leaseToken } as const;

    await expect(runWalletSyncMutation(
      { walletId: otherWalletId, mutationFence },
      'address_usage',
      async (tx) => tx!.wallet.update({
        where: { id: otherWalletId },
        data: { lastSyncedBlockHeight: 840_019 },
      }),
    )).rejects.toThrow('does not match the mutation target wallet');
    await expect(prisma.wallet.findUnique({ where: { id: otherWalletId } }))
      .resolves.toMatchObject({ lastSyncedBlockHeight: null });
  });

  it('stops a former owner paused between committed mutation units after token rotation', async () => {
    const walletId = await createWallet();
    const oldToken = randomUUID();
    const oldFence = { walletId, generation: 1, leaseToken: oldToken };
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 1,
        incrementalSyncLeaseToken: oldToken,
        incrementalSyncClaimedAt: new Date('2026-08-22T06:00:00.000Z'),
        incrementalSyncLeaseExpiresAt: new Date('2026-08-22T06:05:00.000Z'),
      },
    });
    await runWalletSyncMutation(
      { walletId, mutationFence: oldFence },
      'transaction_batch',
      async (tx) => {
        await tx!.wallet.update({
          where: { id: walletId },
          data: { lastSyncedBlockHeight: 840_020 },
        });
      },
    );

    const newToken = randomUUID();
    await expect(claimIncrementalSync(walletId, {
      leaseToken: newToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
      expectedExpiredFence: oldFence,
    })).resolves.toMatchObject({ status: 'claimed' });
    const staleEffect = vi.fn();
    await expect(runWalletSyncMutation(
      { walletId, mutationFence: oldFence },
      'utxo_reconciliation',
      async (tx, deferPostCommit) => {
        await tx!.wallet.update({
          where: { id: walletId },
          data: { lastSyncedBlockHeight: 840_021 },
        });
        deferPostCommit(staleEffect);
      },
    )).rejects.toBeInstanceOf(WalletSyncMutationFenceLostError);

    await expect(prisma.wallet.findUnique({ where: { id: walletId } })).resolves.toMatchObject({
      lastSyncedBlockHeight: 840_020,
      incrementalSyncLeaseToken: newToken,
    });
    expect(staleEffect).not.toHaveBeenCalled();
  });

  it('does not pin transactions while five syncs wait on slow network work', async () => {
    const fences = await Promise.all(Array.from({ length: 5 }, async () => {
      const walletId = await createWallet();
      await requestIncrementalSync(walletId);
      const leaseToken = randomUUID();
      await claimIncrementalSync(walletId, {
        leaseToken,
        claimedAt: NOW,
        leaseExpiresAt: LEASE_END,
        expectedRequestedGeneration: 1,
      });
      return { walletId, generation: 1, leaseToken } as const;
    }));
    let releaseNetwork!: () => void;
    const slowNetwork = new Promise<void>(resolve => { releaseNetwork = resolve; });
    const reachedNetwork: Array<Promise<void>> = [];
    const syncs = fences.map((mutationFence, index) => {
      let reportNetwork!: () => void;
      reachedNetwork.push(new Promise<void>(resolve => { reportNetwork = resolve; }));
      return (async () => {
        await runWalletSyncMutation(
          { walletId: mutationFence.walletId, mutationFence },
          'gap_limit_expansion',
          async (tx) => {
            await tx!.wallet.update({
              where: { id: mutationFence.walletId },
              data: { lastSyncedBlockHeight: 840_100 + index },
            });
          },
        );
        reportNetwork();
        await slowNetwork;
        await runWalletSyncMutation(
          { walletId: mutationFence.walletId, mutationFence },
          'missing_field_chunk',
          async (tx) => {
            await tx!.wallet.update({
              where: { id: mutationFence.walletId },
              data: { lastSyncedBlockHeight: 840_200 + index },
            });
          },
        );
      })();
    });
    await Promise.all(reachedNetwork);

    await Promise.all(fences.map(mutationFence => prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '250ms'");
      await tx.wallet.update({
        where: { id: mutationFence.walletId },
        data: { lastSyncError: 'network-wait-observed' },
      });
    })));
    releaseNetwork();
    await Promise.all(syncs);

    await expect(prisma.wallet.findMany({
      where: { id: { in: fences.map(fence => fence.walletId) } },
      select: { lastSyncedBlockHeight: true, lastSyncError: true },
      orderBy: { lastSyncedBlockHeight: 'asc' },
    })).resolves.toEqual(Array.from({ length: 5 }, (_, index) => ({
      lastSyncedBlockHeight: 840_200 + index,
      lastSyncError: 'network-wait-observed',
    })));
  });

  it('fences recursive canonical gap expansion and missing-field chunk commits', async () => {
    const walletId = await createWallet();
    const tpub = 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';
    const descriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/0/*)`;
    const changeDescriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/1/*)`;
    const canonicalPolicyId = 'single-sig-native-segwit-bip84-v1';
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        network: 'testnet3',
        descriptor,
        changeDescriptor,
        descriptorPolicyVersion: 1,
        descriptorSourceKind: 'generated_pair',
        sourceDescriptor: descriptor,
        sourceChangeDescriptor: changeDescriptor,
        canonicalPolicyId,
        canonicalPolicyVersion: 1,
      },
    });
    await requestIncrementalSync(walletId);
    const leaseToken = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    const mutationFence = { walletId, generation: 1, leaseToken } as const;
    const preparation = {
      derive: (branch: 0 | 1, index: number) => buildCanonicalAddressEvidence(
        descriptor,
        changeDescriptor,
        'testnet3',
        { canonicalPolicyId, canonicalPolicyVersion: 1 },
        branch,
        index,
      ),
    };

    const initial = await runWalletSyncMutation(
      { walletId, mutationFence },
      'gap_limit_expansion',
      (tx, deferPostCommit) => persistGapLimitExpansion(
        walletId,
        preparation,
        tx,
        deferPostCommit,
      ),
    );
    expect(initial).toHaveLength(40);
    const receiveTail = await prisma.address.findFirstOrThrow({
      where: { walletId, branch: 0, index: 19 },
    });

    // This represents authoritative history observed after the first commit.
    // The follow-up expansion is a distinct fenced mutation, never one long
    // transaction around the recursive network pass.
    await runWalletSyncMutation(
      { walletId, mutationFence },
      'address_usage',
      async (tx) => {
        await addressRepository.markAsUsed(receiveTail.id, tx);
      },
    );
    const recursive = await runWalletSyncMutation(
      { walletId, mutationFence },
      'gap_limit_expansion',
      (tx, deferPostCommit) => persistGapLimitExpansion(
        walletId,
        preparation,
        tx,
        deferPostCommit,
      ),
    );
    expect(recursive).toHaveLength(20);

    const transaction = await createTestTransaction(factoryClient, walletId, {
      blockHeight: null,
    });
    const committed: string[] = [];
    await executeInChunks(
      [{
        id: transaction.id,
        data: { counterpartyAddress: 'bc1qfencedmissingfield' },
      }],
      walletId,
      updates => committed.push(...updates.map(update => update.id)),
      undefined,
      mutationFence,
    );
    expect(committed).toEqual([transaction.id]);
    await expect(prisma.transaction.findUnique({ where: { id: transaction.id } }))
      .resolves.toMatchObject({ counterpartyAddress: 'bc1qfencedmissingfield' });
  });

  it('suppresses production gap-limit wallet logs when its database write rolls back', async () => {
    const walletId = await createWallet();
    const tpub = 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';
    const descriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/0/*)`;
    const changeDescriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/1/*)`;
    const canonicalPolicyId = 'single-sig-native-segwit-bip84-v1';
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        descriptor,
        changeDescriptor,
        descriptorPolicyVersion: 1,
        descriptorSourceKind: 'generated_pair',
        sourceDescriptor: descriptor,
        sourceChangeDescriptor: changeDescriptor,
        canonicalPolicyId,
        canonicalPolicyVersion: 1,
      },
    });
    await requestIncrementalSync(walletId);
    const leaseToken = randomUUID();
    await claimIncrementalSync(walletId, {
      leaseToken,
      claimedAt: NOW,
      leaseExpiresAt: LEASE_END,
      expectedRequestedGeneration: 1,
    });
    const mutationFence = { walletId, generation: 1, leaseToken } as const;
    const firstEvidence = buildCanonicalAddressEvidence(
      descriptor,
      changeDescriptor,
      'testnet3',
      { canonicalPolicyId, canonicalPolicyVersion: 1 },
      0,
      0,
    );
    const broadcast = vi.spyOn(getNotificationService(), 'broadcastWalletLog');

    await expect(runWalletSyncMutation(
      { walletId, mutationFence },
      'gap_limit_expansion',
      (tx, deferPostCommit) => persistGapLimitExpansion(
        walletId,
        { derive: () => firstEvidence },
        tx,
        deferPostCommit,
      ),
    )).rejects.toThrow();
    expect(broadcast).not.toHaveBeenCalled();
    await expect(prisma.address.count({ where: { walletId } })).resolves.toBe(0);
    broadcast.mockRestore();
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
        syncStateVersion: 3,
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
        syncStateVersion: 5,
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
      syncStateVersion: 2,
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
