import { randomUUID } from 'node:crypto';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { toBullMqJobId } from '../../../src/jobs/bullMqJobIds';
import { getRedisClient, initializeRedis, shutdownRedis } from '../../../src/infrastructure';
import {
  SYNC_QUEUE_NAME,
  type SyncWalletJobData,
} from '../../../src/jobs/syncJobContract';
import prisma from '../../../src/models/prisma';
import { syncIntentRepository } from '../../../src/repositories/syncIntentRepository';
import { findStrandedFullResyncWalletsPage } from '../../../src/repositories/resyncRepository';
import {
  createSyncIntentAdmission,
  incrementalSyncWakeupJobId,
} from '../../../src/services/sync/syncIntentAdmission';
import {
  closeWorkerSyncQueue,
  enqueueIncrementalSyncWakeup,
  enqueueReservedFullResyncWakeup,
} from '../../../src/services/workerSyncQueue';
import { createTestUser, createTestWallet } from '../repositories/setup';
import { describeWithRedis } from '../setup/redis';

const WORKER_QUEUE_PREFIX = 'sanctuary:worker';
const ACTIVE_ACTIVATION = {
  status: 'active' as const,
  requiredFloor: 1 as const,
  activatedAt: '2026-08-23T00:00:00.000Z',
};
const DORMANT_ACTIVATION = {
  status: 'dormant' as const,
  requiredFloor: 1 as const,
};

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

async function waitForJobState(
  queue: Queue<SyncWalletJobData>,
  jobId: string,
  expected: 'completed',
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let state = await (await queue.getJob(jobId))?.getState();
  while (state !== expected && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
    state = await (await queue.getJob(jobId))?.getState();
  }
  if (state !== expected) throw new Error(`Expected ${jobId} to reach ${expected}; got ${state}`);
}

describeWithRedis('canonical producer durable admission', () => {
  const factoryClient = prisma as unknown as PrismaClient;
  const walletIds: string[] = [];
  const userIds: string[] = [];
  const trackedJobIds = new Set<string>();
  const workers: Worker<SyncWalletJobData>[] = [];
  let queue: Queue<SyncWalletJobData>;

  const activeAdmission = () => createSyncIntentAdmission({
    enqueueWakeup: enqueueIncrementalSyncWakeup,
    enqueueFullResyncWakeup: enqueueReservedFullResyncWakeup,
    inspectActivation: async () => ACTIVE_ACTIVATION,
    isExecutionLockHeld: async () => false,
    publishTransition: async () => undefined,
  });

  beforeAll(async () => {
    await prisma.$connect();
    await initializeRedis();
    queue = new Queue<SyncWalletJobData>(SYNC_QUEUE_NAME, {
      connection: bullConnection(),
      prefix: WORKER_QUEUE_PREFIX,
    });
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map(worker => worker.close(true)));
    for (const jobId of trackedJobIds) {
      await (await queue.getJob(jobId))?.remove().catch(() => undefined);
    }
    trackedJobIds.clear();
    if (walletIds.length > 0) {
      await prisma.wallet.deleteMany({ where: { id: { in: walletIds.splice(0) } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    await queue?.close();
    await closeWorkerSyncQueue();
    await shutdownRedis();
    await prisma.$disconnect();
  });

  async function createWallet(): Promise<string> {
    const identity = randomUUID();
    const user = await createTestUser(factoryClient, {
      username: `canonical-producer-${identity}`,
      email: `canonical-producer-${identity}@example.com`,
    });
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id);
    walletIds.push(wallet.id);
    return wallet.id;
  }

  function track(walletId: string, generation: number): string {
    const jobId = incrementalSyncWakeupJobId(walletId, generation);
    trackedJobIds.add(jobId);
    return jobId;
  }

  function trackFullResync(walletId: string, generation: number): string {
    const jobId = toBullMqJobId(`full-resync-attempt:${walletId}:${generation}`);
    trackedJobIds.add(jobId);
    return jobId;
  }

  it('coalesces concurrent API and activity requests before pickup into one generation and stable job', async () => {
    const walletId = await createWallet();
    const jobId = track(walletId, 1);
    const admission = activeAdmission();

    const outcomes = await Promise.all(Array.from({ length: 12 }, (_, index) => (
      admission.request(walletId, {
        mode: index % 2 === 0 ? 'explicit_reopen' : 'automatic',
      })
    )));

    expect(outcomes.filter(outcome => outcome.status === 'requested')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'merged')).toHaveLength(11);
    expect(outcomes.every(outcome => (
      'generation' in outcome
      && outcome.generation === 1
      && outcome.wakeup === 'enqueued'
    ))).toBe(true);
    const job = await queue.getJob(jobId);
    expect(job).not.toBeNull();
    expect(job?.data).toMatchObject({
      walletId,
      incrementalSyncGeneration: 1,
    });
    const walletJobs = (await queue.getJobs(['waiting', 'prioritized']))
      .filter(candidate => candidate.data.walletId === walletId);
    expect(walletJobs).toHaveLength(1);
    expect(walletJobs[0]?.id).toBe(jobId);
  });

  it('coalesces requests during an active claim into exactly one trailing generation', async () => {
    const walletId = await createWallet();
    const firstJobId = track(walletId, 1);
    const trailingJobId = track(walletId, 2);
    const admission = activeAdmission();
    await admission.request(walletId, { mode: 'explicit_reopen' });

    const claimed = deferred<Awaited<ReturnType<typeof admission.claimFresh>>>();
    const release = deferred<void>();
    const worker = new Worker<SyncWalletJobData>(
      SYNC_QUEUE_NAME,
      async job => {
        if (job.id !== firstJobId) return;
        if (job.data.incrementalSyncGeneration === undefined) {
          throw new Error('Canonical producer emitted a generationless wake-up');
        }
        const result = await admission.claimFresh(walletId, {
          leaseToken: randomUUID(),
          claimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
          expectedRequestedGeneration: job.data.incrementalSyncGeneration,
        });
        claimed.resolve(result);
        await release.promise;
      },
      { connection: bullConnection(), prefix: WORKER_QUEUE_PREFIX, concurrency: 1 },
    );
    workers.push(worker);
    await worker.waitUntilReady();

    const claim = await claimed.promise;
    expect(claim).toMatchObject({ status: 'claimed', claim: { generation: 1 } });
    expect(await (await queue.getJob(firstJobId))?.getState()).toBe('active');

    const outcomes = await Promise.all(Array.from({ length: 10 }, (_, index) => (
      admission.request(walletId, {
        mode: index === 0 ? 'explicit_reopen' : 'automatic',
      })
    )));

    expect(outcomes.filter(outcome => outcome.status === 'requested')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'merged')).toHaveLength(9);
    expect(outcomes.every(outcome => 'generation' in outcome && outcome.generation === 2)).toBe(true);
    expect(await queue.getJob(trailingJobId)).toMatchObject({
      id: trailingJobId,
      data: expect.objectContaining({ incrementalSyncGeneration: 2 }),
    });
    const trailingJobs = (await queue.getJobs(['waiting', 'prioritized']))
      .filter(candidate => (
        candidate.data.walletId === walletId
        && candidate.data.incrementalSyncGeneration === 2
      ));
    expect(trailingJobs).toHaveLength(1);
    const state = await syncIntentRepository.findIncrementalSyncIntent(walletId);
    expect(state).toMatchObject({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
    });

    release.resolve();
    await waitForJobState(queue, firstJobId, 'completed');
  });

  it('retains durable intent across Redis wake failure and makes it recoverable', async () => {
    const walletId = await createWallet();
    const jobId = track(walletId, 1);
    await closeWorkerSyncQueue();
    await shutdownRedis();
    let unavailableOutcome;
    try {
      unavailableOutcome = await activeAdmission().request(walletId, { mode: 'explicit_reopen' });
    } finally {
      await initializeRedis();
    }

    expect(unavailableOutcome).toEqual({
      status: 'requested',
      generation: 1,
      wakeup: 'unavailable',
    });
    expect(await queue.getJob(jobId)).toBeUndefined();
    expect(await syncIntentRepository.findIncrementalSyncIntent(walletId)).toMatchObject({
      requestedIncrementalSyncGeneration: 1,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
    });

    const recovered = await activeAdmission().recover({ now: new Date(), limit: 10 });

    expect(recovered).toMatchObject({ scanned: 1, enqueued: 1, unavailable: 0 });
    expect(await queue.getJob(jobId)).toMatchObject({
      id: jobId,
      data: expect.objectContaining({
        walletId,
        incrementalSyncGeneration: 1,
      }),
    });
  });

  it('persists retained pre-fence work while dormant and emits only a v3 wake after activation', async () => {
    const walletId = await createWallet();
    const jobId = track(walletId, 1);
    const dormantAdmission = createSyncIntentAdmission({
      enqueueWakeup: enqueueIncrementalSyncWakeup,
      enqueueFullResyncWakeup: enqueueReservedFullResyncWakeup,
      inspectActivation: async () => DORMANT_ACTIVATION,
      isExecutionLockHeld: async () => false,
      publishTransition: async () => undefined,
    });

    await expect(dormantAdmission.bridgeRetained(walletId, {
      fullResync: false,
      reason: 'retained-v1',
    })).resolves.toEqual({
      status: 'requested',
      generation: 1,
      wakeup: 'deferred_activation',
    });
    expect(await queue.getJob(jobId)).toBeUndefined();
    expect(await syncIntentRepository.findIncrementalSyncIntent(walletId)).toMatchObject({
      requestedIncrementalSyncGeneration: 1,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
    });

    await expect(activeAdmission().recover({ now: new Date(), limit: 10 }))
      .resolves.toMatchObject({ scanned: 1, enqueued: 1, unavailable: 0 });
    expect(await queue.getJob(jobId)).toMatchObject({
      id: jobId,
      data: expect.objectContaining({
        version: 3,
        walletId,
        incrementalSyncGeneration: 1,
      }),
    });
  });

  it('replaces a neutrally completed full-resync wakeup while durable proof is pending', async () => {
    const walletId = await createWallet();
    const admission = activeAdmission();
    const requested = await admission.requestFullResync(walletId, { reason: 'manual' });
    expect(requested).toMatchObject({
      status: 'requested', generation: 1, incrementalGeneration: 1, wakeup: 'enqueued',
    });
    if (!('generation' in requested)) throw new Error('Expected a durable full-resync request');
    const jobId = trackFullResync(walletId, requested.generation);
    const worker = new Worker<SyncWalletJobData>(
      SYNC_QUEUE_NAME,
      async () => undefined,
      { connection: bullConnection(), prefix: WORKER_QUEUE_PREFIX, concurrency: 1 },
    );
    workers.push(worker);
    await worker.waitUntilReady();
    await waitForJobState(queue, jobId, 'completed');
    await worker.close();
    workers.splice(workers.indexOf(worker), 1);

    expect(await syncIntentRepository.findIncrementalSyncIntent(walletId)).toMatchObject({
      requestedFullResyncGeneration: requested.generation,
      processedFullResyncGeneration: 0,
    });
    await expect(enqueueReservedFullResyncWakeup({
      walletId,
      generation: requested.generation,
      incrementalGeneration: requested.incrementalGeneration,
      reason: 'recovery',
    })).resolves.toBe(true);
    const replacement = await queue.getJob(jobId);
    expect(replacement).toMatchObject({
      id: jobId,
      data: expect.objectContaining({
        walletId,
        fullResyncGeneration: requested.generation,
        incrementalSyncGeneration: requested.incrementalGeneration,
      }),
    });
    expect(['prioritized', 'waiting']).toContain(await replacement?.getState());
  });

  it('keeps terminal full resyncs out of recovery until exact operator reopen', async () => {
    const walletId = await createWallet();
    const admission = activeAdmission();
    const requested = await admission.requestFullResync(walletId, { reason: 'manual' });
    expect(requested).toMatchObject({
      status: 'requested', generation: 1, incrementalGeneration: 1, wakeup: 'enqueued',
    });
    if (!('generation' in requested)) throw new Error('Expected a durable full-resync request');
    const jobId = trackFullResync(walletId, requested.generation);
    const leaseToken = randomUUID();
    await expect(admission.claimFresh(walletId, {
      leaseToken,
      claimedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      expectedRequestedGeneration: requested.incrementalGeneration,
      fullResyncGeneration: requested.generation,
    })).resolves.toMatchObject({ status: 'claimed' });
    await expect(admission.releaseAsActionRequired(
      walletId,
      { generation: requested.incrementalGeneration, leaseToken },
      {
        actionRequiredAt: new Date(),
        errorMessage: 'operator repair required',
        failureClass: 'other',
      },
    )).resolves.toMatchObject({ status: 'applied' });

    await expect(findStrandedFullResyncWalletsPage()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: walletId })]),
    );
    await expect(admission.requestFullResync(walletId, { reason: 'manual-retry' }))
      .resolves.toEqual({
        status: 'merged',
        generation: requested.generation,
        incrementalGeneration: requested.incrementalGeneration,
        wakeup: 'enqueued',
      });
    expect(await queue.getJob(jobId)).toMatchObject({ id: jobId });
  });
});
