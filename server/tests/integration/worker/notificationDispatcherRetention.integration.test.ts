import { randomUUID } from 'node:crypto';
import { Job, Queue, QueueEvents, Worker, type ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toBullMqJobId } from '../../../src/jobs/bullMqJobIds';

const describeIfRedis = process.env.REDIS_URL ? describe : describe.skip;
const QUEUE_NAME = 'notifications';
const QUEUE_PREFIX = 'sanctuary:worker';

describeIfRedis('webhook notification retained-job recovery', () => {
  let dispatcherShutdown: (() => Promise<void>) | undefined;
  let queue: Queue | undefined;
  let queueEvents: QueueEvents | undefined;
  let redis: Redis | undefined;
  let worker: Worker | undefined;
  let job: Job | undefined;

  afterEach(async () => {
    await worker?.close();
    await job?.remove().catch(() => undefined);
    await queueEvents?.close();
    await queue?.close();
    await dispatcherShutdown?.();
    await redis?.quit();
    vi.resetModules();
  });

  it.each(['completed', 'failed'] as const)(
    'requeues a webhook attempt that collides with a retained %s job',
    async (terminalState) => {
      redis = new Redis(process.env.REDIS_URL!);
      const connection = toBullConnection(redis);
      vi.doMock('../../../src/infrastructure/redis', () => ({
        getRedisClient: () => redis,
        isRedisConnected: () => true,
      }));
      const dispatcher = await import('../../../src/infrastructure/notificationDispatcher');
      dispatcherShutdown = dispatcher.shutdownNotificationDispatcher;

      queue = new Queue(QUEUE_NAME, { connection, prefix: QUEUE_PREFIX });
      queueEvents = new QueueEvents(QUEUE_NAME, { connection, prefix: QUEUE_PREFIX });
      const deliveryId = `retained-${terminalState}-${randomUUID()}`;
      const payload = { deliveryId, attempt: 1 };
      const jobId = toBullMqJobId(`webhook-delivery:${deliveryId}:1`);
      worker = new Worker(QUEUE_NAME, async (activeJob) => {
        if (activeJob.id !== jobId) return;
        if (terminalState === 'failed') throw new Error('intentional retained failure');
      }, {
        connection,
        prefix: QUEUE_PREFIX,
        concurrency: 1,
      });

      job = await queue.add('webhook-delivery', payload, {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      });
      if (terminalState === 'failed') {
        await expect(job.waitUntilFinished(queueEvents, 5_000)).rejects.toThrow(
          'intentional retained failure',
        );
      } else {
        await expect(job.waitUntilFinished(queueEvents, 5_000)).resolves.toBeNull();
      }
      await worker.close();
      worker = undefined;
      await expect(job.getState()).resolves.toBe(terminalState);

      await expect(
        dispatcher.queueWebhookDeliveryNotification(payload),
      ).resolves.toBe(true);

      job = await queue.getJob(jobId);
      expect(job).toBeDefined();
      await expect(job!.getState()).resolves.toBe('waiting');
      expect(job!.data).toEqual(payload);
      expect(job!.opts.removeOnComplete).toBe(true);
      expect(job!.opts.removeOnFail).toBe(true);
    },
  );
});

function toBullConnection(redis: Redis): ConnectionOptions {
  return {
    host: redis.options.host,
    port: redis.options.port,
    password: redis.options.password,
    db: redis.options.db,
  };
}
