/**
 * Confirmation Jobs Tests
 *
 * Tests for transaction-confirmation worker job handlers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockJob } from '../../../helpers/workerJob';

const confirmationJobPrismaMocks = vi.hoisted(() => ({
  transactionFindMany: vi.fn<() => Promise<unknown[]>>(),
}));

vi.mock('../../../../src/models/prisma', () => ({
  default: {
    transaction: {
      findMany: confirmationJobPrismaMocks.transactionFindMany,
    },
  },
}));

vi.mock('../../../../src/config', () => ({
  getConfig: vi.fn(() => ({
    sync: {
      staleThresholdMs: 600000,
      staleBatchSize: 75,
      maxConcurrentSyncs: 5,
      maxSyncDurationMs: 120000,
      syncStaggerDelayMs: 2000,
    },
    bitcoin: {
      network: 'mainnet',
    },
  })),
}));

vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  getCachedBlockHeight: vi.fn().mockReturnValue(100000),
  setCachedBlockHeight: vi.fn(),
  syncWallet: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/sync/confirmations', () => ({
  updateTransactionConfirmations: vi.fn().mockResolvedValue([]),
  populateMissingTransactionFields: vi.fn().mockResolvedValue(undefined),
}));

import prisma from '../../../../src/models/prisma';
import { setCachedBlockHeight } from '../../../../src/services/bitcoin/blockchain';
import { updateTransactionConfirmations } from '../../../../src/services/bitcoin/sync/confirmations';
import {
  updateAllConfirmationsJob,
  updateConfirmationsJob,
} from '../../../../src/worker/jobs/syncJobs';

describe('Confirmation Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateConfirmationsJob', () => {
    it('should have correct configuration', () => {
      expect(updateConfirmationsJob.name).toBe('update-confirmations');
      expect(updateConfirmationsJob.queue).toBe('confirmations');
    });

    it('should update block height when provided', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([]);

      const mockJob = createMockJob(
        { height: 100005, hash: '0000abc123' },
        { id: 'job-1', opts: { attempts: 2 } },
      );

      await updateConfirmationsJob.handler(mockJob);

      expect(setCachedBlockHeight).toHaveBeenCalledWith(100005, 'mainnet');
    });

    it('should return early if no pending transactions', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([]);

      const mockJob = createMockJob(
        { version: 1 as const, height: 100005 },
        { id: 'job-1', opts: { attempts: 2 } },
      );

      const result = await updateConfirmationsJob.handler(mockJob);

      expect(result.updated).toBe(0);
      expect(result.notified).toBe(0);
      expect(updateTransactionConfirmations).not.toHaveBeenCalled();
    });

    it('should update confirmations for wallets with pending transactions', async () => {
      confirmationJobPrismaMocks.transactionFindMany.mockResolvedValueOnce([
        { walletId: 'w1' },
        { walletId: 'w2' },
      ]);
      vi.mocked(updateTransactionConfirmations)
        .mockResolvedValueOnce([
          { txid: 'tx1', oldConfirmations: 0, newConfirmations: 1 },
        ])
        .mockResolvedValueOnce([
          { txid: 'tx2', oldConfirmations: 2, newConfirmations: 3 },
          { txid: 'tx3', oldConfirmations: 5, newConfirmations: 6 },
        ]);

      const mockJob = createMockJob(
        { height: 100005 },
        { id: 'job-1', opts: { attempts: 2 } },
      );

      const result = await updateConfirmationsJob.handler(mockJob);

      expect(updateTransactionConfirmations).toHaveBeenCalledTimes(2);
      expect(updateTransactionConfirmations).toHaveBeenCalledWith('w1');
      expect(updateTransactionConfirmations).toHaveBeenCalledWith('w2');
      expect(result).toEqual({ version: 1, updated: 3, notified: 3 });
    });

    it('should not increment notified count for non-milestone confirmations', async () => {
      confirmationJobPrismaMocks.transactionFindMany.mockResolvedValueOnce([{ walletId: 'w1' }]);
      vi.mocked(updateTransactionConfirmations).mockResolvedValueOnce([
        { txid: 'tx1', oldConfirmations: 1, newConfirmations: 2 },
      ]);

      const result = await updateConfirmationsJob.handler(
        createMockJob({}, { id: 'job-non-milestone', opts: { attempts: 2 } }),
      );

      expect(result).toEqual({ version: 1, updated: 1, notified: 0 });
    });

    it('rejects an unsupported live confirmation command version', async () => {
      const job = createMockJob(
        { version: 2 } as never,
        { id: 'job-unsupported-version', opts: { attempts: 2 } },
      );

      await expect(updateConfirmationsJob.handler(job)).rejects.toThrow(
        'Unsupported or invalid update-confirmations job payload',
      );
      expect(confirmationJobPrismaMocks.transactionFindMany).not.toHaveBeenCalled();
    });

    it('should skip update summary log path when pending wallets produce no updates', async () => {
      confirmationJobPrismaMocks.transactionFindMany.mockResolvedValueOnce([{ walletId: 'w1' }]);
      vi.mocked(updateTransactionConfirmations).mockResolvedValueOnce([]);

      const result = await updateConfirmationsJob.handler(
        createMockJob({}, { id: 'job-empty-updates', opts: { attempts: 2 } }),
      );

      expect(result).toEqual({ version: 1, updated: 0, notified: 0 });
    });

    it('should process successful wallets then reject an aggregated wallet failure', async () => {
      confirmationJobPrismaMocks.transactionFindMany.mockResolvedValueOnce([
        { walletId: 'w-fail' },
        { walletId: 'w-ok' },
      ]);
      vi.mocked(updateTransactionConfirmations)
        .mockRejectedValueOnce(new Error('wallet update failed'))
        .mockResolvedValueOnce([
          { txid: 'tx-ok', oldConfirmations: 0, newConfirmations: 1 },
        ]);

      const processing = updateConfirmationsJob.handler(
        createMockJob({}, { id: 'job-partial-failure', opts: { attempts: 2 } }),
      );

      await expect(processing).rejects.toThrow(
        'Failed to update confirmations for wallets: w-fail',
      );
      expect(updateTransactionConfirmations).toHaveBeenCalledTimes(2);
    });

    it('sorts and deduplicates wallets before deterministic failure aggregation', async () => {
      confirmationJobPrismaMocks.transactionFindMany.mockResolvedValueOnce([
        { walletId: 'wallet-z' },
        { walletId: 'wallet-a' },
        { walletId: 'wallet-z' },
        { walletId: 'wallet-m' },
      ]);
      vi.mocked(updateTransactionConfirmations)
        .mockRejectedValueOnce(new Error('a failed'))
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('z failed'));

      const processing = updateConfirmationsJob.handler(
        createMockJob({}, { id: 'job-multiple-failures', opts: { attempts: 2 } }),
      );

      await expect(processing).rejects.toMatchObject({
        name: 'AggregateError',
        message: 'Failed to update confirmations for wallets: wallet-a, wallet-z',
      });
      expect(vi.mocked(updateTransactionConfirmations).mock.calls).toEqual([
        ['wallet-a'],
        ['wallet-m'],
        ['wallet-z'],
      ]);
    });
  });

  describe('updateAllConfirmationsJob', () => {
    it('delegates to updateConfirmationsJob without block data', async () => {
      const handlerSpy = vi.spyOn(updateConfirmationsJob, 'handler').mockResolvedValueOnce({
        updated: 2,
        notified: 1,
      });

      const job = createMockJob({}, { id: 'update-all-legacy', opts: { attempts: 1 } });
      const result = await updateAllConfirmationsJob.handler(job);

      expect(handlerSpy).toHaveBeenCalledWith(job);
      expect(result).toEqual({ updated: 2, notified: 1 });
    });

    it('accepts explicit v1 and rejects unknown versions before delegation', async () => {
      const handlerSpy = vi.spyOn(updateConfirmationsJob, 'handler').mockResolvedValueOnce({
        version: 1,
        updated: 0,
        notified: 0,
      });
      const currentJob = createMockJob(
        { version: 1 as const },
        { id: 'update-all-v1', opts: { attempts: 1 } },
      );

      await expect(updateAllConfirmationsJob.handler(currentJob)).resolves.toEqual({
        version: 1,
        updated: 0,
        notified: 0,
      });
      expect(handlerSpy).toHaveBeenCalledWith(currentJob);

      const futureJob = createMockJob(
        { version: 2 } as never,
        { id: 'update-all-v2', opts: { attempts: 1 } },
      );
      await expect(updateAllConfirmationsJob.handler(futureJob)).rejects.toThrow(
        'Unsupported or invalid update-all-confirmations job payload',
      );
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    });
  });
});
