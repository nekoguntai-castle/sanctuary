import { expect, it, vi } from 'vitest';
import {
  getSyncServiceInstanceForTest,
  mockAcquireLock,
  mockPrismaClient,
  mockReleaseLock,
  mockWithLock,
  type SyncServiceTestContext,
} from './syncServiceTestHarness';
import { LockAuthorityUnavailableError } from '../../../../src/infrastructure';

export function registerSyncServiceLifecycleQueueTests(context: SyncServiceTestContext): void {
  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getSyncServiceInstanceForTest();
      const instance2 = getSyncServiceInstanceForTest();

      expect(instance1).toBe(instance2);
    });
  });

  describe('state getters', () => {
    it('should expose subscriptionLockRefresh via getter', () => {
      expect(context.syncService.subscriptionLockRefresh).toBeNull();
      const fakeTimer = setInterval(() => {}, 99999);
      context.syncService.subscriptionLockRefresh = fakeTimer;
      expect(context.syncService.subscriptionLockRefresh).toBe(fakeTimer);
      clearInterval(fakeTimer);
      context.syncService.subscriptionLockRefresh = null;
    });

    it('should expose subscriptionsEnabled via getter', () => {
      expect(context.syncService.subscriptionsEnabled).toBe(false);
      context.syncService.subscriptionsEnabled = true;
      expect(context.syncService.subscriptionsEnabled).toBe(true);
      context.syncService.subscriptionsEnabled = false;
    });
  });

  describe('start/stop', () => {
    it('should start the service', async () => {
      await context.syncService.start();

      expect(context.syncService['isRunning']).toBe(true);
    });

    it('should not start twice', async () => {
      await context.syncService.start();
      await context.syncService.start();

      // Should still be running, no errors
      expect(context.syncService['isRunning']).toBe(true);
    });

    it('should stop the service', async () => {
      await context.syncService.start();
      await context.syncService.stop();

      expect(context.syncService['isRunning']).toBe(false);
    });

    it('clears pending compatibility state and contains lock-release failures on stop', async () => {
      await context.syncService.start();
      context.syncService['state'].subscriptionLock = null;
      mockReleaseLock.mockClear();
      const retryTimer = setTimeout(() => undefined, 60_000);
      context.syncService['state'].pendingRetries.set('wallet-retry', retryTimer);
      context.syncService['state'].activeLocks.set('wallet-ok', { key: 'ok' } as never);
      context.syncService['state'].activeLocks.set('wallet-failed', { key: 'failed' } as never);
      context.syncService['state'].activeSyncs.add('wallet-ok');
      context.syncService['state'].syncQueue.push({
        walletId: 'wallet-queued', priority: 'normal', requestedAt: new Date(),
      });
      mockReleaseLock
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('release unavailable'));

      await context.syncService.stop();

      expect(context.syncService['state'].pendingRetries.size).toBe(0);
      expect(context.syncService['state'].activeLocks.size).toBe(0);
      expect(context.syncService['state'].activeSyncs.size).toBe(0);
      expect(context.syncService['state'].syncQueue).toHaveLength(0);
      expect(mockReleaseLock).toHaveBeenCalledTimes(2);
    });

    it('should reset stuck syncs on start', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 2 });

      await context.syncService.start();

      expect(mockPrismaClient.wallet.updateMany).toHaveBeenCalledWith({
        where: {
          syncInProgress: true,
          OR: [{ syncExecutionOwner: null }, { syncExecutionOwner: 'inline' }],
        },
        data: {
          syncInProgress: false,
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
          syncStateVersion: { increment: 1 },
        },
      });
    });

    it('invokes periodic maintenance callbacks after start', async () => {
      const staleSpy = vi.spyOn(context.syncService as any, 'checkAndQueueStaleSyncs').mockResolvedValue(undefined);
      const confirmationsSpy = vi.spyOn(context.syncService as any, 'updateAllConfirmations').mockResolvedValue(undefined);
      const reconcileSpy = vi.spyOn(context.syncService as any, 'reconcileAddressToWalletMap').mockResolvedValue(undefined);
      vi.spyOn(context.syncService as any, 'setupRealTimeSubscriptions').mockResolvedValue(undefined);

      await context.syncService.start();
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(staleSpy).toHaveBeenCalled();
      expect(confirmationsSpy).toHaveBeenCalled();
      expect(reconcileSpy).toHaveBeenCalled();
    });

    it('handles reconciliation interval callback errors', async () => {
      vi.spyOn(context.syncService as any, 'setupRealTimeSubscriptions').mockResolvedValue(undefined);
      const reconcileSpy = vi
        .spyOn(context.syncService as any, 'reconcileAddressToWalletMap')
        .mockRejectedValue(new Error('reconcile failed'));

      await context.syncService.start();
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(reconcileSpy).toHaveBeenCalled();
    });

    it('skips reconciliation when another instance holds the lock', async () => {
      vi.spyOn(context.syncService as any, 'setupRealTimeSubscriptions').mockResolvedValue(undefined);
      const reconcileSpy = vi
        .spyOn(context.syncService as any, 'reconcileAddressToWalletMap')
        .mockResolvedValue(undefined);

      await context.syncService.start();

      // Make the next withLock call return { success: false } to simulate lock contention
      mockWithLock.mockImplementationOnce(async () => ({ success: false }));

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      // reconcileAddressToWalletMap should NOT have been called because the lock was not acquired
      expect(reconcileSpy).not.toHaveBeenCalled();
    });

    it('handles async setupRealTimeSubscriptions rejection during start', async () => {
      vi.spyOn(context.syncService as any, 'setupRealTimeSubscriptions').mockRejectedValue(new Error('setup failed'));

      await context.syncService.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(context.syncService['isRunning']).toBe(true);
    });

    it('retries unavailable subscription authority after recovery', async () => {
      mockAcquireLock
        .mockRejectedValueOnce(new LockAuthorityUnavailableError('acquire'))
        .mockResolvedValueOnce(null);

      await context.syncService.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(context.syncService['subscriptionOwnership']).toBe('unavailable');

      await vi.advanceTimersByTimeAsync(15_000);

      expect(mockAcquireLock).toHaveBeenCalledTimes(2);
      expect(context.syncService['subscriptionOwnership']).toBe('external');
    });

    it('cancels unavailable subscription authority retry during stop', async () => {
      mockAcquireLock.mockRejectedValueOnce(
        new LockAuthorityUnavailableError('acquire'),
      );

      await context.syncService.start();
      await Promise.resolve();
      await Promise.resolve();
      await context.syncService.stop();
      await vi.advanceTimersByTimeAsync(15_000);

      expect(mockAcquireLock).toHaveBeenCalledOnce();
    });

    it('cleans up subscription setup that recovers during shutdown', async () => {
      let resolveRetry: (() => void) | undefined;
      const retry = new Promise<void>((resolve) => {
        resolveRetry = resolve;
      });
      const setupSpy = vi
        .spyOn(context.syncService as any, 'setupRealTimeSubscriptions')
        .mockImplementationOnce(async () => {
          context.syncService['subscriptionOwnership'] = 'unavailable';
          throw new LockAuthorityUnavailableError('acquire');
        })
        .mockReturnValueOnce(retry);
      const teardownSpy = vi
        .spyOn(context.syncService as any, 'teardownRealTimeSubscriptions')
        .mockResolvedValue(undefined);
      const releaseSpy = vi
        .spyOn(context.syncService as any, 'releaseSubscriptionLock')
        .mockResolvedValue(undefined);

      await context.syncService.start();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(15_000);
      await context.syncService.stop();
      resolveRetry?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(setupSpy).toHaveBeenCalledTimes(2);
      expect(teardownSpy).toHaveBeenCalledTimes(2);
      expect(releaseSpy).toHaveBeenCalledTimes(2);
    });

    it('cleans up initial subscription setup that finishes during shutdown', async () => {
      let resolveSetup: (() => void) | undefined;
      const setup = new Promise<void>((resolve) => {
        resolveSetup = resolve;
      });
      const setupSpy = vi
        .spyOn(context.syncService as any, 'setupRealTimeSubscriptions')
        .mockReturnValueOnce(setup);
      const teardownSpy = vi
        .spyOn(context.syncService as any, 'teardownRealTimeSubscriptions')
        .mockResolvedValue(undefined);
      const releaseSpy = vi
        .spyOn(context.syncService as any, 'releaseSubscriptionLock')
        .mockResolvedValue(undefined);

      await context.syncService.start();
      await context.syncService.stop();
      resolveSetup?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(setupSpy).toHaveBeenCalledOnce();
      expect(teardownSpy).toHaveBeenCalledTimes(2);
      expect(releaseSpy).toHaveBeenCalledTimes(2);
    });

    it('reacquires subscription authority after a rapid stop and start', async () => {
      let resolveStaleSetup: (() => void) | undefined;
      const staleSetup = new Promise<void>((resolve) => {
        resolveStaleSetup = resolve;
      });
      const setupSpy = vi
        .spyOn(context.syncService as any, 'setupRealTimeSubscriptions')
        .mockReturnValueOnce(staleSetup)
        .mockResolvedValueOnce(undefined);
      const teardownSpy = vi
        .spyOn(context.syncService as any, 'teardownRealTimeSubscriptions')
        .mockResolvedValue(undefined);
      const releaseSpy = vi
        .spyOn(context.syncService as any, 'releaseSubscriptionLock')
        .mockResolvedValue(undefined);

      await context.syncService.start();
      await context.syncService.stop();
      await context.syncService.start();
      resolveStaleSetup?.();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      expect(setupSpy).toHaveBeenCalledTimes(2);
      expect(teardownSpy).toHaveBeenCalledTimes(2);
      expect(releaseSpy).toHaveBeenCalledTimes(2);
      expect(context.syncService['isRunning']).toBe(true);
    });
  });

  describe('retired inline compatibility entry points', () => {
    it('fails closed when legacy callers try to queue or execute inline sync', async () => {
      expect(() => context.syncService.queueSync('wallet-1', 'high')).toThrow(
        'Inline wallet sync queue is retired; use durable sync intent admission',
      );
      await expect(context.syncService.syncNow('wallet-1')).rejects.toThrow(
        'Immediate wallet sync is retired; use durable sync intent admission',
      );
    });

    it('keeps inline execution locks retired', async () => {
      await expect(context.syncService.acquireSyncLock('wallet-1')).resolves.toBe(false);
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status for wallet', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: new Date(),
        lastSyncStatus: 'success',
        syncInProgress: false,
      });

      const status = await context.syncService.getSyncStatus('wallet-1');

      expect(status.syncStatus).toBe('success');
      expect(status.syncInProgress).toBe(false);
    });

    it('reports worker-owned progress from authoritative persisted state', async () => {
      const startedAt = new Date('2026-08-20T12:00:00.000Z');
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: null,
        lastSyncStatus: 'syncing',
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: startedAt,
        syncStateVersion: 7,
      });

      const status = await context.syncService.getSyncStatus('wallet-worker');

      expect(status).toMatchObject({
        syncInProgress: true,
        executionOwner: 'worker',
        retryCount: 0,
        nextRetryAt: null,
        startedAt,
        stateVersion: 7,
      });
    });

    it('should detect stale wallets', async () => {
      context.syncService['isRunning'] = true;

      const oldDate = new Date(Date.now() - 600000); // 10 minutes ago
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: oldDate,
        lastSyncStatus: 'success',
        syncInProgress: false,
      });

      const status = await context.syncService.getSyncStatus('wallet-1');

      expect(status.isStale).toBe(true);
    });

    it('reports durable intent state and never invents a retired local queue position', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['state'].syncQueue = [
        { walletId: 'wallet-1', priority: 'high', requestedAt: new Date() },
        { walletId: 'wallet-2', priority: 'normal', requestedAt: new Date() },
      ];

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
        requestedIncrementalSyncGeneration: 9,
        claimedIncrementalSyncGeneration: 8,
        processedIncrementalSyncGeneration: 7,
        incrementalSyncClaimedAt: new Date('2026-08-20T12:00:00.000Z'),
        incrementalSyncLeaseExpiresAt: new Date('2026-08-20T12:05:00.000Z'),
        syncActionRequiredAt: null,
        requestedFullResyncGeneration: 4,
        preparedFullResyncGeneration: 3,
        processedFullResyncGeneration: 2,
      });

      const status = await context.syncService.getSyncStatus('wallet-2');

      expect(status).toMatchObject({
        queuePosition: null,
        requestedIncrementalSyncGeneration: 9,
        claimedIncrementalSyncGeneration: 8,
        processedIncrementalSyncGeneration: 7,
        requestedFullResyncGeneration: 4,
        preparedFullResyncGeneration: 3,
        processedFullResyncGeneration: 2,
      });
    });

    it('should throw for non-existent wallet', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(context.syncService.getSyncStatus('nonexistent')).rejects.toThrow('Wallet not found');
    });
  });

}
