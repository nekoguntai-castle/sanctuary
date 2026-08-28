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

  it('repairs retained unrecoverable failures before the attempt budget is exhausted', async () => {
    const sync = {
      queue: {
        getJobs: vi.fn().mockResolvedValue([
          job({
            id: 'invalid-payload',
            attemptsMade: 1,
            failedReason: 'Unrecoverable job payload: invalid payload for sync:sync-wallet',
          }),
          job({
            id: 'handler-unrecoverable',
            attemptsMade: 1,
            failedReason: 'handler rejected the job',
            stacktrace: ['UnrecoverableError: handler rejected the job\n    at handler.ts:1:1'],
          }),
        ]),
      },
    };

    await expect(reconcileExhaustedJobs(
      new Map([['sync', sync as any]]),
      20_000,
    )).resolves.toBe(2);

    expect(mockAddExhaustedJob).toHaveBeenCalledWith(
      'sync',
      'sync',
      expect.objectContaining({ id: 'invalid-payload', attemptsMade: 1 }),
      'Unrecoverable job payload: invalid payload for sync:sync-wallet',
      new Date(10_000),
    );
    expect(mockAddExhaustedJob).toHaveBeenCalledWith(
      'sync',
      'sync',
      expect.objectContaining({ id: 'handler-unrecoverable', attemptsMade: 1 }),
      'handler rejected the job',
      new Date(10_000),
    );
  });

  it('uses a bounded fallback error and propagates queue or Redis failures', async () => {
    const queue = {
      queue: {
        getJobs: vi.fn().mockResolvedValue([
          job({
            id: undefined,
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

  it('repairs each retained attempt once across periodic reconciliations', async () => {
    const state = new Map<string, Set<string>>();
    const queue = {
      queue: { getJobs: vi.fn().mockResolvedValue([job()]) },
    };
    const queues = new Map([['sync', queue as any]]);

    await expect(reconcileExhaustedJobs(queues, 20_000, state)).resolves.toBe(1);
    await expect(reconcileExhaustedJobs(queues, 21_000, state)).resolves.toBe(0);

    expect(queue.queue.getJobs).toHaveBeenCalledTimes(2);
    expect(mockAddExhaustedJob).toHaveBeenCalledTimes(1);
    expect([...state.get('sync') ?? []]).toHaveLength(1);
  });

  it('repairs a later attempt of the same job identity', async () => {
    const state = new Map<string, Set<string>>();
    const queue = {
      queue: {
        getJobs: vi.fn()
          .mockResolvedValueOnce([job()])
          .mockResolvedValueOnce([job({ attemptsMade: 4, opts: { attempts: 4 } })]),
      },
    };
    const queues = new Map([['sync', queue as any]]);

    await expect(reconcileExhaustedJobs(queues, 20_000, state)).resolves.toBe(1);
    await expect(reconcileExhaustedJobs(queues, 21_000, state)).resolves.toBe(1);

    expect(mockAddExhaustedJob).toHaveBeenCalledTimes(2);
    expect([...state.get('sync') ?? []]).toHaveLength(1);
  });

  it('retries failed repairs instead of memoizing them', async () => {
    const state = new Map<string, Set<string>>();
    const queue = {
      queue: { getJobs: vi.fn().mockResolvedValue([job()]) },
    };
    const queues = new Map([['sync', queue as any]]);
    mockAddExhaustedJob
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValueOnce('entry-1');

    await expect(reconcileExhaustedJobs(queues, 20_000, state)).rejects.toEqual(
      expect.objectContaining({ errors: [expect.objectContaining({ message: 'Redis unavailable' })] }),
    );
    await expect(reconcileExhaustedJobs(queues, 21_000, state)).resolves.toBe(1);

    expect(mockAddExhaustedJob).toHaveBeenCalledTimes(2);
  });

  it('bounds memoized identities to the current retained queue window', async () => {
    const state = new Map<string, Set<string>>([
      ['removed', new Set(['old\u00001'])],
    ]);
    const queue = {
      queue: {
        getJobs: vi.fn()
          .mockResolvedValueOnce([job()])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([job()]),
      },
    };
    const queues = new Map([['sync', queue as any]]);

    await expect(reconcileExhaustedJobs(queues, 20_000, state)).resolves.toBe(1);
    await expect(reconcileExhaustedJobs(queues, 21_000, state)).resolves.toBe(0);
    expect(state.has('removed')).toBe(false);
    expect(state.get('sync')).toEqual(new Set());
    await expect(reconcileExhaustedJobs(queues, 22_000, state)).resolves.toBe(1);

    expect(mockAddExhaustedJob).toHaveBeenCalledTimes(2);
  });

  it('preserves memoized identities when a queue read fails', async () => {
    const state = new Map<string, Set<string>>();
    const queue = {
      queue: {
        getJobs: vi.fn()
          .mockResolvedValueOnce([job()])
          .mockRejectedValueOnce(new Error('queue unavailable'))
          .mockResolvedValueOnce([job()]),
      },
    };
    const queues = new Map([['sync', queue as any]]);

    await expect(reconcileExhaustedJobs(queues, 20_000, state)).resolves.toBe(1);
    await expect(reconcileExhaustedJobs(queues, 21_000, state)).rejects.toEqual(
      expect.objectContaining({ errors: [expect.objectContaining({ message: 'queue unavailable' })] }),
    );
    await expect(reconcileExhaustedJobs(queues, 22_000, state)).resolves.toBe(0);

    expect(mockAddExhaustedJob).toHaveBeenCalledTimes(1);
    expect([...state.get('sync') ?? []]).toHaveLength(1);
  });

  it('bounds production queue state and retries only failed repairs', async () => {
    const queueNames = ['sync', 'notifications', 'confirmations', 'maintenance'];
    const queues = new Map(queueNames.map((queueName) => [
      queueName,
      {
        queue: {
          getJobs: vi.fn().mockResolvedValue(
            Array.from({ length: 250 }, (_, index) => job({ id: `${queueName}-${index}` })),
          ),
        },
      } as any,
    ]));
    const state = new Map<string, Set<string>>();
    mockAddExhaustedJob
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValue('entry-1');

    await expect(reconcileExhaustedJobs(queues, 20_000, state)).rejects.toEqual(
      expect.objectContaining({ errors: [expect.objectContaining({ message: 'Redis unavailable' })] }),
    );
    expect([...state.values()].reduce((total, identities) => total + identities.size, 0)).toBe(999);

    await expect(reconcileExhaustedJobs(queues, 21_000, state)).resolves.toBe(1);
    expect(mockAddExhaustedJob).toHaveBeenCalledTimes(1_001);
    expect([...state.values()].reduce((total, identities) => total + identities.size, 0)).toBe(1_000);

    await expect(reconcileExhaustedJobs(queues, 22_000, state)).resolves.toBe(0);
    expect(mockAddExhaustedJob).toHaveBeenCalledTimes(1_001);
  });
});
