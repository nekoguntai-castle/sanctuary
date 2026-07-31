import Redis from 'ioredis';
import { RecurringHeartbeatStore } from '../../src/worker/workerJobQueue/recurringHeartbeatStore';
import type { RecurringScheduleDefinition } from '../../src/worker/workerJobQueue';

const prefix = process.argv[2];
const redisUrl = process.env.REDIS_URL;

const definition: RecurringScheduleDefinition = {
  schedulerId: 'sync:check-stale-wallets',
  queue: 'sync',
  name: 'check-stale-wallets',
  data: {},
  recurrence: { every: 90_000 },
  freshness: { maxAgeMs: 180_000, startupGraceMs: 120_000 },
};

function notify(message: object): void {
  process.send?.(message);
}

async function main(): Promise<void> {
  if (!prefix || !redisUrl) {
    throw new Error('queue prefix and REDIS_URL are required');
  }
  const redis = new Redis(redisUrl);
  const store = new RecurringHeartbeatStore(redis, prefix);
  const generationToken = await store.ensureGeneration(definition);
  notify({ type: 'ready' });

  process.on('message', (message: unknown) => {
    if (message === 'complete') {
      void store
        .recordCompletion(
          definition.schedulerId,
          { every: 90_000 },
          generationToken,
          definition.freshness,
        )
        .then(() => notify({ type: 'completed' }))
        .catch((error) => notify({ type: 'error', error: String(error) }));
      return;
    }
    if (message === 'read') {
      void store
        .read([definition])
        .then((snapshot) => notify({ type: 'snapshot', snapshot }))
        .catch((error) => notify({ type: 'error', error: String(error) }));
      return;
    }
    if (message === 'exit') {
      void redis.quit().finally(() => process.exit(0));
    }
  });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(2);
});
