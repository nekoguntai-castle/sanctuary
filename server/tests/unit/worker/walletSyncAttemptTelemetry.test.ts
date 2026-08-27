import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncProgressDetails } from '@sanctuary/shared/schemas/syncProgress';

const metric = vi.hoisted(() => ({
  finishStage: vi.fn(),
  enterStage: vi.fn(),
  fallback: vi.fn(),
  budget: vi.fn(),
  candidates: vi.fn(),
  terminal: vi.fn(),
  grace: vi.fn(),
}));
const registry = vi.hoisted(() => ({
  start: vi.fn(),
  transition: vi.fn(),
  finish: vi.fn(),
  recordBudgetExpiry: vi.fn(),
}));

vi.mock('../../../src/observability/metrics/walletSyncMetrics', () => ({
  enterWalletSyncStage: metric.enterStage,
  recordWalletSyncFallback: metric.fallback,
  recordWalletSyncBudgetExpiry: metric.budget,
  recordWalletSyncCandidateOutcome: metric.candidates,
  recordWalletSyncTerminalOutcome: metric.terminal,
  recordWalletSyncAbortGraceExhaustion: metric.grace,
}));
vi.mock('../../../src/worker/walletSyncExecutionRegistry', () => ({
  walletSyncExecutionRegistry: registry,
}));

import { WalletSyncAttemptTelemetry } from '../../../src/worker/walletSyncAttemptTelemetry';

const progress = (
  event: SyncProgressDetails['event'],
  stage: SyncProgressDetails['stage'],
): SyncProgressDetails => ({
  kind: 'sync_progress',
  event,
  stage,
  unit: stage === 'timestamp_fetch' ? 'block_heights' : 'transactions',
  batch: 1,
  batchCount: 1,
  elapsedMs: 10,
  ...(event === 'batch_completed' ? { completed: 1, total: 1 } : {}),
});

describe('WalletSyncAttemptTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.start.mockReturnValue(true);
    registry.transition.mockReturnValue(true);
    registry.finish.mockReturnValue(true);
    registry.recordBudgetExpiry.mockReturnValue(true);
    metric.enterStage.mockReturnValue(metric.finishStage);
  });

  it('tracks fixed stage transitions and always closes the active gauge', () => {
    const telemetry = new WalletSyncAttemptTelemetry({
      executionId: 'execution-1',
      ownedLock: { key: 'sync:wallet:wallet-1', token: 'a'.repeat(32) },
      mode: 'incremental',
      network: 'mainnet',
    });

    telemetry.observeProgress(progress('stage_started', 'candidate_fetch'));
    telemetry.observeProgress(progress('stage_started', 'parent_fetch'));
    telemetry.observeProgress(progress('stage_started', 'persistence'));
    telemetry.observeProgress(progress('batch_completed', 'persistence'));
    telemetry.finish('completed');

    expect(registry.start).toHaveBeenCalledTimes(1);
    expect(registry.transition).toHaveBeenNthCalledWith(
      1, 'execution-1', 'parent_fetch', expect.any(Number),
    );
    expect(registry.transition).toHaveBeenNthCalledWith(
      2, 'execution-1', 'persistence', expect.any(Number),
    );
    expect(metric.finishStage).toHaveBeenNthCalledWith(1, 'completed', expect.any(Number));
    expect(metric.finishStage).toHaveBeenNthCalledWith(2, 'completed', expect.any(Number));
    expect(metric.finishStage).toHaveBeenNthCalledWith(3, 'completed', expect.any(Number));
    expect(registry.finish).toHaveBeenCalledWith('execution-1', 'completed');
  });

  it('records fallback, candidate, and grace signals without dynamic labels', () => {
    const telemetry = new WalletSyncAttemptTelemetry({
      executionId: 'execution-2',
      ownedLock: { key: 'sync:wallet:wallet-2', token: 'b'.repeat(32) },
      mode: 'full_resync',
      network: 'testnet4',
    });

    telemetry.observeProgress(progress('stage_started', 'timestamp_fetch'));
    telemetry.observeProgress(progress('fallback', 'timestamp_fetch'));
    telemetry.recordCandidates(20, 5);
    telemetry.recordAbortGraceExhaustion();

    const dimensions = {
      stage: 'timestamp_fetch',
      mode: 'full_resync',
      network: 'testnet4',
    };
    expect(metric.fallback).toHaveBeenCalledWith(dimensions);
    expect(metric.budget).toHaveBeenCalledWith(dimensions);
    expect(metric.finishStage).toHaveBeenCalledWith('budget_expired', expect.any(Number));
    expect(metric.candidates).toHaveBeenCalledWith('fetched', 20);
    expect(metric.candidates).toHaveBeenCalledWith('rejected', 5);
    expect(metric.grace).toHaveBeenCalledOnce();
  });

  it('records a non-candidate budget expiry once through finishStage', () => {
    const telemetry = new WalletSyncAttemptTelemetry({
      executionId: 'execution-address-budget',
      ownedLock: { key: 'sync:wallet:wallet-address-budget', token: 'f'.repeat(32) },
      mode: 'incremental',
      network: 'testnet3',
    });
    telemetry.beginStage('address_history', 1_000);

    expect(telemetry.finishStage('address_history', 'budget_expired', 301_000)).toBe(true);
    expect(telemetry.finishStage('address_history', 'budget_expired', 302_000)).toBe(false);
    expect(metric.budget).toHaveBeenCalledOnce();
    expect(metric.budget).toHaveBeenCalledWith({
      stage: 'address_history',
      mode: 'incremental',
      network: 'testnet3',
    });
    expect(registry.recordBudgetExpiry).toHaveBeenCalledOnce();
    expect(registry.recordBudgetExpiry).toHaveBeenCalledWith('execution-address-budget');
    expect(metric.finishStage).toHaveBeenCalledOnce();
    expect(metric.finishStage).toHaveBeenCalledWith('budget_expired', 301_000);
  });

  it('records a terminal outcome once while retaining activity until cleanup', () => {
    const telemetry = new WalletSyncAttemptTelemetry({
      executionId: 'execution-3',
      ownedLock: { key: 'sync:wallet:wallet-3', token: 'c'.repeat(32) },
      mode: 'incremental',
      network: 'signet',
    });
    telemetry.observeProgress(progress('stage_started', 'classification'));

    telemetry.observeProgress(progress('timeout', 'classification'));
    telemetry.recordAttemptTimeout();
    expect(registry.finish).not.toHaveBeenCalled();

    telemetry.finish('timedOut');
    expect(metric.terminal).toHaveBeenCalledOnce();
    expect(metric.terminal).toHaveBeenCalledWith('timeout');
    expect(metric.finishStage).toHaveBeenCalledWith('aborted', expect.any(Number));
    expect(registry.finish).toHaveBeenCalledWith('execution-3', 'timedOut');
  });

  it('records progress-driven aborts once through the public abort hook', () => {
    const telemetry = new WalletSyncAttemptTelemetry({
      executionId: 'execution-aborted',
      ownedLock: { key: 'sync:wallet:wallet-aborted', token: 'd'.repeat(32) },
      mode: 'incremental',
      network: 'regtest',
    });
    telemetry.observeProgress(progress('stage_started', 'candidate_fetch'));

    telemetry.observeProgress(progress('aborted', 'candidate_fetch'));
    telemetry.recordAttemptAbort();
    telemetry.finish('aborted');

    expect(metric.terminal).toHaveBeenCalledOnce();
    expect(metric.terminal).toHaveBeenCalledWith('aborted');
    expect(metric.finishStage).toHaveBeenCalledWith('aborted', expect.any(Number));
    expect(registry.finish).toHaveBeenCalledWith('execution-aborted', 'aborted');
  });

  it('registers preflight immediately and keeps duplicate transitions idempotent', () => {
    const telemetry = new WalletSyncAttemptTelemetry({
      executionId: 'execution-preflight',
      ownedLock: { key: 'sync:wallet:wallet-preflight', token: 'e'.repeat(32) },
      mode: 'incremental',
      network: 'mainnet',
    });

    expect(telemetry.beginStage('preflight', 1_000)).toBe(true);
    expect(telemetry.beginStage('preflight', 9_000)).toBe(false);
    expect(registry.start).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'execution-preflight', stage: 'preflight', atMs: 1_000,
    }));
    expect(registry.transition).not.toHaveBeenCalled();
    expect(metric.enterStage).toHaveBeenCalledOnce();

    expect(telemetry.finishStage('address_history', 'completed', 10_000)).toBe(false);
    expect(telemetry.finishStage('preflight', 'completed', 10_000)).toBe(true);
    expect(telemetry.finishStage('preflight', 'failed', 11_000)).toBe(false);
    expect(metric.finishStage).toHaveBeenCalledOnce();
    expect(metric.finishStage).toHaveBeenCalledWith('completed', 10_000);
  });

  it('keeps terminal cleanup idempotent when registry admission is unavailable', () => {
    registry.start.mockReturnValueOnce(false);
    const telemetry = new WalletSyncAttemptTelemetry({
      executionId: 'execution-unregistered',
      ownedLock: { key: 'sync:wallet:wallet-unregistered', token: '9'.repeat(32) },
      mode: 'incremental',
      network: 'mainnet',
    });
    telemetry.beginStage('preflight');

    telemetry.finish('failed');
    telemetry.finish('completed');

    expect(metric.finishStage).toHaveBeenCalledOnce();
    expect(metric.finishStage).toHaveBeenCalledWith('failed', expect.any(Number));
    expect(registry.finish).not.toHaveBeenCalled();
  });
});
