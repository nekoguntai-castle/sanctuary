import { randomUUID } from 'node:crypto';
import { Job, Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  acquireLock,
  getRedisClient,
  initializeDistributedLock,
  initializeRedis,
  isLocked,
  releaseLock,
  shutdownDistributedLock,
  shutdownRedis,
  type DistributedLock,
} from '../../../src/infrastructure';
import {
  SYNC_QUEUE_NAME,
  SYNC_WALLET_JOB_NAME,
  SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
  getSyncLockKey,
  type SyncWalletJobData,
} from '../../../src/jobs/syncJobContract';
import prisma from '../../../src/models/prisma';
import {
  WalletSyncMutationFenceLostError,
  withWalletSyncMutationFence,
} from '../../../src/repositories/syncIntentRepository';
import type { WalletSyncMutationFence } from '../../../src/repositories/types';
import * as blockchain from '../../../src/services/bitcoin/blockchain';
import * as confirmations from '../../../src/services/bitcoin/sync/confirmations';
import {
  createSyncIntentAdmission,
  incrementalSyncWakeupJobId,
  syncIntentAdmission,
} from '../../../src/services/sync/syncIntentAdmission';
import {
  createSyncLifecyclePublisher,
  syncLifecyclePublisher,
} from '../../../src/services/sync/syncLifecyclePublisher';
import {
  closeWorkerSyncQueue,
  enqueueIncrementalSyncWakeup,
} from '../../../src/services/workerSyncQueue';
import { executeCanonicalIncrementalSync } from '../../../src/worker/jobs/canonicalIncrementalSync';
import type { JobExecutionContext } from '../../../src/worker/jobs/types';
import { createTestUser, createTestWallet } from '../repositories/setup';
import { describeWithRedis } from '../setup/redis';

const WORKER_QUEUE_PREFIX = 'sanctuary:worker';
const REQUIRED_MUTATION_FENCE_FLOOR = 1 as const;
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function bullConnection(): ConnectionOptions {
  const redis = getRedisClient();
  if (!redis) throw new Error('Redis integration client is unavailable');
  return {
    host: redis.options.host,
    port: redis.options.port,
    password: redis.options.password,
    db: redis.options.db,
  };
}

async function waitForState(
  job: Job,
  expected: 'active' | 'completed' | 'failed' | 'waiting',
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let state = await job.getState();
  while (state !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    state = await job.getState();
  }
  if (state !== expected) {
    throw new Error(`Timed out waiting for ${expected}; last BullMQ state was ${state}`);
  }
}

describeWithRedis('expired incremental reclaim authority chain', () => {
  const factoryClient = prisma as unknown as PrismaClient;
  const walletIds: string[] = [];
  const userIds: string[] = [];
  const trackedJobIds = new Set<string>();
  const locks: DistributedLock[] = [];
  const workers: Worker[] = [];
  let queue: Queue<SyncWalletJobData>;

  beforeAll(async () => {
    await prisma.$connect();
    await initializeRedis();
    initializeDistributedLock('redis-required');
    queue = new Queue<SyncWalletJobData>(SYNC_QUEUE_NAME, {
      connection: bullConnection(),
      prefix: WORKER_QUEUE_PREFIX,
    });
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map(worker => worker.close(true)));
    for (const jobId of trackedJobIds) {
      const job = await queue.getJob(jobId);
      await job?.remove().catch(() => undefined);
    }
    trackedJobIds.clear();
    for (const lock of locks.splice(0)) {
      await releaseLock(lock);
    }
    if (walletIds.length > 0) {
      await prisma.wallet.deleteMany({ where: { id: { in: walletIds.splice(0) } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await queue.close();
    await closeWorkerSyncQueue();
    shutdownDistributedLock();
    await shutdownRedis();
    await prisma.$disconnect();
  });

  async function createExpiredWallet(options: {
    leaseExpiresAt?: Date;
    requestedGeneration?: number;
  } = {}): Promise<{ walletId: string; oldToken: string; leaseExpiresAt: Date }> {
    const identity = randomUUID();
    const user = await createTestUser(factoryClient, {
      username: `expired-reclaim-${identity}`,
      email: `expired-reclaim-${identity}@example.com`,
    });
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id);
    walletIds.push(wallet.id);
    const oldToken = randomUUID();
    const leaseExpiresAt = options.leaseExpiresAt
      ?? new Date(Date.now() - 60_000);
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        requestedIncrementalSyncGeneration: options.requestedGeneration ?? 2,
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 0,
        incrementalSyncLeaseToken: oldToken,
        incrementalSyncClaimedAt: new Date(leaseExpiresAt.getTime() - 60_000),
        incrementalSyncLeaseExpiresAt: leaseExpiresAt,
        syncInProgress: true,
        lastSyncStatus: 'syncing',
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date(leaseExpiresAt.getTime() - 60_000),
      },
    });
    return { walletId: wallet.id, oldToken, leaseExpiresAt };
  }

  function activeAdmission() {
    const inspectActivation = vi.fn(async () => ({
      status: 'active' as const,
      requiredFloor: REQUIRED_MUTATION_FENCE_FLOOR,
      activatedAt: new Date().toISOString(),
    }));
    return {
      admission: createSyncIntentAdmission({
        enqueueWakeup: enqueueIncrementalSyncWakeup,
        enqueueFullResyncWakeup: vi.fn(async () => true),
        inspectActivation,
        isExecutionLockHeld: walletId => isLocked(getSyncLockKey({ walletId })),
        publishTransition: async () => undefined,
      }),
      inspectActivation,
    };
  }

  function trackJob(walletId: string, generation: number): string {
    const jobId = incrementalSyncWakeupJobId(walletId, generation);
    trackedJobIds.add(jobId);
    return jobId;
  }

  async function acquireWalletLock(walletId: string): Promise<DistributedLock> {
    const lock = await acquireLock(getSyncLockKey({ walletId }), 60_000);
    if (!lock) throw new Error('Could not acquire test wallet execution lock');
    locks.push(lock);
    return lock;
  }

  it('bounds recovery, replaces failed stable v3 work, preserves active work, and omits lease tokens', async () => {
    const now = new Date();
    const target = await createExpiredWallet({
      leaseExpiresAt: new Date(now.getTime() - 120_000),
    });
    const overflow = await createExpiredWallet({
      leaseExpiresAt: new Date(now.getTime() - 60_000),
    });
    const jobId = trackJob(target.walletId, 1);
    const overflowJobId = trackJob(overflow.walletId, 1);
    const logObservation = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const failingWorker = new Worker<SyncWalletJobData>(
      SYNC_QUEUE_NAME,
      async (job) => {
        if (job.id === jobId) throw new Error('retained failed wakeup');
      },
      { connection: bullConnection(), prefix: WORKER_QUEUE_PREFIX, concurrency: 1 },
    );
    failingWorker.on('error', () => undefined);
    workers.push(failingWorker);
    await failingWorker.waitUntilReady();
    const failed = await queue.add(SYNC_WALLET_JOB_NAME, {
      version: SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
      walletId: target.walletId,
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: REQUIRED_MUTATION_FENCE_FLOOR,
    }, {
      jobId,
      attempts: 1,
      removeOnFail: false,
    });
    await waitForState(failed, 'failed');
    await failingWorker.close();
    workers.splice(workers.indexOf(failingWorker), 1);

    const { admission, inspectActivation } = activeAdmission();
    const recovery = await admission.recoverExpired({ now, limit: 1 });
    expect(recovery).toEqual({
      scanned: 1,
      enqueued: 1,
      locked: 0,
      unavailable: 0,
      nextCursor: {
        leaseExpiresAt: target.leaseExpiresAt,
        walletId: target.walletId,
      },
    });
    expect(inspectActivation).toHaveBeenCalledTimes(3);
    const replacement = await queue.getJob(jobId);
    expect(replacement).toBeDefined();
    await expect(replacement!.getState()).resolves.toBe('waiting');
    expect(replacement!.data).toEqual({
      version: SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
      walletId: target.walletId,
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: REQUIRED_MUTATION_FENCE_FLOOR,
    });
    await expect(queue.getJob(overflowJobId)).resolves.toBeUndefined();

    const active = deferred<void>();
    const finish = deferred<void>();
    const holdingWorker = new Worker<SyncWalletJobData>(
      SYNC_QUEUE_NAME,
      async (job) => {
        if (job.id !== jobId) return;
        active.resolve();
        await finish.promise;
      },
      { connection: bullConnection(), prefix: WORKER_QUEUE_PREFIX, concurrency: 1 },
    );
    holdingWorker.on('error', () => undefined);
    workers.push(holdingWorker);
    await holdingWorker.waitUntilReady();
    await active.promise;
    const activeJob = await queue.getJob(jobId);
    await waitForState(activeJob!, 'active');
    const processedOn = activeJob!.processedOn;

    await expect(admission.recoverExpired({ now, limit: 1 })).resolves.toMatchObject({
      scanned: 1,
      enqueued: 1,
      locked: 0,
      unavailable: 0,
    });
    const preserved = await queue.getJob(jobId);
    await expect(preserved!.getState()).resolves.toBe('active');
    expect(preserved!.processedOn).toBe(processedOn);
    finish.resolve();
    await waitForState(preserved!, 'completed');

    const redisHash = await getRedisClient()!.hgetall(
      `${WORKER_QUEUE_PREFIX}:${SYNC_QUEUE_NAME}:${jobId}`,
    );
    const serializedObservations = JSON.stringify({
      recovery,
      job: replacement!.data,
      redisHash,
      logs: logObservation.mock.calls,
    });
    expect(serializedObservations).not.toContain(target.oldToken);
    expect(serializedObservations).not.toContain(overflow.oldToken);
  });

  it('skips a held execution lock and fails closed when Redis authority cannot answer', async () => {
    const now = new Date();
    const held = await createExpiredWallet();
    const heldJobId = trackJob(held.walletId, 1);
    await acquireWalletLock(held.walletId);
    const { admission } = activeAdmission();

    await expect(admission.recoverExpired({ now, limit: 1 })).resolves.toMatchObject({
      scanned: 1,
      enqueued: 0,
      locked: 1,
      unavailable: 0,
    });
    await expect(queue.getJob(heldJobId)).resolves.toBeUndefined();

    await releaseLock(locks.pop()!);
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis integration client is unavailable');
    const authorityFailure = vi.spyOn(redis, 'exists')
      .mockRejectedValueOnce(new Error('simulated Redis authority loss'));
    await expect(admission.recoverExpired({ now, limit: 1 })).resolves.toMatchObject({
      scanned: 1,
      enqueued: 0,
      locked: 0,
      unavailable: 1,
    });
    authorityFailure.mockRestore();
    await expect(queue.getJob(heldJobId)).resolves.toBeUndefined();
  });

  it('canonically reclaims only after lock acquisition, rotates the token, and rejects the former owner', async () => {
    const expired = await createExpiredWallet();
    const oldFence = Object.freeze({
      walletId: expired.walletId,
      generation: 1,
      leaseToken: expired.oldToken,
    });
    const oldJobId = trackJob(expired.walletId, 1);
    const trailingJobId = trackJob(expired.walletId, 2);
    const lock = await acquireWalletLock(expired.walletId);
    const { admission } = activeAdmission();
    vi.spyOn(syncIntentAdmission, 'claimFresh').mockImplementation(admission.claimFresh);
    vi.spyOn(syncIntentAdmission, 'reclaimExpired').mockImplementation(admission.reclaimExpired);
    vi.spyOn(syncIntentAdmission, 'complete').mockImplementation(admission.complete);
    vi.spyOn(syncIntentAdmission, 'wake').mockImplementation(admission.wake);

    const lifecycleObservations: unknown[] = [];
    const projectingPublisher = createSyncLifecyclePublisher({
      publishWebSocket: (walletId, snapshot) => {
        lifecycleObservations.push({ channel: 'websocket', walletId, snapshot });
      },
      publishEvent: (event) => {
        lifecycleObservations.push({ channel: 'event', event });
      },
    });
    vi.spyOn(syncLifecyclePublisher, 'publish')
      .mockImplementation((transition, context) => projectingPublisher.publish(transition, context));
    const logObservation = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const networkEntered = deferred<void>();
    const resumeNetwork = deferred<void>();
    let claimedFence: WalletSyncMutationFence | undefined;
    vi.spyOn(blockchain, 'syncWallet').mockImplementation(async (_walletId, _depth, _signal, fence) => {
      claimedFence = fence;
      networkEntered.resolve();
      await resumeNetwork.promise;
      return { addresses: 0, transactions: 0, utxos: 0 };
    });
    vi.spyOn(blockchain, 'getCachedBlockHeight').mockReturnValue(840_000);
    const populate = vi.spyOn(confirmations, 'populateMissingTransactionFields')
      .mockResolvedValue({ updated: 0, confirmationUpdates: [] });

    const data = {
      version: SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
      walletId: expired.walletId,
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: REQUIRED_MUTATION_FENCE_FLOOR,
    } as const;
    const job = {
      id: oldJobId,
      data,
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job<SyncWalletJobData>;
    const controller = new AbortController();
    const execution: JobExecutionContext = {
      signal: controller.signal,
      throwIfAborted: () => controller.signal.throwIfAborted(),
      acquiredLock: { key: lock.key },
    };
    const running = executeCanonicalIncrementalSync(
      job,
      data,
      execution,
      'testnet3',
      Date.now(),
      {
        isFinalAttempt: () => false,
        lockTtlMs: 60_000,
        publishAttemptTransition: vi.fn(),
        retryState: () => ({ nextRetryAt: new Date(Date.now() + 60_000) }),
        enrollWalletSubscriptions: vi.fn().mockResolvedValue(undefined),
      },
    );
    await networkEntered.promise;

    expect(claimedFence).toMatchObject({ walletId: expired.walletId, generation: 1 });
    expect(claimedFence!.leaseToken).not.toBe(expired.oldToken);
    const reclaimed = await prisma.wallet.findUniqueOrThrow({ where: { id: expired.walletId } });
    expect(reclaimed).toMatchObject({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
      incrementalSyncLeaseToken: claimedFence!.leaseToken,
    });

    await expect(withWalletSyncMutationFence(oldFence, async (tx) => {
      await tx.wallet.update({
        where: { id: expired.walletId },
        data: { name: 'former-owner-write' },
      });
    }))
      .rejects.toBeInstanceOf(WalletSyncMutationFenceLostError);
    await expect(admission.complete(expired.walletId, oldFence, {
      syncedAt: new Date(),
      lastSyncedBlockHeight: 839_999,
    })).resolves.toEqual({ status: 'lost_fence' });
    const paused = await prisma.wallet.findUniqueOrThrow({ where: { id: expired.walletId } });
    expect(paused.requestedIncrementalSyncGeneration).toBe(2);
    expect(paused.processedIncrementalSyncGeneration).toBe(0);
    expect(paused.name).not.toBe('former-owner-write');

    resumeNetwork.resolve();
    await expect(running).resolves.toMatchObject({ success: true, transactionsFound: 0, utxosUpdated: 0 });
    expect(populate).toHaveBeenCalledWith(
      expired.walletId,
      expect.any(AbortSignal),
      undefined,
      claimedFence,
      false,
      expect.any(Number),
    );
    const completed = await prisma.wallet.findUniqueOrThrow({ where: { id: expired.walletId } });
    expect(completed).toMatchObject({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseToken: null,
    });
    const trailingJob = await queue.getJob(trailingJobId);
    expect(trailingJob).toBeDefined();
    expect(trailingJob!.data).toEqual({
      version: SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
      walletId: expired.walletId,
      incrementalSyncGeneration: 2,
      requiredMutationFenceFloor: REQUIRED_MUTATION_FENCE_FLOOR,
    });

    const redisHash = await getRedisClient()!.hgetall(
      `${WORKER_QUEUE_PREFIX}:${SYNC_QUEUE_NAME}:${trailingJobId}`,
    );
    const serializedObservations = JSON.stringify({
      job: trailingJob!.data,
      redisHash,
      lifecycleObservations,
      logs: logObservation.mock.calls,
    });
    expect(serializedObservations).not.toContain(expired.oldToken);
    expect(serializedObservations).not.toContain(claimedFence!.leaseToken);
  });
});
