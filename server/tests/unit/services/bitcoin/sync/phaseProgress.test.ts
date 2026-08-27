import { beforeEach, describe, expect, it, vi } from 'vitest';
import { walletLog } from '../../../../../src/websocket/notifications';
import { createSyncPhaseProgress } from '../../../../../src/services/bitcoin/sync/phaseProgress';

const phaseLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock('../../../../../src/websocket/notifications', () => ({ walletLog: vi.fn() }));
vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: vi.fn(() => phaseLogger),
}));

describe('createSyncPhaseProgress', () => {
  const telemetry = {
    beginStage: vi.fn(() => true),
    finishStage: vi.fn(() => true),
    observeProgress: vi.fn(),
    recordCandidates: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it('emits one strict start and terminal checkpoint with stage-local elapsed time', () => {
    let now = 1_000;
    const progress = createSyncPhaseProgress('wallet-1', telemetry, () => now);
    progress.begin('address_history', undefined, {
      completed: 0,
      total: 3,
      unit: 'addresses',
    });
    now = 1_250;
    progress.finish();

    expect(telemetry.beginStage).toHaveBeenCalledWith('address_history', 1_000);
    expect(telemetry.finishStage).toHaveBeenCalledWith('address_history', 'completed', 1_250);
    expect(vi.mocked(walletLog).mock.calls.map(call => call[4])).toEqual([
      expect.objectContaining({ event: 'stage_started', elapsedMs: 0 }),
      expect.objectContaining({
        event: 'stage_completed',
        elapsedMs: 250,
        workItems: { completed: 3, total: 3, unit: 'addresses' },
      }),
    ]);
    expect(phaseLogger.info).toHaveBeenCalledWith(
      'sync_phase_progress',
      expect.objectContaining({
        kind: 'sync_phase_progress',
        stage: 'address_history',
      }),
    );
  });

  it('does not reset or log a duplicate begin', () => {
    let now = 100;
    const progress = createSyncPhaseProgress('wallet-1', telemetry, () => now);
    expect(progress.begin('preflight')).toBe(true);
    now = 500;
    expect(progress.begin('preflight')).toBe(false);
    now = 700;
    progress.finish();

    expect(telemetry.beginStage).toHaveBeenCalledOnce();
    expect(vi.mocked(walletLog).mock.calls[1]?.[4]).toMatchObject({ elapsedMs: 600 });
  });

  it('clamps clock rollback and finishes a prior stage before a transition', () => {
    let now = 500;
    const progress = createSyncPhaseProgress('wallet-1', telemetry, () => now);
    progress.begin('preflight');
    now = 400;
    progress.begin('initial_network');

    expect(telemetry.finishStage).toHaveBeenCalledWith('preflight', 'completed', 400);
    expect(vi.mocked(walletLog).mock.calls[1]?.[4]).toMatchObject({
      event: 'stage_completed',
      elapsedMs: 0,
    });
  });

  it('stays silent without attempt telemetry', () => {
    const progress = createSyncPhaseProgress('wallet-1', undefined);
    expect(progress.begin('preflight')).toBe(false);
    expect(progress.finish('stage_failed')).toBe(false);
    expect(walletLog).not.toHaveBeenCalled();
  });

  it('emits a strict failed checkpoint while recording a budget-expired outcome', () => {
    let now = 100;
    const progress = createSyncPhaseProgress('wallet-1', telemetry, () => now);
    progress.begin('utxo_reconciliation');
    now = 600;

    expect(progress.budgetExpired('UTXO budget expired.')).toBe(true);
    expect(telemetry.finishStage).toHaveBeenCalledWith(
      'utxo_reconciliation',
      'budget_expired',
      600,
    );
    expect(vi.mocked(walletLog).mock.calls.at(-1)?.[4]).toMatchObject({
      kind: 'sync_phase_progress',
      event: 'stage_failed',
      stage: 'utxo_reconciliation',
      elapsedMs: 500,
    });
  });

  it('retains state when telemetry rejects a close and rejects an unregistered begin', () => {
    const rejectingClose = {
      ...telemetry,
      finishStage: vi.fn(() => false),
    };
    const progress = createSyncPhaseProgress('wallet-1', rejectingClose);
    expect(progress.activeStage()).toBeNull();
    expect(progress.begin('address_history', undefined, {
      completed: Number.POSITIVE_INFINITY,
      total: Number.NaN,
      unit: 'addresses',
    })).toBe(true);
    expect(progress.activeStage()).toBe('address_history');
    expect(progress.finish()).toBe(false);
    expect(progress.activeStage()).toBe('address_history');
    expect(vi.mocked(walletLog).mock.calls[0]?.[4]).toMatchObject({
      workItems: { completed: 0, total: 0, unit: 'addresses' },
    });

    const rejectingBegin = createSyncPhaseProgress('wallet-2', {
      ...telemetry,
      beginStage: vi.fn(() => false),
    });
    expect(rejectingBegin.begin('preflight')).toBe(false);
    expect(rejectingBegin.activeStage()).toBeNull();
  });
});
