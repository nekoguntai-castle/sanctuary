import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Redis from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';

const describeIfRedis = process.env.REDIS_URL ? describe : describe.skip;
const FIXTURE_PATH = resolve(process.cwd(), 'tests/fixtures/lockOwnershipWorker.ts');
const MESSAGE_TIMEOUT_MS = 5_000;

interface WorkerMessage {
  type: string;
  token?: string;
}

function spawnWorker(role: string, lockKey: string, sideEffectPath: string): ChildProcess {
  return fork(FIXTURE_PATH, [role, lockKey, sideEffectPath], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
}

function waitForMessage(child: ChildProcess, expectedType: string): Promise<WorkerMessage> {
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for child message: ${expectedType}`)),
      MESSAGE_TIMEOUT_MS,
    );
    const onMessage = (message: WorkerMessage) => {
      if (message?.type !== expectedType) return;
      clearTimeout(timeout);
      child.off('message', onMessage);
      resolveMessage(message);
    };
    child.on('message', onMessage);
  });
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for child exit')),
      MESSAGE_TIMEOUT_MS,
    );
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
}

describeIfRedis('job processor lock-loss process fencing', () => {
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  it('kills cancellation-ignoring stale work before the new owner commits', async () => {
    const redis = new Redis(process.env.REDIS_URL!);
    const workDir = await mkdtemp(join(tmpdir(), 'sanctuary-lock-proof-'));
    const sideEffectPath = join(workDir, 'effects.log');
    const lockKey = `proof:${process.pid}:${Date.now()}`;

    try {
      const staleWorker = spawnWorker('stale', lockKey, sideEffectPath);
      children.push(staleWorker);
      await waitForMessage(staleWorker, 'handler-started');
      await waitForMessage(staleWorker, 'refresh-started');

      await redis.del(`lock:${lockKey}`);
      const newOwner = spawnWorker('new-owner', lockKey, sideEffectPath);
      children.push(newOwner);
      const acquired = await waitForMessage(newOwner, 'acquired');

      staleWorker.send('lose');
      await expect(waitForExit(staleWorker)).resolves.toEqual({ code: 1, signal: null });
      await expect(redis.get(`lock:${lockKey}`)).resolves.toBe(acquired.token);

      newOwner.send('commit');
      await waitForMessage(newOwner, 'committed');
      await expect(waitForExit(newOwner)).resolves.toEqual({ code: 0, signal: null });
      await expect(readFile(sideEffectPath, 'utf8')).resolves.toBe('B\n');
    } finally {
      await redis.quit();
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
