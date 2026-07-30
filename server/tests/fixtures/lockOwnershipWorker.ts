import { appendFile } from 'node:fs/promises';
import type { Job } from 'bullmq';
import {
  acquireLock,
  extendLock,
  initializeRedis,
  releaseLock,
  shutdownRedis,
} from '../../src/infrastructure';
import { processJobWithLock } from '../../src/worker/workerJobQueue/jobProcessor';

type ParentMessage = 'lose' | 'commit';

const role = process.argv[2];
const lockKey = process.argv[3];
const sideEffectPath = process.argv[4];

function notify(message: object): void {
  process.send?.(message);
}

function waitForParent(expected: ParentMessage): Promise<void> {
  return new Promise((resolve) => {
    const listener = (message: unknown) => {
      if (message !== expected) return;
      process.off('message', listener);
      resolve();
    };
    process.on('message', listener);
  });
}

async function runStaleWorker(): Promise<never> {
  const loseGate = waitForParent('lose');
  await processJobWithLock(
    'maintenance:stale-proof',
    {
      lockOptions: { lockKey: () => lockKey, lockTtlMs: 30 },
      handler: async () => {
        notify({ type: 'handler-started' });
        setTimeout(() => {
          void appendFile(sideEffectPath, 'A\n');
        }, 10_000);
        return new Promise<never>(() => undefined);
      },
    },
    { id: 'stale-worker', data: {} } as Job,
    {
      lockOperations: {
        acquire: acquireLock,
        release: releaseLock,
        extend: async () => {
          notify({ type: 'refresh-started' });
          await loseGate;
          return null;
        },
      },
    },
  );
  throw new Error('stale worker unexpectedly survived lock loss');
}

async function runNewOwner(): Promise<void> {
  const lock = await acquireLock(lockKey, { ttlMs: 30_000, waitTimeMs: 2_000 });
  if (!lock) throw new Error('new owner failed to acquire proof lock');
  notify({ type: 'acquired', token: lock.token });
  await waitForParent('commit');
  await appendFile(sideEffectPath, 'B\n');
  notify({ type: 'committed' });
  await releaseLock(lock);
  await shutdownRedis();
}

async function main(): Promise<void> {
  if (!role || !lockKey || !sideEffectPath) {
    throw new Error('role, lock key, and side-effect path are required');
  }
  await initializeRedis();
  if (role === 'stale') {
    await runStaleWorker();
    return;
  }
  if (role === 'new-owner') {
    await runNewOwner();
    return;
  }
  throw new Error(`unknown fixture role: ${role}`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(2);
});
