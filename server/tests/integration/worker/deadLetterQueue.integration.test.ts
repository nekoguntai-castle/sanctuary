import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import Redis from 'ioredis';
import { afterEach, expect, it } from 'vitest';
import { DeadLetterQueue } from '../../../src/services/deadLetterQueue';
import {
  initializeRedis,
  shutdownRedis,
} from '../../../src/infrastructure';
import { RedisDeadLetterStore } from '../../../src/services/redisDeadLetterStore';
import {
  closeWorkerSyncQueue,
  enqueueDeadLetterJob,
} from '../../../src/services/workerSyncQueue';
import { toBullMqJobId } from '../../../src/jobs/bullMqJobIds';
import { setupWorkerEventHandlers } from '../../../src/worker/workerJobQueue/eventHandlers';
import { describeWithRedis } from '../setup/redis';

const FIXTURE = resolve(
  process.cwd(),
  'tests/fixtures/deadLetterQueueWorker.ts',
);

function spawnWorker(rootKey: string): ChildProcess {
  return fork(FIXTURE, [rootKey], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
}

function waitForMessage(
  child: ChildProcess,
  type: string,
): Promise<Record<string, any>> {
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      5_000,
    );
    const listener = (message: Record<string, any>) => {
      if (message.type !== type) return;
      clearTimeout(timeout);
      child.off('message', listener);
      resolveMessage(message);
    };
    child.on('message', listener);
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveExit) => {
    child.once('exit', () => resolveExit());
    child.send('exit');
  });
}

function exhaustedJob(): Job {
  return {
    id: 'job-1',
    name: 'sync-wallet',
    data: { walletId: 'wallet-1' },
    attemptsMade: 3,
    timestamp: Date.now(),
    opts: { attempts: 3 },
  } as Job;
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error('Timed out waiting for worker outcome');
}

function bullConnection(redisClient: Redis): ConnectionOptions {
  return {
    host: redisClient.options.host,
    port: redisClient.options.port,
    password: redisClient.options.password,
    db: redisClient.options.db,
  };
}

describeWithRedis('dead letter queue Redis integration', () => {
  const children: ChildProcess[] = [];
  const roots: string[] = [];
  let redis: Redis | undefined;

  afterEach(async () => {
    await Promise.all(children.splice(0).map(stopChild));
    if (redis) {
      for (const root of roots.splice(0)) {
        let cursor = '0';
        do {
          const [next, keys] = await redis.scan(
            cursor,
            'MATCH',
            `${root}:*`,
            'COUNT',
            100,
          );
          cursor = next;
          if (keys.length > 0) await redis.del(...keys);
        } while (cursor !== '0');
      }
      await redis.quit();
      redis = undefined;
    }
  });

  function createRoot(): string {
    const root = `sanctuary:dlq:{test-${process.pid}-${Date.now()}-${roots.length}}`;
    roots.push(root);
    return root;
  }

  it('shares worker failures with API readers and survives reader restart', async () => {
    const root = createRoot();
    const writer = spawnWorker(root);
    const reader = spawnWorker(root);
    children.push(writer, reader);
    await Promise.all([
      waitForMessage(writer, 'ready'),
      waitForMessage(reader, 'ready'),
    ]);

    writer.send('add');
    const added = await waitForMessage(writer, 'added');
    reader.send('read');
    const firstRead = await waitForMessage(reader, 'entries');
    expect(firstRead.entries).toEqual([
      expect.objectContaining({
        id: added.id,
        operation: 'sync:sync-wallet',
      }),
    ]);

    await stopChild(reader);
    children.splice(children.indexOf(reader), 1);
    const restarted = spawnWorker(root);
    children.push(restarted);
    await waitForMessage(restarted, 'ready');
    restarted.send('read');
    await expect(waitForMessage(restarted, 'entries')).resolves.toEqual(
      expect.objectContaining({ entries: firstRead.entries }),
    );
  });

  it('serializes claims, recovers expired leases, and tombstones acknowledgements', async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const root = createRoot();
    const first = new DeadLetterQueue(
      () => new RedisDeadLetterStore(redis!, root),
    );
    const second = new DeadLetterQueue(
      () => new RedisDeadLetterStore(redis!, root),
    );
    const id = await first.addExhaustedJob(
      'sync',
      'sync',
      exhaustedJob(),
      'failed',
    );
    const claims = await Promise.all([
      first.claimForRetry(id, 100),
      second.claimForRetry(id, 100),
    ]);
    expect(claims.map(({ status }) => status).sort()).toEqual([
      'busy',
      'claimed',
    ]);

    await new Promise((resolveWait) => setTimeout(resolveWait, 125));
    const recovered = await second.claimForRetry(id, 1_000);
    expect(recovered.status).toBe('claimed');
    if (recovered.status !== 'claimed') throw new Error('claim not recovered');
    await expect(
      second.acknowledgeRetry(id, recovered.claim.token),
    ).resolves.toBe(true);

    await first.addExhaustedJob('sync', 'sync', exhaustedJob(), 'late event');
    await expect(first.get(id)).resolves.toBeNull();
  });

  it('repairs expired index entries and propagates Redis failures', async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const root = createRoot();
    const store = new RedisDeadLetterStore(redis, root);
    const queue = new DeadLetterQueue(() => store);
    await redis.set(
      `${root}:entry:expired`,
      JSON.stringify({
        version: 1,
        id: 'expired',
        category: 'other',
        operation: 'old',
        payload: {},
        error: 'old',
        attempts: 1,
        firstFailedAt: 1,
        lastFailedAt: 1,
      }),
    );
    await redis.zadd(`${root}:index`, 1, 'expired');
    await redis.zadd(`${root}:category:other`, 1, 'expired');

    await expect(store.cleanup()).resolves.toBe(1);
    await expect(queue.getAll()).resolves.toEqual([]);

    const failedRedis = new Redis(process.env.REDIS_URL!);
    await failedRedis.quit();
    const failedQueue = new DeadLetterQueue(
      () => new RedisDeadLetterStore(failedRedis, root),
    );
    await expect(failedQueue.getAll()).rejects.toThrow();
  });

  it('uses BullMQ attempts before recording one exhausted job', async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const root = createRoot();
    const dlq = new DeadLetterQueue(
      () => new RedisDeadLetterStore(redis!, root),
    );
    const queueName = `dlq-attempts-${process.pid}-${Date.now()}`;
    const prefix = `{${queueName}}`;
    const connection = bullConnection(redis);
    const attempts = new Map<string, number>();
    const queue = new Queue(queueName, { connection, prefix });
    const worker = new Worker(
      queueName,
      async (workerJob) => {
        const count = (attempts.get(workerJob.name) ?? 0) + 1;
        attempts.set(workerJob.name, count);
        if (workerJob.name === 'transient' && count === 3) return 'ok';
        throw new Error(`${workerJob.name} failure ${count}`);
      },
      { connection, prefix },
    );
    setupWorkerEventHandlers(
      queueName,
      worker,
      undefined,
      (category, sourceQueue, workerJob, error) =>
        dlq.addExhaustedJob(category, sourceQueue, workerJob, error),
    );

    try {
      const transient = await queue.add(
        'transient',
        {},
        { attempts: 3, backoff: { type: 'fixed', delay: 1 } },
      );
      const exhausted = await queue.add(
        'exhausted',
        {},
        { attempts: 3, backoff: { type: 'fixed', delay: 1 } },
      );
      await waitUntil(async () =>
        (await transient.getState()) === 'completed' &&
        (await exhausted.getState()) === 'failed'
      );
      await waitUntil(async () => (await dlq.getAll()).length === 1);

      expect(attempts.get('transient')).toBe(3);
      expect(attempts.get('exhausted')).toBe(3);
      await expect(dlq.getAll()).resolves.toEqual([
        expect.objectContaining({
          operation: `${queueName}:exhausted`,
          attempts: 3,
        }),
      ]);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it('claims an exhausted sync job, dispatches it to BullMQ, then acknowledges it', async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const root = createRoot();
    const dlq = new DeadLetterQueue(
      () => new RedisDeadLetterStore(redis!, root),
    );
    const originalJob = {
      ...exhaustedJob(),
      id: `retry-source-${process.pid}-${Date.now()}`,
    } as Job;
    const entryId = await dlq.addExhaustedJob(
      'sync',
      'sync',
      originalJob,
      'exhausted',
    );
    const claim = await dlq.claimForRetry(entryId);
    if (claim.status !== 'claimed' || !claim.claim.entry.job) {
      throw new Error('Expected a retriable exhausted job claim');
    }
    const inspector = new Queue('sync', {
      connection: bullConnection(redis),
      prefix: 'sanctuary:worker',
    });
    const retryJobId = toBullMqJobId(`dead-letter-retry:${entryId}`);

    try {
      await initializeRedis();
      await expect(
        enqueueDeadLetterJob(claim.claim.entry.job, entryId),
      ).resolves.toBe(true);
      await expect(inspector.getJob(retryJobId)).resolves.toEqual(
        expect.objectContaining({
          name: 'sync-wallet',
          data: { walletId: 'wallet-1' },
        }),
      );
      await expect(
        dlq.acknowledgeRetry(entryId, claim.claim.token),
      ).resolves.toBe(true);
      await expect(dlq.get(entryId)).resolves.toBeNull();
    } finally {
      await (await inspector.getJob(retryJobId))?.remove();
      await inspector.close();
      await closeWorkerSyncQueue();
      await shutdownRedis();
    }
  });
});
