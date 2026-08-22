import type { Job } from 'bullmq';
import { expect, it, vi } from 'vitest';

interface SyncJobsFailureCleanupContext {
  prisma: typeof import('../../../../src/models/prisma').default;
  syncWallet: typeof import('../../../../src/services/bitcoin/blockchain').syncWallet;
  syncWalletJob: typeof import('../../../../src/worker/jobs/syncJobs').syncWalletJob;
}

function persistedSyncState(args?: unknown, stateVersion = 1): any {
  const data = (args as { data?: Record<string, unknown> } | undefined)?.data ?? {};
  return {
    syncInProgress: false,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncFailureClass: null,
    syncExecutionOwner: null,
    syncRetryCount: 0,
    syncNextRetryAt: null,
    syncStartedAt: null,
    ...data,
    syncStateVersion: stateVersion,
  };
}

export function registerSyncJobsFailureCleanupContracts({
  prisma,
  syncWallet,
  syncWalletJob,
}: SyncJobsFailureCleanupContext): void {
  it('should return early when wallet does not exist', async () => {
    vi.mocked(prisma.wallet.findUnique).mockResolvedValueOnce(null as any);

    const mockJob = {
      id: 'job-missing-wallet',
      data: { walletId: 'missing-wallet', reason: 'scheduled' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job;

    const result = await syncWalletJob.handler(mockJob);

    expect(result).toEqual({
      version: 1,
      success: false,
      duration: 0,
      error: 'Wallet not found',
    });
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('rejects an unsupported live sync command version before reading the wallet', async () => {
    const job = {
      id: 'job-unsupported-version',
      data: { version: 3, walletId: 'wallet-1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job;

    await expect(syncWalletJob.handler(job)).rejects.toThrow(
      'Unsupported sync-wallet job contract version',
    );
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('should record and rethrow the original sync failure after BullMQ retries are exhausted', async () => {
    const syncError = new Error('Sync failed');
    vi.mocked(syncWallet).mockRejectedValueOnce(syncError);

    const mockJob = {
      id: 'job-1',
      data: { walletId: 'wallet-1' },
      attemptsMade: 2,
      opts: { attempts: 3 },
    } as unknown as Job;

    await expect(syncWalletJob.handler(mockJob)).rejects.toBe(syncError);

    // Should update wallet with error status
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: expect.objectContaining({
        syncInProgress: false,
        lastSyncStatus: 'failed',
        lastSyncError: 'Sync failed',
        lastSyncFailureClass: 'other',
        syncExecutionOwner: null,
        syncStartedAt: null,
      }),
    });
  });

  it('should safety-net reset syncInProgress when catch block DB update fails', async () => {
    vi.useFakeTimers();
    vi.mocked(syncWallet).mockRejectedValueOnce(new Error('Sync failed'));
    // The catch-block status write is retried by the shared lifecycle owner,
    // so the safety net only engages once every attempt has failed. Reject all
    // four, then let the finally block's reset succeed.
    vi.mocked(prisma.wallet.update)
      .mockResolvedValueOnce(persistedSyncState({ data: {
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date(),
      } }, 1))
      .mockRejectedValueOnce(new Error('DB connection lost'))     // terminal write attempt 1
      .mockRejectedValueOnce(new Error('DB connection lost'))     // attempt 2
      .mockRejectedValueOnce(new Error('DB connection lost'))     // attempt 3
      .mockRejectedValueOnce(new Error('DB connection lost'))     // attempt 4 (final)
      .mockResolvedValueOnce(persistedSyncState(undefined, 2));

    const mockJob = {
      id: 'job-1',
      data: { walletId: 'wallet-1' },
      attemptsMade: 2,
      opts: { attempts: 3 },
    } as unknown as Job;

    const pending = expect(syncWalletJob.handler(mockJob)).rejects.toThrow('Sync failed');
    await vi.runAllTimersAsync();
    await pending;

    // Verify the finally block's safety-net reset was the last write.
    expect(prisma.wallet.update).toHaveBeenCalledTimes(6);
    expect(prisma.wallet.update).toHaveBeenNthCalledWith(6, {
      where: { id: 'wallet-1' },
      data: expect.objectContaining({
        syncInProgress: false,
        syncExecutionOwner: null,
        syncStartedAt: null,
      }),
    });
    vi.useRealTimers();
  });

  it('should handle finally block safety-net DB failure gracefully', async () => {
    vi.useFakeTimers();
    vi.mocked(syncWallet).mockRejectedValueOnce(new Error('Sync failed'));
    vi.mocked(prisma.wallet.update)
      .mockResolvedValueOnce(persistedSyncState({ data: {
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date(),
      } }, 1))
      .mockRejectedValueOnce(new Error('DB down'))          // terminal write attempt 1
      .mockRejectedValueOnce(new Error('DB down'))          // attempt 2
      .mockRejectedValueOnce(new Error('DB down'))          // attempt 3
      .mockRejectedValueOnce(new Error('DB down'))          // attempt 4 (final)
      .mockRejectedValueOnce(new Error('DB still down'));   // finally safety-net also fails

    const mockJob = {
      id: 'job-1',
      data: { walletId: 'wallet-1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job;

    // Cleanup errors are contained without masking the original failure.
    const pending = expect(syncWalletJob.handler(mockJob)).rejects.toThrow('Sync failed');
    await vi.runAllTimersAsync();
    await pending;
    expect(prisma.wallet.update).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });

  it('should not double-reset flag when catch block succeeds', async () => {
    vi.mocked(syncWallet).mockRejectedValueOnce(new Error('Sync failed'));

    const mockJob = {
      id: 'job-1',
      data: { walletId: 'wallet-1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as unknown as Job;

    await expect(syncWalletJob.handler(mockJob)).rejects.toThrow('Sync failed');

    // Only 2 calls: set true + catch block set false. No finally safety-net call.
    expect(prisma.wallet.update).toHaveBeenCalledTimes(2);
  });
}
