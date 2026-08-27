import { describe, expect, it } from 'vitest';
import { SYNC_PROGRESS_STAGES } from '@sanctuary/shared/schemas/syncProgress';
import {
  findLastSyncProgressDetails,
  findLastSyncProgressCheckpoint,
  formatLogDetails,
  parseSyncProgressDetails,
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

  it('formats a stage start without completed counters', () => {
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
});
