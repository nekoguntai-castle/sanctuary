import { describe, expect, it } from 'vitest';
import { buildActivitySummaryParts } from '../../../src/components/Dashboard/activitySummaryModel';
import type { ActivitySummary } from '../../../src/api/transactions/types';

const summary = (overrides: Partial<ActivitySummary> = {}): ActivitySummary => ({
  count: 5,
  receivedSats: 100_000,
  sentSats: 40_000,
  latestAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

describe('buildActivitySummaryParts', () => {
  it('returns null while the summary is unknown', () => {
    // Rendering zeroes mid-flight would state something false about the
    // reader's money, so callers get an explicit "nothing to say yet".
    expect(buildActivitySummaryParts(undefined, '1W')).toBeNull();
  });

  it('names the period alongside the count', () => {
    // The control that sets the period lives in a different card, so a bare
    // "14" gives no clue which window it covers — and the number changes
    // silently when that control moves.
    const parts = buildActivitySummaryParts(summary({ count: 14 }), '1W');

    expect(parts).toMatchObject({
      countLabel: '14 confirmed in the past week',
      isEmpty: false,
    });
  });

  it('says "confirmed" so the count can be reconciled with the list below it', () => {
    // The list also shows unconfirmed rows, so the two legitimately differ.
    // The label is where that gets explained — a title tooltip would carry it
    // for mouse users only.
    expect(buildActivitySummaryParts(summary({ count: 1 }), '1W')?.countLabel).toContain(
      'confirmed'
    );
  });

  it('groups large counts for readability', () => {
    expect(buildActivitySummaryParts(summary({ count: 1234 }), '1W')?.countLabel).toBe(
      '1,234 confirmed in the past week'
    );
  });

  it('drops the period clause for all-time, which has no grammatical form', () => {
    // "14 confirmed in all time" is not English.
    expect(buildActivitySummaryParts(summary({ count: 14 }), 'ALL')?.countLabel).toBe(
      '14 confirmed'
    );
  });

  it('names the period when nothing happened', () => {
    expect(buildActivitySummaryParts(summary({ count: 0 }), '1M')).toEqual({
      countLabel: 'No activity in the past month',
      isEmpty: true,
    });
  });

  it('words the empty all-time case without a period clause', () => {
    expect(buildActivitySummaryParts(summary({ count: 0 }), 'ALL')).toEqual({
      countLabel: 'No confirmed activity yet',
      isEmpty: true,
    });
  });

  it('phrases every bounded timeframe', () => {
    const phrases = (['1D', '1W', '1M', '1Y'] as const).map(
      (timeframe) => buildActivitySummaryParts(summary({ count: 2 }), timeframe)?.countLabel
    );

    expect(phrases).toEqual([
      '2 confirmed in the past day',
      '2 confirmed in the past week',
      '2 confirmed in the past month',
      '2 confirmed in the past year',
    ]);
  });
});
