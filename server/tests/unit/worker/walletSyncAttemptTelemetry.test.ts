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
    expect(registry.transition).toHaveBeenCalledWith('execution-1', 'parent_fetch');
    expect(metric.finishStage).toHaveBeenNthCalledWith(1, 'completed');
    expect(metric.finishStage).toHaveBeenNthCalledWith(2, 'completed');
    expect(metric.finishStage).toHaveBeenNthCalledWith(3, 'completed');
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
    expect(metric.finishStage).toHaveBeenCalledWith('budget_expired');
    expect(metric.candidates).toHaveBeenCalledWith('fetched', 20);
    expect(metric.candidates).toHaveBeenCalledWith('rejected', 5);
    expect(metric.grace).toHaveBeenCalledOnce();
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
    expect(metric.finishStage).toHaveBeenCalledWith('aborted');
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
    expect(metric.finishStage).toHaveBeenCalledWith('aborted');
    expect(registry.finish).toHaveBeenCalledWith('execution-aborted', 'aborted');
  });
});
