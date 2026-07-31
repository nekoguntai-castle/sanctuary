import Redis from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombinedConfig } from '../../../src/config';
import { RecurringScheduleCoordinator } from '../../../src/worker/recurringSchedules';

const describeIfRedis = process.env.REDIS_URL ? describe : describe.skip;

describeIfRedis('recurring schedule Redis integration', () => {
  let workerQueue: { shutdown: () => Promise<void> } | undefined;
  let bullQueue: {
    name: string;
    add: (...args: any[]) => Promise<unknown>;
    getJobSchedulers: () => Promise<Array<{ key: string; name: string; pattern?: string }>>;
    obliterate: (options: { force: boolean }) => Promise<void>;
    removeJobScheduler: (id: string) => Promise<boolean>;
  } | undefined;
  let allBullQueues: Array<NonNullable<typeof bullQueue>> = [];
  let redis: Redis | undefined;
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
    for (const queue of allBullQueues) {
      await queue.obliterate({ force: true });
    }
    await workerQueue?.shutdown();
    await redis?.quit();
    allBullQueues = [];
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

    await expect(
      queue.scheduleRecurring('maintenance', 'cleanup:test', {}, '*/5 * * * *'),
    ).resolves.toEqual({ status: 'created' });
    let schedulers = await activeBullQueue.getJobSchedulers();
    expect(schedulers.filter(({ name }) => name === 'cleanup:test')).toEqual([
      expect.objectContaining({
        key: 'maintenance:cleanup:test',
        pattern: '*/5 * * * *',
      }),
    ]);

    await activeBullQueue.removeJobScheduler('maintenance:cleanup:test');
    await expect(
      queue.inspectRecurringSchedules([
        {
          schedulerId: 'maintenance:cleanup:test',
          queue: 'maintenance',
          name: 'cleanup:test',
          data: {},
          cron: '*/5 * * * *',
        },
      ]),
    ).resolves.toEqual({
      healthy: false,
      missing: ['maintenance:cleanup:test'],
      mismatched: [],
      unexpected: [],
      inspectionFailures: [],
    });

    await queue.scheduleRecurring('maintenance', 'cleanup:test', {}, '*/5 * * * *');
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
