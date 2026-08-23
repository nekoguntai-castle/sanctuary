import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  queueGetJob: vi.fn(),
  queueGetDeduplicationJobId: vi.fn(),
  queueRemoveDeduplicationKey: vi.fn(),
  queueClose: vi.fn(),
  jobRemove: vi.fn(),
  reserveGeneration: vi.fn(),
  getRedisClient: vi.fn(),
  isRedisConnected: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn(function MockQueue() {
    return {
      add: mocks.queueAdd,
      getJob: mocks.queueGetJob,
      getDeduplicationJobId: mocks.queueGetDeduplicationJobId,
      removeDeduplicationKey: mocks.queueRemoveDeduplicationKey,
      close: mocks.queueClose,
    };
  }),
}));
vi.mock('../../../src/infrastructure', () => ({
  getRedisClient: mocks.getRedisClient,
  isRedisConnected: mocks.isRedisConnected,
}));
vi.mock('../../../src/repositories/resyncRepository', () => ({
  reserveFullResyncGeneration: mocks.reserveGeneration,
}));
vi.mock('../../../src/repositories/walletSyncSchedulePolicyRepository', () => ({
  readStaleWalletSchedulePolicy: vi.fn(),
}));
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  }),
}));

import {
  closeWorkerSyncQueue,
  enqueueIncrementalSyncWakeup,
  enqueueReservedFullResyncWakeup,
} from '../../../src/services/workerSyncQueue';
import { toBullMqJobId } from '../../../src/jobs/bullMqJobIds';
import {
  SYNC_JOB_CONTRACT_VERSION,
  getSyncLockTtlMs,
} from '../../../src/jobs/syncJobContract';
import { FULL_RESYNC_GENERATION_MAX } from '../../../src/constants/fullResync';

function fullData(generation = 7, walletId = 'wallet-1') {
  return {
    version: SYNC_JOB_CONTRACT_VERSION,
    walletId,
    fullResync: true as const,
    fullResyncGeneration: generation,
  };
}

describe('workerSyncQueue recovery wake-ups', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.queueAdd.mockReset().mockImplementation(async (_name, data, options) => ({
      id: options?.jobId,
      data,
      getState: vi.fn().mockResolvedValue('waiting'),
    }));
    mocks.queueGetJob.mockReset().mockResolvedValue(null);
    mocks.queueGetDeduplicationJobId.mockReset().mockResolvedValue(null);
    mocks.queueRemoveDeduplicationKey.mockReset().mockResolvedValue(1);
    mocks.queueClose.mockReset().mockResolvedValue(undefined);
    mocks.jobRemove.mockReset().mockResolvedValue(undefined);
    mocks.reserveGeneration.mockReset();
    mocks.getRedisClient.mockReturnValue({ options: { host: 'localhost', port: 6379, db: 0 } });
    mocks.isRedisConnected.mockReturnValue(true);
    await closeWorkerSyncQueue();
  });

  it('replaces failed and neutrally completed exact incremental work', async () => {
    const wakeup = { walletId: 'wallet-1', generation: 7, jobId: 'stable-job-id' };
    mocks.queueGetJob
      .mockResolvedValueOnce({
        data: { version: 2, walletId: 'wallet-1', incrementalSyncGeneration: 7 },
        getState: vi.fn().mockResolvedValue('failed'), remove: mocks.jobRemove,
      })
      .mockResolvedValueOnce({
        data: { version: 2, walletId: 'wallet-1', incrementalSyncGeneration: 7 },
        getState: vi.fn().mockResolvedValue('completed'), remove: mocks.jobRemove,
      });
    await expect(enqueueIncrementalSyncWakeup(wakeup)).resolves.toBe(true);
    await expect(enqueueIncrementalSyncWakeup(wakeup)).resolves.toBe(true);
    expect(mocks.jobRemove).toHaveBeenCalledTimes(2);
    expect(mocks.queueAdd).toHaveBeenCalledTimes(2);
  });

  it('enqueues an exact reserved full-resync generation without reserving another', async () => {
    await expect(enqueueReservedFullResyncWakeup({ walletId: 'wallet-1', generation: 7 }))
      .resolves.toBe(true);
    expect(mocks.reserveGeneration).not.toHaveBeenCalled();
    expect(mocks.queueAdd).toHaveBeenCalledWith('sync-wallet', {
      ...fullData(), priority: 'high', reason: 'reconcile-stranded-full-resync',
    }, expect.objectContaining({
      jobId: toBullMqJobId('full-resync-attempt:wallet-1:7'),
      deduplication: {
        id: toBullMqJobId('full-resync:wallet-1'), ttl: getSyncLockTtlMs(),
      },
    }));
  });

  it('rejects an older retained generation and permits a later retry', async () => {
    mocks.queueAdd
      .mockResolvedValueOnce({ id: 'older-retained-job' })
      .mockImplementationOnce(async (_name, data, options) => ({
        id: options.jobId, data, getState: vi.fn().mockResolvedValue('waiting'),
      }));
    mocks.queueGetJob.mockResolvedValueOnce(null).mockResolvedValueOnce({
      data: fullData(6), getState: vi.fn().mockResolvedValue('waiting'),
    });
    const wakeup = { walletId: 'wallet-1', generation: 7 };
    await expect(enqueueReservedFullResyncWakeup(wakeup)).resolves.toBe(false);
    await expect(enqueueReservedFullResyncWakeup(wakeup)).resolves.toBe(true);
  });

  it('does not accept missing or terminal retained deduplication targets', async () => {
    mocks.queueAdd
      .mockResolvedValueOnce({ id: 'missing-retained-job' })
      .mockResolvedValueOnce({ id: 'terminal-retained-job' });
    mocks.queueGetJob
      .mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null).mockResolvedValueOnce({
        data: fullData(6), getState: vi.fn().mockResolvedValue('failed'),
      });
    const wakeup = { walletId: 'wallet-1', generation: 7 };
    await expect(enqueueReservedFullResyncWakeup(wakeup)).resolves.toBe(false);
    await expect(enqueueReservedFullResyncWakeup(wakeup)).resolves.toBe(false);
  });

  it('reconciles an exact live wake after Queue.add loses its response', async () => {
    mocks.queueAdd.mockRejectedValueOnce(new Error('connection reset'));
    mocks.queueGetJob.mockResolvedValueOnce(null).mockResolvedValueOnce({
      data: fullData(), getState: vi.fn().mockResolvedValue('active'),
    });
    await expect(enqueueReservedFullResyncWakeup({ walletId: 'wallet-1', generation: 7 }))
      .resolves.toBe(true);
  });

  it('replaces failed exact full work but accepts completed exact work', async () => {
    mocks.queueGetJob
      .mockResolvedValueOnce({
        data: fullData(), getState: vi.fn().mockResolvedValue('failed'), remove: mocks.jobRemove,
      })
      .mockResolvedValueOnce({
        data: fullData(), getState: vi.fn().mockResolvedValue('completed'), remove: mocks.jobRemove,
      });
    const wakeup = { walletId: 'wallet-1', generation: 7 };
    await expect(enqueueReservedFullResyncWakeup(wakeup)).resolves.toBe(true);
    await expect(enqueueReservedFullResyncWakeup(wakeup)).resolves.toBe(true);
    expect(mocks.jobRemove).toHaveBeenCalledOnce();
    expect(mocks.queueAdd).toHaveBeenCalledOnce();
  });

  it('never removes active or mismatched exact work', async () => {
    mocks.queueGetJob
      .mockResolvedValueOnce({
        data: fullData(), getState: vi.fn().mockResolvedValue('active'), remove: mocks.jobRemove,
      })
      .mockResolvedValueOnce({
        data: fullData(7, 'wallet-other'),
        getState: vi.fn().mockResolvedValue('failed'), remove: mocks.jobRemove,
      });
    const wakeup = { walletId: 'wallet-1', generation: 7 };
    await expect(enqueueReservedFullResyncWakeup(wakeup)).resolves.toBe(true);
    await expect(enqueueReservedFullResyncWakeup(wakeup)).resolves.toBe(false);
    expect(mocks.jobRemove).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it.each([0, FULL_RESYNC_GENERATION_MAX + 1])(
    'rejects invalid reserved full-resync generation %s before queue access',
    async generation => {
      await expect(enqueueReservedFullResyncWakeup({ walletId: 'wallet-1', generation }))
        .resolves.toBe(false);
      expect(mocks.queueAdd).not.toHaveBeenCalled();
    },
  );
});
