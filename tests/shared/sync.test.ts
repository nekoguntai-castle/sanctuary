import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYNC_PRIORITY,
  SYNC_PRIORITY_BULLMQ_PRIORITY,
  SYNC_PRIORITY_SORT_ORDER,
  SYNC_PRIORITY_VALUES,
  isSyncPriority,
} from '@sanctuary/shared/constants/sync';

describe('sync priority constants', () => {
  it('defines priority values, default, queue sort order, and BullMQ mapping', () => {
    expect(SYNC_PRIORITY_VALUES).toEqual(['high', 'normal', 'low']);
    expect(DEFAULT_SYNC_PRIORITY).toBe('normal');
    expect(SYNC_PRIORITY_SORT_ORDER).toEqual({ high: 0, normal: 1, low: 2 });
    expect(SYNC_PRIORITY_BULLMQ_PRIORITY).toEqual({ high: 1, normal: 2, low: 3 });
  });

  it('guards sync priority values', () => {
    expect(isSyncPriority('high')).toBe(true);
    expect(isSyncPriority('normal')).toBe(true);
    expect(isSyncPriority('low')).toBe(true);
    expect(isSyncPriority('urgent')).toBe(false);
    expect(isSyncPriority(null)).toBe(false);
  });
});
