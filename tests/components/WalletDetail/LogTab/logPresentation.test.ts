import { describe, expect, it } from 'vitest';
import { SYNC_PROGRESS_STAGES } from '@sanctuary/shared/schemas/syncProgress';
import { mergeWalletLogEntries } from '../../../../src/hooks/websocket/walletLogMerge';
import {
  findLastSyncProgressDetails,
  findLastSyncProgressCheckpoint,
  formatCurrentSyncCheckpoint,
  formatLogDetails,
  formatSyncProgressDetails,
  formatSyncStageDuration,
  parseSyncProgressDetails,
  parseSyncProgressPresentationDetails,
} from '../../../../src/components/WalletDetail/LogTab/logPresentation';
import type { DisplayLogEntry } from '../../../../src/components/WalletDetail/LogTab/types';

const details = {
  kind: 'sync_progress',
  event: 'batch_completed',
  stage: 'candidate_fetch',
  unit: 'transactions',
  batch: 1,
  batchCount: 4,
  elapsedMs: 25,
  completed: 25,
  total: 100,
} as const;

const entry = (id: string, value: Record<string, unknown>): DisplayLogEntry => ({
  id,
  timestamp: '2026-08-27T00:00:00.000Z',
  level: 'info',
  module: 'SYNC',
  message: 'progress',
  details: value,
});

describe('sync progress log presentation', () => {
  it.each(SYNC_PROGRESS_STAGES)('renders fixed stage %s without inventing a percentage', (stage) => {
    const text = formatLogDetails(entry(stage, { ...details, stage }));
    expect(text).toContain('batch 1/4');
    expect(text).toContain('25/100 transactions');
    expect(text).not.toContain('%');
  });

  it.each([
    ['preflight', 'Preparing wallet sync'],
    ['initial_network', 'Checking network status'],
    ['address_history', 'Fetching address history'],
    ['transaction_reconciliation', 'Reconciling transactions'],
    ['utxo_reconciliation', 'Reconciling UTXOs'],
    ['address_maintenance', 'Maintaining wallet addresses'],
    ['missing_field_repair', 'Repairing transaction details'],
    ['subscription_enrollment', 'Enrolling address subscriptions'],
    ['finalization', 'Finalizing wallet sync'],
  ] as const)('renders strict phase label for %s', (stage, label) => {
    const phase = {
      kind: 'sync_phase_progress',
      event: 'stage_started',
      stage,
      elapsedMs: 0,
    };
    expect(formatLogDetails(entry(stage, phase))).toBe(`${label} · Started`);
    expect(parseSyncProgressPresentationDetails(phase)).toEqual(phase);
  });

  it('renders phase work items only with a known denominator', () => {
    const base = {
      kind: 'sync_phase_progress',
      event: 'stage_started',
      stage: 'address_history',
      elapsedMs: 0,
    } as const;
    expect(formatLogDetails(entry('unknown', base))).not.toContain('/');
    expect(formatLogDetails(entry('known', {
      ...base,
      workItems: { completed: 2, total: 10, unit: 'addresses' },
    }))).toContain('2/10 addresses');
  });

  it.each([
    [0, '0s'],
    [59_999, '59s'],
    [60_000, '1m 0s'],
    [3_661_000, '1h 1m 1s'],
  ])('formats %i milliseconds as %s', (elapsedMs, expected) => {
    expect(formatSyncStageDuration(elapsedMs)).toBe(expected);
  });

  it('treats a non-finite direct duration as zero', () => {
    expect(formatSyncStageDuration(Number.NaN)).toBe('0s');
  });

  it('clamps rollback, invalid clocks, and overlong live durations', () => {
    const started = {
      timestamp: 10_000,
      details: {
        ...details,
        event: 'stage_started',
        elapsedMs: 1_000,
        completed: undefined,
        total: undefined,
      },
    } as const;
    expect(formatCurrentSyncCheckpoint(started, 8_000)).toContain('0s in stage');
    expect(formatCurrentSyncCheckpoint(started, Number.NaN)).toContain('0s in stage');
    expect(formatCurrentSyncCheckpoint(started, Number.MAX_SAFE_INTEGER)).toContain('24h 0m 0s in stage');
  });

  it('formats a stage start without completed counters', () => {
    expect(formatSyncProgressDetails(details)).toBe(
      'Fetching transaction candidates · Batch completed · batch 1/4 · 25/100 transactions',
    );
    expect(formatLogDetails(entry('started', {
      ...details,
      event: 'stage_started',
      completed: undefined,
      total: undefined,
    }))).toContain('Started · batch 1/4');
  });

  it('rejects malformed and future detail shapes', () => {
    expect(parseSyncProgressDetails({ ...details, stage: 'private_future_stage' })).toBeNull();
    expect(parseSyncProgressDetails({ ...details, walletId: 'private-wallet' })).toBeNull();
    expect(formatLogDetails(entry('legacy', { count: 2, viaTor: true }))).toBe('count=2');
  });

  it('finds only the latest runtime-valid checkpoint', () => {
    const latest = findLastSyncProgressDetails([
      entry('valid', details),
      entry('future', { ...details, event: 'future_event' }),
    ]);
    expect(latest).toMatchObject({ stage: 'candidate_fetch', completed: 25 });
    expect(findLastSyncProgressDetails([entry('bad', { kind: 'sync_progress' })])).toBeNull();
    expect(findLastSyncProgressCheckpoint([
      { ...entry('bad-time', details), timestamp: '2026-02-30T00:00:00Z' },
      entry('valid', details),
    ])).toMatchObject({ details: { stage: 'candidate_fetch' } });
    expect(findLastSyncProgressCheckpoint([
      { ...entry('bad-time', details), timestamp: '2026-02-30T00:00:00Z' },
    ])).toBeNull();
    expect(findLastSyncProgressCheckpoint(new Array<DisplayLogEntry>(1))).toBeNull();
  });

  it('keeps the causally newest stage when checkpoints share a millisecond', () => {
    const timestamp = '2026-08-27T00:00:00.000Z';
    const merged = mergeWalletLogEntries([
      {
        ...entry('z-terminal', {
          kind: 'sync_phase_progress',
          event: 'stage_completed',
          stage: 'transaction_reconciliation',
          elapsedMs: 10,
        }),
        sequence: 100,
        timestamp,
      },
    ], [
      {
        ...entry('a-next-stage', {
          kind: 'sync_phase_progress',
          event: 'stage_started',
          stage: 'utxo_reconciliation',
          elapsedMs: 0,
        }),
        sequence: 101,
        timestamp,
      },
    ], 500);

    expect(findLastSyncProgressCheckpoint(merged)).toMatchObject({
      details: { event: 'stage_started', stage: 'utxo_reconciliation' },
    });
  });
});
