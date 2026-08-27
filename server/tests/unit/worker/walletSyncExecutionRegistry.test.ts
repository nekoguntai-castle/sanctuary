import { describe, expect, it, vi } from 'vitest';
import type { SyncProgressStage } from '@sanctuary/shared/schemas/syncProgress';

const redisState = vi.hoisted(() => ({
  connected: false,
  get: vi.fn(),
}));

vi.mock('../../../src/infrastructure/redis', () => ({
  isRedisConnected: () => redisState.connected,
  getRedisClient: () => ({ get: redisState.get }),
}));

import { WalletSyncExecutionDiagnosticsSchema } from '../../../src/internal/workerDiagnostics/protocol';
import {
  collectWalletSyncExecutionDiagnostics,
  WalletSyncExecutionRegistry,
} from '../../../src/worker/walletSyncExecutionRegistry';

const NOW = 1_800_000_000_000;

function startInput(executionId: string, stage: SyncProgressStage = 'candidate_fetch') {
  return {
    executionId,
    stage,
    ownedLock: { key: `sync:wallet:${executionId}`, token: 'a'.repeat(32) },
    atMs: NOW,
  };
}

describe('wallet sync execution registry', () => {
  it('applies fixed transitions once and exposes resettable process-local counters', async () => {
    const registry = new WalletSyncExecutionRegistry(NOW - 60 * 60_000, 30 * 60_000, 10, () => NOW);

    expect(registry.start(startInput('one'))).toBe(true);
    expect(registry.start(startInput('one'))).toBe(false);
    expect(registry.transition('missing', 'parent_fetch')).toBe(false);
    expect(registry.transition('one', 'candidate_fetch')).toBe(true);
    expect(registry.transition('one', 'parent_fetch')).toBe(true);
    expect(registry.recordBudgetExpiry('one')).toBe(true);
    expect(registry.recordLockLoss('one')).toBe(true);
    expect(registry.recordLockLoss('one')).toBe(false);
    expect(registry.finish('one', 'completed')).toBe(true);
    expect(registry.finish('one', 'failed')).toBe(false);
    expect(registry.recordBudgetExpiry('one')).toBe(false);
    expect(registry.recordLockLoss('one')).toBe(false);

    const beforeReset = await registry.diagnostics({ get: vi.fn() }, NOW);
    expect(beforeReset).toMatchObject({
      version: 1,
      observation: 'observed',
      scope: 'sampled_worker',
      processEpochAge: '1h-24h',
      countersResetAge: '1h-24h',
      active: { total: '0', oldestProgressAge: 'never' },
      counters: {
        started: '1',
        stageTransitions: '1',
        completed: '1',
        failed: '0',
        budgetExpired: '1',
        lockLost: '1',
      },
    });

    registry.resetCounters(NOW);
    const afterReset = await registry.diagnostics({ get: vi.fn() }, NOW);
    expect(afterReset.observation === 'observed' && afterReset.counters).toEqual({
      started: '0',
      stageTransitions: '0',
      completed: '0',
      failed: '0',
      timedOut: '0',
      aborted: '0',
      budgetExpired: '0',
      lockLost: '0',
      stalePruned: '0',
    });
    expect(afterReset.observation === 'observed' && afterReset.countersResetAge).toBe('<1m');
  });

  it('rejects poison inputs, stays bounded, and prunes at the attempt horizon', async () => {
    let now = NOW;
    const registry = new WalletSyncExecutionRegistry(NOW, 1_000, 2, () => now);
    expect(registry.start({ ...startInput(''), executionId: '' })).toBe(false);
    expect(registry.start({ ...startInput('bad-stage'), stage: 'poison' as never })).toBe(false);
    expect(registry.start({ ...startInput('bad-key'), ownedLock: { key: '', token: 'token' } })).toBe(false);
    expect(registry.start({
      ...startInput('poison-key'),
      ownedLock: { key: 'sync:wallet:bad\nkey', token: 'a'.repeat(32) },
    })).toBe(false);
    expect(registry.start({
      ...startInput('poison-token'),
      ownedLock: { key: 'sync:wallet:safe', token: `${'a'.repeat(31)}\n` },
    })).toBe(false);
    expect(registry.start({
      ...startInput('long-id'),
      executionId: 'a'.repeat(129),
    })).toBe(false);
    expect(registry.start(startInput('one'))).toBe(true);
    expect(registry.start(startInput('two', 'classification'))).toBe(true);
    expect(registry.start(startInput('capacity'))).toBe(false);

    now += 999;
    expect(registry.prune()).toBe(0);
    now++;
    expect(registry.prune()).toBe(2);
    const snapshot = await registry.diagnostics({ get: vi.fn() });
    expect(snapshot).toMatchObject({
      active: { total: '0' },
      counters: { started: '2-5', stalePruned: '2-5' },
    });
    expect(WalletSyncExecutionDiagnosticsSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('normalizes invalid timestamps and default clocks without exporting invalid ages', async () => {
    const registry = new WalletSyncExecutionRegistry(Number.NaN, 2 * 60 * 60_000, 3, () => NOW);
    expect(registry.start({ ...startInput('default-clock'), atMs: undefined })).toBe(true);
    expect(registry.start({ ...startInput('invalid-clock'), atMs: Number.NaN })).toBe(true);
    expect(registry.transition('invalid-clock', 'classification', -1)).toBe(true);
    expect(registry.transition('default-clock', 'persistence', NOW - 60 * 60_000)).toBe(true);

    const snapshot = await registry.diagnostics({ get: vi.fn() }, NOW + 60_000);

    expect(snapshot).toMatchObject({
      processEpochAge: '<1m',
      active: { total: '2-5', oldestProgressAge: '1m-15m' },
    });
    expect(WalletSyncExecutionDiagnosticsSchema.safeParse(snapshot).success).toBe(true);
  });

  it('samples only retained locks and reports matching, missing, and mismatched values', async () => {
    const registry = new WalletSyncExecutionRegistry(NOW, 10_000, 10, () => NOW);
    registry.start(startInput('matching'));
    registry.start(startInput('missing', 'timestamp_fetch'));
    registry.start(startInput('mismatch', 'persistence'));
    const get = vi.fn(async (key: string) => {
      if (key === 'lock:sync:wallet:matching') return 'a'.repeat(32);
      if (key === 'lock:sync:wallet:missing') return null;
      return 'poison\nredis\0value';
    });

    const snapshot = await registry.diagnostics({ get });

    expect(get.mock.calls.map(([key]) => key)).toEqual([
      'lock:sync:wallet:matching',
      'lock:sync:wallet:missing',
      'lock:sync:wallet:mismatch',
    ]);
    expect(snapshot).toMatchObject({
      active: {
        total: '2-5',
        byStage: {
          candidate_fetch: '1',
          timestamp_fetch: '1',
          persistence: '1',
        },
      },
      redisLockAgreement: {
        agreement: 'observed',
        registryWithOwnedLock: '1',
        registryMissingOwnedLock: '1',
        registryTokenMismatch: '1',
      },
      counters: { lockLost: '2-5' },
    });
    const repeated = await registry.diagnostics({ get });
    expect(repeated).toMatchObject({ counters: { lockLost: '2-5' } });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /sync:wallet|poison\\n|redis\\u0000|executionId/i,
    );
  });

  it('fails Redis agreement closed without scanning or exporting partial facts', async () => {
    const registry = new WalletSyncExecutionRegistry(NOW, 10_000, 10, () => NOW);
    registry.start(startInput('one'));
    registry.start(startInput('two'));
    const get = vi.fn()
      .mockResolvedValueOnce('a'.repeat(32))
      .mockRejectedValueOnce(new Error('redis unavailable'));

    const unavailable = await registry.diagnostics({ get });
    const disconnected = await registry.diagnostics(null);

    expect(unavailable.observation === 'observed' && unavailable.redisLockAgreement)
      .toEqual({ agreement: 'unavailable' });
    expect(disconnected.observation === 'observed' && disconnected.redisLockAgreement)
      .toEqual({ agreement: 'unavailable' });
    expect(get).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(unavailable)).not.toContain('a'.repeat(32));
  });

  it('bounds Redis agreement latency and concurrent reads when Redis never settles', async () => {
    const registry = new WalletSyncExecutionRegistry(NOW, 10_000, 50, () => NOW, 5);
    for (let index = 0; index < 20; index++) {
      registry.start(startInput(`stuck-${index}`));
    }
    const get = vi.fn(() => new Promise<string | null>(() => undefined));

    const snapshot = await registry.diagnostics({ get });

    expect(snapshot.observation === 'observed' && snapshot.redisLockAgreement)
      .toEqual({ agreement: 'unavailable' });
    expect(get).toHaveBeenCalledTimes(8);
  });

  it('collects from only the connected process Redis client', async () => {
    redisState.connected = false;
    const disconnected = await collectWalletSyncExecutionDiagnostics();
    redisState.connected = true;
    const connected = await collectWalletSyncExecutionDiagnostics();
    redisState.connected = false;

    expect(disconnected.observation === 'observed' && disconnected.redisLockAgreement)
      .toEqual({ agreement: 'unavailable' });
    expect(connected.observation === 'observed' && connected.redisLockAgreement)
      .toMatchObject({ agreement: 'observed' });
    expect(redisState.get).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed', 'timedOut', 'aborted'] as const)(
    'counts the %s terminal outcome once',
    async (outcome) => {
      const registry = new WalletSyncExecutionRegistry(NOW, 10_000, 10, () => NOW);
      registry.start(startInput(outcome));
      expect(registry.finish(outcome, outcome)).toBe(true);
      expect(registry.finish(outcome, outcome)).toBe(false);
      const snapshot = await registry.diagnostics({ get: vi.fn() });
      expect(snapshot.observation === 'observed' && snapshot.counters[outcome]).toBe('1');
    },
  );
});
