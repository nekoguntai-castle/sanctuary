import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CombinedConfig } from '../../../src/config';
import type { WorkerJobQueue } from '../../../src/worker/workerJobQueue';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  readPolicy: vi.fn(),
  readPolicyWithClient: vi.fn(),
  requestRetainedStale: vi.fn(),
  warn: vi.fn(),
  withRetirementLock: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: mocks.error,
    info: vi.fn(),
    warn: mocks.warn,
  }),
}));

vi.mock('../../../src/repositories/walletSyncSchedulePolicyRepository', () => ({
  readStaleWalletSchedulePolicy: mocks.readPolicy,
  readStaleWalletSchedulePolicyWithClient: mocks.readPolicyWithClient,
}));

vi.mock('../../../src/repositories/walletSyncRetirementLock', () => ({
  withWalletSyncRetirementLock: mocks.withRetirementLock,
}));

vi.mock('../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: { requestRetainedStale: mocks.requestRetainedStale },
}));

import {
  enqueueStaleWalletStartupCompatibility,
  registerStaleWalletCompletionCompatibility,
  withStaleWalletRetirementLock,
} from '../../../src/worker/staleWalletScheduleCompatibility';

const config = {
  sync: {
    startupCatchUpBatchSize: 10,
    startupCatchUpDelayMs: 1_000,
    startupCatchUpStaggerDelayMs: 100,
  },
} as CombinedConfig;

function completionQueue() {
  let callback: ((returnvalue: unknown) => Promise<void>) | undefined;
  const queue = {
    onJobCompleted: vi.fn((
      _queueName: string,
      _jobName: string,
      handler: (returnvalue: unknown) => Promise<void>,
    ) => {
      callback = handler;
    }),
  } as unknown as WorkerJobQueue;
  registerStaleWalletCompletionCompatibility(queue, () => false);
  if (!callback) throw new Error('completion callback was not registered');
  return callback;
}

describe('stale wallet startup compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readPolicy.mockResolvedValue({ mode: 'legacy_enabled' });
    mocks.readPolicyWithClient.mockResolvedValue({ mode: 'legacy_enabled' });
    mocks.withRetirementLock.mockImplementation(async (operation) => operation({}));
    mocks.requestRetainedStale.mockResolvedValue({
      status: 'requested',
      wakeup: 'enqueued',
    });
  });

  it('rechecks retirement under the cutover lock before enqueueing', async () => {
    const queue = { addJob: vi.fn() } as unknown as WorkerJobQueue;
    const withRetirementLock = vi.fn(async (operation) => operation(true));

    await enqueueStaleWalletStartupCompatibility(
      queue,
      config,
      withRetirementLock,
    );

    expect(withRetirementLock).toHaveBeenCalledOnce();
    expect(queue.addJob).not.toHaveBeenCalled();
  });

  it('adapts the transaction lock to the durable forbidden-state callback', async () => {
    mocks.readPolicyWithClient.mockResolvedValue({ mode: 'forbidden' });
    const operation = vi.fn().mockResolvedValue('done');

    await expect(withStaleWalletRetirementLock(operation)).resolves.toBe('done');
    expect(operation).toHaveBeenCalledWith(true);
  });

  it('ignores completion events while the worker is shutting down', async () => {
    let callback: ((returnvalue: unknown) => Promise<void>) | undefined;
    const queue = {
      onJobCompleted: vi.fn((
        _queueName: string,
        _jobName: string,
        handler: (returnvalue: unknown) => Promise<void>,
      ) => {
        callback = handler;
      }),
    } as unknown as WorkerJobQueue;
    registerStaleWalletCompletionCompatibility(queue, () => true);
    if (!callback) throw new Error('completion callback was not registered');

    await callback({ version: 1, staleWalletIds: ['wallet-1'] });
    expect(mocks.readPolicy).not.toHaveBeenCalled();
    expect(mocks.requestRetainedStale).not.toHaveBeenCalled();
  });

  it('stops paging retained wallets as soon as retirement becomes durable', async () => {
    mocks.readPolicy
      .mockResolvedValueOnce({ mode: 'legacy_enabled' })
      .mockResolvedValueOnce({ mode: 'legacy_enabled' })
      .mockResolvedValueOnce({ mode: 'forbidden' });
    const callback = completionQueue();

    await callback({
      version: 1,
      staleWalletIds: [
        'wallet-1',
        'wallet-2',
        'wallet-3',
        'wallet-4',
        'wallet-5',
        'wallet-6',
      ],
    });

    expect(mocks.requestRetainedStale).toHaveBeenCalledTimes(5);
  });

  it('logs durable deferrals and isolates one wallet admission failure', async () => {
    mocks.requestRetainedStale
      .mockResolvedValueOnce({ status: 'blocked' })
      .mockResolvedValueOnce({ status: 'requested', wakeup: 'unavailable' })
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ status: 'requested', wakeup: 'enqueued' });
    const callback = completionQueue();

    await callback({
      version: 1,
      staleWalletIds: ['wallet-1', 'wallet-2', 'wallet-3', 'wallet-4'],
    });

    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledWith(
      'Failed to persist retained stale-wallet sync intent',
      { walletId: 'wallet-3', error: 'database unavailable' },
    );
    expect(mocks.requestRetainedStale).toHaveBeenCalledTimes(4);
  });
});
