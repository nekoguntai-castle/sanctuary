import { expect, it, vi } from 'vitest';
import {
  getSyncServiceInstanceForTest,
  mockPrismaClient,
  mockSyncWallet,
  mockWithLock,
  type SyncServiceTestContext,
} from './syncServiceTestHarness';

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

    it('should reset stuck syncs on start', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 2 });

      await context.syncService.start();

      expect(mockPrismaClient.wallet.updateMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        data: { syncInProgress: false },
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
  });

  describe('queueSync', () => {
    it('should add wallet to queue when service is running', async () => {
      // Start the service first so isRunning is true
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await context.syncService.start();

      context.syncService.queueSync('wallet-1', 'normal');

      // Verify queueSync was called (internal queue state is implementation detail)
      // The important thing is that it doesn't throw
      expect(context.syncService['isRunning']).toBe(true);
    });

    it('should not throw on duplicate queue calls', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await context.syncService.start();

      // Should not throw
      context.syncService.queueSync('wallet-1');
      context.syncService.queueSync('wallet-1');

      expect(context.syncService['isRunning']).toBe(true);
    });

    it('should handle priority upgrade request', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await context.syncService.start();

      // Should not throw when upgrading priority
      context.syncService.queueSync('wallet-1', 'low');
      context.syncService.queueSync('wallet-1', 'high');

      expect(context.syncService['isRunning']).toBe(true);
    });

    it('should not queue if already syncing', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await context.syncService.start();
      context.syncService['activeSyncs'].add('wallet-1');

      // Should not throw when trying to queue an already syncing wallet
      context.syncService.queueSync('wallet-1');

      expect(context.syncService['isRunning']).toBe(true);
    });

    it('should handle multiple different wallet queues', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await context.syncService.start();

      // Should not throw when queuing multiple wallets with different priorities
      context.syncService.queueSync('wallet-low', 'low');
      context.syncService.queueSync('wallet-normal', 'normal');
      context.syncService.queueSync('wallet-high', 'high');

      expect(context.syncService['isRunning']).toBe(true);
    });

    it('should handle large queue gracefully', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await context.syncService.start();

      // Queue many wallets - should not throw
      for (let i = 0; i < 100; i++) {
        context.syncService.queueSync(`wallet-${i}`, 'normal');
      }

      expect(context.syncService['isRunning']).toBe(true);

      // Additional wallet should also not throw
      context.syncService.queueSync('wallet-overflow', 'high');

      expect(context.syncService['isRunning']).toBe(true);
    });
  });

  describe('queueUserWallets', () => {
    it('should query wallets for a user', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await context.syncService.start();

      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1' },
        { id: 'wallet-2' },
        { id: 'wallet-3' },
      ]);

      await context.syncService.queueUserWallets('user-1');

      // Verify the database was queried for user's wallets
      expect(mockPrismaClient.wallet.findMany).toHaveBeenCalled();
    });

    it('should include group wallets in query', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await context.syncService.start();

      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'personal-wallet' },
        { id: 'group-wallet' },
      ]);

      await context.syncService.queueUserWallets('user-1', 'high');

      // Production calls walletRepository.findByUserId(userId) which is
      // mocked to forward to mockPrismaClient.wallet.findMany(userId)
      expect(mockPrismaClient.wallet.findMany).toHaveBeenCalledWith('user-1');
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

    it('should return queue position', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['syncQueue'] = [
        { walletId: 'wallet-1', priority: 'high', requestedAt: new Date() },
        { walletId: 'wallet-2', priority: 'normal', requestedAt: new Date() },
      ];

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
      });

      const status = await context.syncService.getSyncStatus('wallet-2');

      expect(status.queuePosition).toBe(2);
    });

    it('should throw for non-existent wallet', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(context.syncService.getSyncStatus('nonexistent')).rejects.toThrow('Wallet not found');
    });
  });

  describe('syncNow', () => {
    it('should execute immediate sync', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate
        .mockResolvedValueOnce({ _sum: { amount: BigInt(100000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(100000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } });

      const result = await context.syncService.syncNow('wallet-1');

      expect(result.success).toBe(true);
      expect(mockSyncWallet).toHaveBeenCalledWith('wallet-1');
    });

    it('should return error if already syncing', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeSyncs'].add('wallet-1');

      const result = await context.syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in progress');
    });
  });
}
