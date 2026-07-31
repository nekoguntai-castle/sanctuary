import Redis from 'ioredis';
import type { Job } from 'bullmq';
import { DeadLetterQueue } from '../../src/services/deadLetterQueue';
import { RedisDeadLetterStore } from '../../src/services/redisDeadLetterStore';

const rootKey = process.argv[2];
const redisUrl = process.env.REDIS_URL;

function notify(message: object): void {
  process.send?.(message);
}

async function main(): Promise<void> {
  if (!rootKey || !redisUrl) {
    throw new Error('DLQ root key and REDIS_URL are required');
  }
  const redis = new Redis(redisUrl);
  const queue = new DeadLetterQueue(
    () => new RedisDeadLetterStore(redis, rootKey),
  );
  process.on('message', (message: unknown) => {
    if (message === 'add') {
      const job = {
        id: 'worker-job-1',
        name: 'sync-wallet',
        data: { walletId: 'wallet-1' },
        attemptsMade: 3,
        timestamp: Date.now(),
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      } as Job;
      void queue
        .addExhaustedJob('sync', 'sync', job, new Error('worker failed'))
        .then((id) => notify({ type: 'added', id }))
        .catch((error) => notify({ type: 'error', error: String(error) }));
      return;
    }
    if (message === 'read') {
      void queue
        .getAll()
        .then((entries) => notify({ type: 'entries', entries }))
        .catch((error) => notify({ type: 'error', error: String(error) }));
      return;
    }
    if (message === 'exit') {
      void redis.quit().finally(() => process.exit(0));
    }
  });
  notify({ type: 'ready' });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(2);
});
