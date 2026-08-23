/**
 * Confirmation Jobs Tests
 *
 * Tests for transaction-confirmation worker job handlers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockJob } from '../../../helpers/workerJob';

const confirmationJobMocks = vi.hoisted(() => ({
  refreshAllPendingConfirmations: vi.fn(),
  refreshPendingConfirmations: vi.fn(),
}));

vi.mock('../../../../src/models/prisma', () => ({
  default: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../../src/services/sync/confirmationUpdater', () => ({
  refreshAllPendingConfirmations: confirmationJobMocks.refreshAllPendingConfirmations,
  refreshPendingConfirmations: confirmationJobMocks.refreshPendingConfirmations,
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

import { setCachedBlockHeight } from '../../../../src/services/bitcoin/blockchain';
import {
  updateAllConfirmationsJob,
  updateConfirmationsJob,
} from '../../../../src/worker/jobs/syncJobs';

describe('Confirmation Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmationJobMocks.refreshPendingConfirmations.mockResolvedValue({
      walletIds: [],
      wallets: [],
      fieldUpdates: 0,
      confirmationUpdateCount: 0,
      milestoneCount: 0,
      publicationFailures: [],
      failures: [],
    });
    confirmationJobMocks.refreshAllPendingConfirmations.mockResolvedValue({
      walletIds: [],
      wallets: [],
      fieldUpdates: 0,
      confirmationUpdateCount: 0,
      milestoneCount: 0,
      publicationFailures: [],
      failures: [],
    });
  });

  describe('updateConfirmationsJob', () => {
    it('should have correct configuration', () => {
      expect(updateConfirmationsJob.name).toBe('update-confirmations');
      expect(updateConfirmationsJob.queue).toBe('confirmations');
    });

    it('should update block height when provided', async () => {
      const mockJob = createMockJob(
        { height: 100005, hash: '0000abc123' },
        { id: 'job-1', opts: { attempts: 2 } },
      );

      await updateConfirmationsJob.handler(mockJob);

      expect(setCachedBlockHeight).toHaveBeenCalledWith(100005, 'mainnet');
      expect(confirmationJobMocks.refreshPendingConfirmations).toHaveBeenCalledWith('mainnet');
    });

    it('uses the event payload network for cache and confirmation work', async () => {
      const mockJob = createMockJob(
        { version: 2 as const, network: 'testnet4' as const, height: 3_000_005 },
        { id: 'confirmations:testnet4:3000005', opts: { attempts: 2 } },
      );

      await updateConfirmationsJob.handler(mockJob);

      expect(setCachedBlockHeight).toHaveBeenCalledWith(3_000_005, 'testnet4');
      expect(confirmationJobMocks.refreshPendingConfirmations).toHaveBeenCalledWith('testnet4');
    });

    it('should return early if no pending transactions', async () => {
      const mockJob = createMockJob(
        { version: 1 as const, height: 100005 },
        { id: 'job-1', opts: { attempts: 2 } },
      );

      const result = await updateConfirmationsJob.handler(mockJob);

      expect(result.updated).toBe(0);
      expect(result.notified).toBe(0);
      expect(confirmationJobMocks.refreshPendingConfirmations).toHaveBeenCalledWith('mainnet');
    });

    it('should update confirmations for wallets with pending transactions', async () => {
      confirmationJobMocks.refreshPendingConfirmations.mockResolvedValueOnce({
        walletIds: ['w1', 'w2'],
        wallets: [],
        fieldUpdates: 1,
        confirmationUpdateCount: 3,
        milestoneCount: 3,
        publicationFailures: [],
        failures: [],
      });

      const mockJob = createMockJob(
        { height: 100005 },
        { id: 'job-1', opts: { attempts: 2 } },
      );

      const result = await updateConfirmationsJob.handler(mockJob);

      expect(result).toEqual({ version: 1, updated: 3, notified: 3 });
    });

    it('should not increment notified count for non-milestone confirmations', async () => {
      confirmationJobMocks.refreshPendingConfirmations.mockResolvedValueOnce({
        walletIds: ['w1'],
        wallets: [],
        fieldUpdates: 0,
        confirmationUpdateCount: 1,
        milestoneCount: 0,
        publicationFailures: [],
        failures: [],
      });

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
      expect(confirmationJobMocks.refreshPendingConfirmations).not.toHaveBeenCalled();
    });

    it('should skip update summary log path when pending wallets produce no updates', async () => {
      confirmationJobMocks.refreshPendingConfirmations.mockResolvedValueOnce({
        walletIds: ['w1'],
        wallets: [],
        fieldUpdates: 2,
        confirmationUpdateCount: 0,
        milestoneCount: 0,
        publicationFailures: [],
        failures: [],
      });

      const result = await updateConfirmationsJob.handler(
        createMockJob({}, { id: 'job-empty-updates', opts: { attempts: 2 } }),
      );

      expect(result).toEqual({ version: 1, updated: 0, notified: 0 });
    });

    it('should process successful wallets then reject an aggregated wallet failure', async () => {
      confirmationJobMocks.refreshPendingConfirmations.mockResolvedValueOnce({
        walletIds: ['w-fail', 'w-ok'],
        wallets: [],
        fieldUpdates: 0,
        confirmationUpdateCount: 1,
        milestoneCount: 1,
        publicationFailures: [],
        failures: [{ walletId: 'w-fail', error: new Error('wallet update failed') }],
      });

      const processing = updateConfirmationsJob.handler(
        createMockJob({}, { id: 'job-partial-failure', opts: { attempts: 2 } }),
      );

      await expect(processing).rejects.toThrow(
        'Failed to update confirmations for wallets: w-fail',
      );
      expect(confirmationJobMocks.refreshPendingConfirmations).toHaveBeenCalledOnce();
    });

    it('sorts and deduplicates wallets before deterministic failure aggregation', async () => {
      confirmationJobMocks.refreshPendingConfirmations.mockResolvedValueOnce({
        walletIds: ['wallet-a', 'wallet-m', 'wallet-z'],
        wallets: [],
        fieldUpdates: 0,
        confirmationUpdateCount: 0,
        milestoneCount: 0,
        publicationFailures: [],
        failures: [
          { walletId: 'wallet-a', error: new Error('a failed') },
          { walletId: 'wallet-z', error: new Error('z failed') },
        ],
      });

      const processing = updateConfirmationsJob.handler(
        createMockJob({}, { id: 'job-multiple-failures', opts: { attempts: 2 } }),
      );

      await expect(processing).rejects.toMatchObject({
        name: 'AggregateError',
        message: 'Failed to update confirmations for wallets: wallet-a, wallet-z',
      });
      expect(confirmationJobMocks.refreshPendingConfirmations).toHaveBeenCalledOnce();
    });

    it('does not retry persisted updates when confirmation publication fails', async () => {
      confirmationJobMocks.refreshPendingConfirmations.mockResolvedValueOnce({
        walletIds: ['wallet-1'],
        wallets: [],
        fieldUpdates: 0,
        confirmationUpdateCount: 1,
        milestoneCount: 1,
        publicationFailures: [{
          walletId: 'wallet-1',
          txid: 'tx-1',
          error: new Error('websocket unavailable'),
        }],
        failures: [],
      });

      await expect(updateConfirmationsJob.handler(
        createMockJob({}, { id: 'job-publication-failure', opts: { attempts: 2 } }),
      )).resolves.toEqual({ version: 1, updated: 1, notified: 1 });
    });
  });

  describe('updateAllConfirmationsJob', () => {
    it('runs separately named all-network maintenance', async () => {
      confirmationJobMocks.refreshAllPendingConfirmations.mockResolvedValueOnce({
        walletIds: ['mainnet-wallet', 'signet-wallet'],
        wallets: [],
        fieldUpdates: 0,
        confirmationUpdateCount: 2,
        milestoneCount: 1,
        publicationFailures: [],
        failures: [],
      });

      const job = createMockJob({}, { id: 'update-all-legacy', opts: { attempts: 1 } });
      const result = await updateAllConfirmationsJob.handler(job);

      expect(confirmationJobMocks.refreshAllPendingConfirmations).toHaveBeenCalledOnce();
      expect(confirmationJobMocks.refreshPendingConfirmations).not.toHaveBeenCalled();
      expect(result).toEqual({ version: 1, updated: 2, notified: 1 });
    });

    it('accepts explicit v1 and rejects network-scoped v2 payloads', async () => {
      const currentJob = createMockJob(
        { version: 1 as const },
        { id: 'update-all-v1', opts: { attempts: 1 } },
      );

      await expect(updateAllConfirmationsJob.handler(currentJob)).resolves.toEqual({
        version: 1,
        updated: 0,
        notified: 0,
      });
      expect(confirmationJobMocks.refreshAllPendingConfirmations).toHaveBeenCalledOnce();

      const futureJob = createMockJob(
        { version: 2, network: 'mainnet' } as never,
        { id: 'update-all-v2', opts: { attempts: 1 } },
      );
      await expect(updateAllConfirmationsJob.handler(futureJob)).rejects.toThrow(
        'Unsupported or invalid update-all-confirmations job payload',
      );
      expect(confirmationJobMocks.refreshAllPendingConfirmations).toHaveBeenCalledTimes(1);
    });
  });
});
