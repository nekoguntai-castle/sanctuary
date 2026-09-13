/**
 * Oversized entries must not be relost forever.
 *
 * Unlike deadLetterReconciler.test.ts (which mocks deadLetterQueue entirely and
 * so cannot exercise the size-bounding logic), this suite runs the reconciler
 * against the real DeadLetterQueue singleton (backed by its in-memory test
 * store, since no Redis client is initialized in the unit test process). This
 * proves the actual regression: before the fix, `addExhaustedJob` threw for an
 * oversized entry, `reconcileQueue` caught the error without memoizing the
 * job's identity, and every later reconciliation cycle retried and failed the
 * same job forever. After the fix, the entry is stored (bounded to the size
 * cap) and the identity is memoized, so a stable failed-job list is not
 * reprocessed on the next cycle.
 */
import { describe, expect, it } from 'vitest';
import { deadLetterQueue } from '../../../src/services/deadLetterQueue';
import { reconcileExhaustedJobs } from '../../../src/worker/workerJobQueue/deadLetterReconciler';
import type { QueueInstance } from '../../../src/worker/workerJobQueue/types';

// The real in-memory store's cleanup() evicts entries whose lastFailedAt is
// older than its own 7-day TTL, so the fixture must use wall-clock-relative
// timestamps rather than small epoch offsets.
const NOW = Date.now();

function oversizedFailedJob() {
  return {
    id: 'job-oversized',
    name: 'sync-wallet',
    // Large enough alone to force full truncation even after the redundant
    // payload.data display copy is dropped.
    data: { walletId: 'wallet-1', blob: 'x'.repeat(300 * 1_024) },
    attemptsMade: 3,
    failedReason: 'sync failed',
    timestamp: NOW - 5_000,
    finishedOn: NOW,
    opts: { attempts: 3 },
  };
}

describe('reconcileExhaustedJobs (real DeadLetterQueue, oversized entries)', () => {
  it('stores an oversized exhausted job truncated instead of losing it, and does not re-enqueue it on the next cycle', async () => {
    const state = new Map<string, Set<string>>();
    const queue: QueueInstance = {
      queue: {
        getJobs: async () => [oversizedFailedJob()],
      },
    } as unknown as QueueInstance;
    const queues = new Map([['sync', queue]]);

    // First cycle: the oversized job is reconciled without throwing (the
    // pre-fix behaviour was for addExhaustedJob to reject it outright).
    await expect(reconcileExhaustedJobs(queues, NOW + 1_000, state)).resolves.toBe(1);

    const entries = await deadLetterQueue.getByCategory('sync');
    const stored = entries.find(entry => entry.job?.jobId === 'job-oversized');
    expect(stored).toBeDefined();
    expect(stored!.job?.data).toEqual(expect.objectContaining({ truncated: true }));

    // Second cycle over the same still-failed job: since the first attempt
    // succeeded and was memoized, it must not be reprocessed (re-added) again.
    await expect(reconcileExhaustedJobs(queues, NOW + 2_000, state)).resolves.toBe(0);
  });
});
