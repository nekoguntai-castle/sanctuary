import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import Redis from 'ioredis';
import { afterEach, expect, it, vi } from 'vitest';
import type { CombinedConfig } from '../../../src/config';
import { RecurringScheduleCoordinator } from '../../../src/worker/recurringSchedules';
import { describeWithRedis } from '../setup/redis';

const HEARTBEAT_FIXTURE = resolve(
  process.cwd(),
  'tests/fixtures/recurringHeartbeatWorker.ts',
);

function spawnHeartbeatWorker(prefix: string): ChildProcess {
  return fork(HEARTBEAT_FIXTURE, [prefix], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
}

function waitForMessage(
  child: ChildProcess,
  expectedType: string,
): Promise<any> {
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${expectedType}`)),
      5_000,
    );
    const listener = (message: any) => {
      if (message?.type !== expectedType) return;
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

describeWithRedis('recurring schedule Redis integration', () => {
  let workerQueue: { shutdown: () => Promise<void> } | undefined;
  let bullQueue: {
    name: string;
    add: (...args: any[]) => Promise<unknown>;
    getJobSchedulers: () => Promise<Array<{
      key: string;
      name: string;
      pattern?: string;
      every?: number;
      tz?: string;
    }>>;
    obliterate: (options: { force: boolean }) => Promise<void>;
    removeJobScheduler: (id: string) => Promise<boolean>;
  } | undefined;
  let allBullQueues: Array<NonNullable<typeof bullQueue>> = [];
  let redis: Redis | undefined;
  const children: ChildProcess[] = [];
  const config = {
    sync: {
      intervalMs: 5 * 60_000,
      confirmationUpdateIntervalMs: 2 * 60_000,
    },
    maintenance: {
      auditLogRetentionDays: 30,
      priceDataRetentionDays: 14,
      feeEstimateRetentionDays: 7,
    },
  } as CombinedConfig;

  afterEach(async () => {
    await Promise.all(children.splice(0).map(stopChild));
    for (const queue of allBullQueues) {
      await queue.obliterate({ force: true });
    }
    await workerQueue?.shutdown();
    await redis?.quit();
    allBullQueues = [];
  });

  it('shares completion freshness across processes and preserves it on restart', async () => {
    const prefix = `sanctuary:test:heartbeat:${process.pid}:${Date.now()}`;
    redis = new Redis(process.env.REDIS_URL!);
    const generationKey =
      `${prefix}:recurring-generation:v1:sync%3Acheck-stale-wallets`;
    const completionKey =
      `${prefix}:recurring-heartbeat:v1:sync%3Acheck-stale-wallets`;
    await redis.set(
      generationKey,
      JSON.stringify({
        version: 1,
        schedulerId: 'sync:check-stale-wallets',
        recurrenceFingerprint: 'every:90000',
        generationToken: 'malformed-generation',
        activatedAt: 1.5,
      }),
    );
    await redis.set(completionKey, 'orphaned-completion');
    const first = spawnHeartbeatWorker(prefix);
    const second = spawnHeartbeatWorker(prefix);
    children.push(first, second);
    await Promise.all([
      waitForMessage(first, 'ready'),
      waitForMessage(second, 'ready'),
    ]);

    first.send('complete');
    await waitForMessage(first, 'completed');
    first.send('read');
    second.send('read');
    const [firstRead, secondRead] = await Promise.all([
      waitForMessage(first, 'snapshot'),
      waitForMessage(second, 'snapshot'),
    ]);
    expect(firstRead.snapshot).toEqual(secondRead.snapshot);
    expect(
      firstRead.snapshot.records['sync:check-stale-wallets'].lastCompletedAt,
    ).toEqual(expect.any(Number));
    expect(
      firstRead.snapshot.records['sync:check-stale-wallets'].activatedAt,
    ).toEqual(expect.any(Number));
    expect(
      Number.isInteger(
        firstRead.snapshot.records['sync:check-stale-wallets'].activatedAt,
      ),
    ).toBe(true);

    await stopChild(second);
    children.splice(children.indexOf(second), 1);
    const restarted = spawnHeartbeatWorker(prefix);
    children.push(restarted);
    await waitForMessage(restarted, 'ready');
    restarted.send('read');
    const restartedRead = await waitForMessage(restarted, 'snapshot');
    expect(restartedRead.snapshot).toEqual(firstRead.snapshot);

    await redis.del(completionKey);
    await stopChild(restarted);
    children.splice(children.indexOf(restarted), 1);
    const afterExpiry = spawnHeartbeatWorker(prefix);
    children.push(afterExpiry);
    await waitForMessage(afterExpiry, 'ready');
    afterExpiry.send('read');
    const expiredRead = await waitForMessage(afterExpiry, 'snapshot');
    const expiredRecord =
      expiredRead.snapshot.records['sync:check-stale-wallets'];
    expect(expiredRecord.activatedAt).toBe(
      firstRead.snapshot.records['sync:check-stale-wallets'].activatedAt,
    );
    expect(expiredRecord.lastCompletedAt).toBeUndefined();

    await redis.del(generationKey, completionKey);
  });

  it('replaces stale definitions without a gap and restores an externally deleted schedule', async () => {
    redis = new Redis(process.env.REDIS_URL!);
    vi.doMock('../../../src/infrastructure', () => ({
      getRedisClient: () => redis,
      isRedisConnected: () => true,
    }));
    const { WorkerJobQueue } = await import('../../../src/worker/workerJobQueue');
    const prefix = `sanctuary:test:recurring:${process.pid}:${Date.now()}`;
    const queue = new WorkerJobQueue({
      concurrency: 1,
      queues: ['maintenance'],
      prefix,
    });
    workerQueue = queue;
    await queue.initialize();
    bullQueue = (queue as any).queues.get('maintenance').queue;
    allBullQueues = [bullQueue!];
    const activeBullQueue = bullQueue!;

    await activeBullQueue.add('cleanup:test', {}, {
      jobId: 'legacy-cleanup-test',
      repeat: { pattern: '*/10 * * * *' },
    });

    const definition = {
      schedulerId: 'maintenance:cleanup:test',
      queue: 'maintenance',
      name: 'cleanup:test',
      data: {},
      recurrence: { every: 90_000 },
    } as const;
    await expect(queue.scheduleRecurring(definition)).resolves.toEqual({
      status: 'created',
    });
    let schedulers = await activeBullQueue.getJobSchedulers();
    const cleanupSchedulers = schedulers.filter(
      ({ name }) => name === 'cleanup:test',
    );
    expect(cleanupSchedulers).toEqual([
      expect.objectContaining({
        key: 'maintenance:cleanup:test',
        every: 90_000,
      }),
    ]);
    expect(cleanupSchedulers[0]?.pattern).toBeUndefined();

    await activeBullQueue.removeJobScheduler('maintenance:cleanup:test');
    await expect(
      queue.inspectRecurringSchedules([
        {
          schedulerId: 'maintenance:cleanup:test',
          queue: 'maintenance',
          name: 'cleanup:test',
          data: {},
          recurrence: { every: 90_000 },
        },
      ]),
    ).resolves.toEqual({
      healthy: false,
      missing: ['maintenance:cleanup:test'],
      mismatched: [],
      unexpected: [],
      inspectionFailures: [],
    });

    await queue.scheduleRecurring(definition);
    schedulers = await activeBullQueue.getJobSchedulers();
    expect(schedulers).toEqual([
      expect.objectContaining({ key: 'maintenance:cleanup:test' }),
    ]);
  });

  it('serializes feature changes and stays unhealthy until a failed removal is recovered', async () => {
    redis = new Redis(process.env.REDIS_URL!);
    vi.doMock('../../../src/infrastructure', () => ({
      getRedisClient: () => redis,
      isRedisConnected: () => true,
    }));
    const { WorkerJobQueue } = await import('../../../src/worker/workerJobQueue');
    const queue = new WorkerJobQueue({
      concurrency: 1,
      queues: ['sync', 'notifications', 'confirmations', 'maintenance'],
      prefix: `sanctuary:test:conditional:${process.pid}:${Date.now()}`,
    });
    workerQueue = queue;
    await queue.initialize();
    const queueInstances = Array.from(
      (queue as any).queues.values(),
    ) as Array<{ queue: typeof bullQueue }>;
    const activeQueues = queueInstances.map(({ queue: instance }) => instance!);
    allBullQueues = activeQueues;
    bullQueue = activeQueues.find((instance) => instance.name === 'maintenance');
    const maintenanceQueue = bullQueue!;

    let autopilotEnabled = true;
    let firstRead!: () => void;
    const firstReadStarted = new Promise<void>((resolve) => {
      firstRead = resolve;
    });
    let readCount = 0;
    const coordinator = new RecurringScheduleCoordinator(
      queue,
      config,
      async () => {
        readCount += 1;
        if (readCount === 1) firstRead();
        return {
          autopilotEnabled,
          intelligenceEnabled: false,
        };
      },
    );

    const enabling = coordinator.reconcile();
    await firstReadStarted;
    autopilotEnabled = false;
    const disabling = coordinator.reconcile();
    await Promise.all([enabling, disabling]);
    expect(
      (await maintenanceQueue.getJobSchedulers()).some(({ name }) =>
        name.startsWith('autopilot:'),
      ),
    ).toBe(false);

    autopilotEnabled = true;
    await coordinator.reconcile();
    autopilotEnabled = false;
    const originalRemove = maintenanceQueue.removeJobScheduler.bind(
      maintenanceQueue,
    );
    maintenanceQueue.removeJobScheduler = vi.fn(async (id: string) => {
      if (id === 'maintenance:autopilot:record-fees') {
        throw new Error('forced removal failure');
      }
      return originalRemove(id);
    });

    await expect(coordinator.reconcile()).resolves.toEqual(
      expect.objectContaining({ healthy: false }),
    );
    expect(coordinator.getState().reconciliationHealthy).toBe(false);
    await expect(
      queue.inspectRecurringSchedules(
        coordinator.getState().desired,
        coordinator.getState().forbidden,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: false,
        unexpected: ['maintenance:autopilot:record-fees'],
      }),
    );

    maintenanceQueue.removeJobScheduler = originalRemove;
    await expect(coordinator.reconcile()).resolves.toEqual(
      expect.objectContaining({ healthy: true }),
    );
  });
});
