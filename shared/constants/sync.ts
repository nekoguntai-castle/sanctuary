/**
 * Canonical wallet sync priority values.
 *
 * HTTP sync routes, frontend API helpers, in-memory sync queues, and BullMQ
 * worker queues all use this same priority vocabulary.
 */

export const SYNC_PRIORITY_VALUES = ['high', 'normal', 'low'] as const;
export type SyncPriority = (typeof SYNC_PRIORITY_VALUES)[number];

export const DEFAULT_SYNC_PRIORITY: SyncPriority = 'normal';

export const SYNC_PRIORITY_SORT_ORDER: Record<SyncPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export const SYNC_PRIORITY_BULLMQ_PRIORITY: Record<SyncPriority, number> = {
  high: 1,
  normal: 2,
  low: 3,
};

export function isSyncPriority(value: unknown): value is SyncPriority {
  return typeof value === 'string' && (SYNC_PRIORITY_VALUES as readonly string[]).includes(value);
}
