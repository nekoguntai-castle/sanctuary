import { describe, expect, it } from 'vitest';
import {
  signDiagnosticsRequest,
  verifyDiagnosticsRequest,
} from '../../../src/internal/workerDiagnostics/auth';
import { WorkerDiagnosticsResponseSchema } from '../../../src/internal/workerDiagnostics/protocol';
import { BoundedReplayGuard } from '../../../src/worker/diagnostics/replayGuard';
import {
  bucketAge,
  bucketCount,
  buildWorkerDiagnosticsSnapshot,
} from '../../../src/worker/diagnostics/snapshot';

describe('worker diagnostics', () => {
  it('authenticates once and rejects replay, tampering, and stale requests', () => {
    const body = JSON.stringify({ protocolVersion: 1 });
    const secret = 's'.repeat(32);
    const now = 1_800_000_000_000;
    const headers = signDiagnosticsRequest(secret, 'POST', '/diagnostics', body, now, 'a'.repeat(32));
    const guard = new BoundedReplayGuard(60_000, 2);
    const verify = (candidateBody: string, candidateNow = now) => verifyDiagnosticsRequest({
      secret,
      method: 'POST',
      path: '/diagnostics',
      body: candidateBody,
      headers,
      nowMs: candidateNow,
      freshnessWindowMs: 60_000,
      replayGuard: guard,
    });

    expect(verify(body)).toBe(true);
    expect(verify(body)).toBe(false);
    expect(verify(`${body} `)).toBe(false);
    expect(verify(body, now + 60_001)).toBe(false);
  });

  it('rejects every malformed authentication header boundary before replay admission', () => {
    const body = JSON.stringify({ protocolVersion: 1 });
    const secret = 's'.repeat(32);
    const now = 1_800_000_000_000;
    const valid = signDiagnosticsRequest(secret, 'post', '/diagnostics', body, now, 'a'.repeat(32));
    const accept = () => true;
    const verify = (headers: Partial<typeof valid>) => verifyDiagnosticsRequest({
      secret,
      method: 'POST',
      path: '/diagnostics',
      body,
      headers,
      nowMs: now,
      freshnessWindowMs: 60_000,
      replayGuard: { accept },
    });

    expect(verify({ nonce: valid.nonce, signature: valid.signature })).toBe(false);
    expect(verify({ timestamp: valid.timestamp, signature: valid.signature })).toBe(false);
    expect(verify({ timestamp: valid.timestamp, nonce: valid.nonce })).toBe(false);
    expect(verify({ ...valid, nonce: 'too-short' })).toBe(false);
    expect(verify({ ...valid, signature: 'g'.repeat(64) })).toBe(false);
    expect(verify({ ...valid, timestamp: '1.5' })).toBe(false);
  });

  it('uses random authentication defaults when callers do not supply them', () => {
    const first = signDiagnosticsRequest('secret', 'post', '/diagnostics', 'body');
    const second = signDiagnosticsRequest('secret', 'POST', '/diagnostics', 'body');

    expect(Number.isSafeInteger(Number(first.timestamp))).toBe(true);
    expect(first.nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(second.nonce).not.toBe(first.nonce);
  });

  it('prunes expired replay entries, evicts the oldest at capacity, and clears state', () => {
    const guard = new BoundedReplayGuard(10, 2);
    expect(guard.accept('first', 100)).toBe(true);
    expect(guard.accept('second', 101)).toBe(true);
    expect(guard.accept('third', 102)).toBe(true);
    expect(guard.accept('first', 103)).toBe(true);
    expect(guard.accept('first', 104)).toBe(false);

    expect(guard.accept('expired', 200)).toBe(true);
    expect(guard.accept('expired', 210)).toBe(true);
    guard.clear();
    expect(guard.accept('expired', 210)).toBe(true);
  });

  it('handles a zero-capacity replay guard without attempting an invalid eviction', () => {
    const guard = new BoundedReplayGuard(10, 0);

    expect(guard.accept('nonce', 100)).toBe(true);
  });

  it('buckets count and age values at every privacy boundary', () => {
    expect([
      bucketCount(Number.NaN),
      bucketCount(0),
      bucketCount(1),
      bucketCount(2),
      bucketCount(6),
      bucketCount(21),
      bucketCount(101),
    ]).toEqual(['0', '0', '1', '2-5', '6-20', '21-100', '101+']);

    const now = 2 * 24 * 60 * 60_000;
    expect([
      bucketAge(null, now),
      bucketAge('not-a-date', now),
      bucketAge(now + 1, now),
      bucketAge(now - 60_000, now),
      bucketAge(now - 15 * 60_000, now),
      bucketAge(now - 60 * 60_000, now),
      bucketAge(now - 24 * 60 * 60_000, now),
    ]).toEqual(['never', 'never', '<1m', '1m-15m', '15m-1h', '1h-24h', '1d+']);
  });

  it('builds only bucketed, allowlisted support data', () => {
    const snapshot = buildWorkerDiagnosticsSnapshot({
      workerStartedAt: 1_800_000_000_000 - 20 * 60_000,
      concurrency: 7,
      redisConnected: true,
      databaseConnected: true,
      notificationConsumerRunning: true,
      transactionHandlerRegistered: true,
      notificationTelemetryWriter: {
        observation: 'observed',
        circuit: 'open',
        droppedEvents: 'six_to_twenty',
      },
      electrum: {
        managerRunning: true,
        connected: true,
        subscriptionOwner: true,
        subscribedAddresses: 42,
      },
      telegramCircuit: {
        state: 'open',
        failures: 5,
        totalRequests: 200,
        lastFailure: new Date(1_800_000_000_000 - 90_000).toISOString(),
        lastSuccess: new Date(1_800_000_000_000 - 30_000).toISOString(),
        lastFailureClass: 'authentication',
      },
    }, 1_800_000_000_000);

    expect(WorkerDiagnosticsResponseSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot).toMatchObject({
      worker: { readiness: 'ready', uptime: '15m-1h', concurrency: '6-20' },
      electrum: { subscribedAddresses: '21-100' },
      telegram: {
        circuitState: 'open',
        totalRequests: '101+',
        lastFailureAge: '1m-15m',
        lastSuccessAge: '<1m',
        lastFailureClass: 'authentication',
      },
      notificationTelemetryWriter: {
        observation: 'observed',
        circuit: 'open',
        droppedEvents: 'six_to_twenty',
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('hostname');
    expect(JSON.stringify(snapshot)).not.toContain('address');
  });

  it('distinguishes known database failure and fails missing local evidence closed', () => {
    const snapshot = buildWorkerDiagnosticsSnapshot({
      workerStartedAt: 1,
      concurrency: 1,
      redisConnected: true,
      databaseConnected: false,
      notificationConsumerRunning: true,
      transactionHandlerRegistered: true,
      electrum: {
        managerRunning: false,
        connected: false,
        subscriptionOwner: false,
        subscribedAddresses: 0,
      },
    }, 2);

    expect(snapshot.database).toEqual({ state: 'disconnected' });
    expect(snapshot.notificationTelemetryWriter).toEqual({ observation: 'unavailable' });
    expect(snapshot.telegram).toMatchObject({
      lastSuccessAge: 'never',
      lastFailureAge: 'never',
      lastFailureClass: 'none',
    });
    expect(snapshot.walletSyncExecution).toBeUndefined();
  });

  it('carries a strict versioned sampled wallet-sync execution observation', () => {
    const walletSyncExecution = {
      version: 1 as const,
      observation: 'observed' as const,
      scope: 'sampled_worker' as const,
      processEpochAge: '1h-24h' as const,
      countersResetAge: '<1m' as const,
      active: {
        total: '1' as const,
        byStage: {
          candidate_fetch: '0' as const,
          parent_fetch: '0' as const,
          timestamp_fetch: '0' as const,
          classification: '1' as const,
          persistence: '0' as const,
        },
        oldestProgressAge: '1m-15m' as const,
      },
      counters: {
        started: '2-5' as const,
        stageTransitions: '6-20' as const,
        completed: '1' as const,
        failed: '1' as const,
        timedOut: '0' as const,
        aborted: '0' as const,
        budgetExpired: '1' as const,
        lockLost: '0' as const,
        stalePruned: '0' as const,
      },
      redisLockAgreement: {
        agreement: 'observed' as const,
        registryWithOwnedLock: '1' as const,
        registryMissingOwnedLock: '0' as const,
        registryTokenMismatch: '0' as const,
      },
    };
    const snapshot = buildWorkerDiagnosticsSnapshot({
      workerStartedAt: 1,
      concurrency: 1,
      redisConnected: true,
      notificationConsumerRunning: true,
      transactionHandlerRegistered: true,
      electrum: {
        managerRunning: false,
        connected: false,
        subscriptionOwner: false,
        subscribedAddresses: 0,
      },
      walletSyncExecution,
    }, 2);

    expect(snapshot.walletSyncExecution).toEqual(walletSyncExecution);
    expect(WorkerDiagnosticsResponseSchema.safeParse(snapshot).success).toBe(true);
    expect(WorkerDiagnosticsResponseSchema.safeParse({
      ...snapshot,
      walletSyncExecution: { ...walletSyncExecution, walletId: 'private' },
    }).success).toBe(false);
  });

  it('degrades readiness and normalizes invalid worker start time and unknown database state', () => {
    const snapshot = buildWorkerDiagnosticsSnapshot({
      workerStartedAt: Number.NaN,
      concurrency: 0,
      redisConnected: false,
      notificationConsumerRunning: false,
      transactionHandlerRegistered: false,
      electrum: {
        managerRunning: false,
        connected: false,
        subscriptionOwner: false,
        subscribedAddresses: Number.NaN,
      },
      telegramCircuit: {
        state: 'half-open',
        failures: 0,
        totalRequests: 1,
        lastFailure: null,
      },
    }, 1_800_000_000_000);

    expect(snapshot.worker).toEqual({ readiness: 'degraded', uptime: '<1m', concurrency: '0' });
    expect(snapshot.redis).toEqual({ state: 'disconnected' });
    expect(snapshot.database).toEqual({ state: 'unknown' });
    expect(snapshot.telegram).toMatchObject({
      lastSuccessAge: 'never',
      lastFailureClass: 'unknown',
    });
  });
});
