import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAddExhaustedJob = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/deadLetterQueue', () => ({
  deadLetterQueue: {
    addExhaustedJob: mockAddExhaustedJob,
  },
}));

import { reconcileExhaustedJobs } from '../../../src/worker/workerJobQueue/deadLetterReconciler';

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    name: 'sync-wallet',
    data: { walletId: 'wallet-1' },
    attemptsMade: 3,
    failedReason: 'sync failed',
    timestamp: 5_000,
    finishedOn: 10_000,
    opts: { attempts: 3 },
    ...overrides,
  };
}

describe('reconcileExhaustedJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddExhaustedJob.mockResolvedValue('entry-1');
  });

  it('upserts only current exhausted failures from every queue', async () => {
    const sync = {
      queue: {
        getJobs: vi.fn().mockResolvedValue([
          job(),
          job({ id: 'retrying', attemptsMade: 1 }),
          job({ id: 'expired', finishedOn: -604_780_001 }),
        ]),
      },
    };
    const notifications = {
      queue: {
        getJobs: vi.fn().mockResolvedValue([
          job({
            id: 'notification',
            name: 'transaction-notify',
            attemptsMade: 5,
            opts: { attempts: 5 },
          }),
        ]),
      },
    };

    await expect(reconcileExhaustedJobs(
      new Map([
        ['sync', sync as any],
        ['notifications', notifications as any],
      ]),
      20_000,
    )).resolves.toBe(2);

    expect(sync.queue.getJobs).toHaveBeenCalledWith(
      ['failed'],
      0,
      249,
      false,
    );
    expect(mockAddExhaustedJob).toHaveBeenCalledWith(
      'sync',
      'sync',
      expect.objectContaining({ id: 'job-1' }),
      'sync failed',
      new Date(10_000),
    );
    expect(mockAddExhaustedJob).toHaveBeenCalledWith(
      'notification',
      'notifications',
      expect.objectContaining({ id: 'notification' }),
      'sync failed',
      new Date(10_000),
    );
    expect(mockAddExhaustedJob).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: 'retrying' }),
      expect.anything(),
    );
  });

  it('uses a bounded fallback error and propagates queue or Redis failures', async () => {
    const queue = {
      queue: {
        getJobs: vi.fn().mockResolvedValue([
          job({
            failedReason: undefined,
            finishedOn: undefined,
            attemptsMade: 1,
            opts: {},
          }),
        ]),
      },
    };
    await reconcileExhaustedJobs(new Map([['maintenance', queue as any]]));
    expect(mockAddExhaustedJob).toHaveBeenCalledWith(
      'other',
      'maintenance',
      expect.anything(),
      'Exhausted worker job',
      new Date(5_000),
    );

    mockAddExhaustedJob.mockClear();
    const failingQueue = {
      queue: {
        getJobs: vi.fn().mockRejectedValue(new Error('queue unavailable')),
      },
    };
    const laterQueue = {
      queue: { getJobs: vi.fn().mockResolvedValue([job({ id: 'later' })]) },
    };
    await expect(
      reconcileExhaustedJobs(new Map([
        ['maintenance', failingQueue as any],
        ['sync', laterQueue as any],
      ]), 20_000),
    ).rejects.toEqual(expect.objectContaining({
      errors: [expect.objectContaining({ message: 'queue unavailable' })],
    }));
    expect(mockAddExhaustedJob).toHaveBeenCalledWith(
      'sync',
      'sync',
      expect.objectContaining({ id: 'later' }),
      'sync failed',
      new Date(10_000),
    );

    mockAddExhaustedJob.mockClear();
    mockAddExhaustedJob.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(
      reconcileExhaustedJobs(new Map([
        ['maintenance', queue as any],
        ['sync', laterQueue as any],
      ]), 20_000),
    ).rejects.toEqual(expect.objectContaining({
      errors: [expect.objectContaining({ message: 'Redis unavailable' })],
    }));
    expect(mockAddExhaustedJob).toHaveBeenCalledWith(
      'sync',
      'sync',
      expect.objectContaining({ id: 'later' }),
      'sync failed',
      new Date(10_000),
    );
  });
});
