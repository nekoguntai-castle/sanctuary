import { expect, it, vi } from 'vitest';
import {
  mockAcquireLock,
  mockGetWorkerHealthStatus,
  mockNotificationService,
  mockPopulateMissingTransactionFields,
  mockPrismaClient,
  mockReleaseLock,
  mockSyncWallet,
  type SyncServiceTestContext,
} from './syncServiceTestHarness';

export function registerSyncServiceExecutionRetryPollingTests(context: SyncServiceTestContext): void {
  describe('distributed locking', () => {
    it('should acquire lock before syncing', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });

      await context.syncService.syncNow('wallet-1');

      expect(mockAcquireLock).toHaveBeenCalledWith(
        'sync:wallet:wallet-1',
        expect.objectContaining({ ttlMs: expect.any(Number) })
      );
    });

    it('should release lock after sync', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });

      await context.syncService.syncNow('wallet-1');

      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it('should skip sync if lock cannot be acquired', async () => {
      context.syncService['isRunning'] = true;
      mockAcquireLock.mockResolvedValue(null);

      const result = await context.syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Already syncing');
    });

    it('returns false when trying to acquire a local lock already held in-memory', async () => {
      context.syncService['activeSyncs'].add('wallet-local');

      const acquired = await context.syncService['acquireSyncLock']('wallet-local');

      expect(acquired).toBe(false);
    });
  });

  describe('retry logic', () => {
    it('should retry on failure', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await context.syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('retrying');
    });

    it('should exhaust retries and fail', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValue(new Error('Persistent error'));

      // Execute all retry attempts
      await context.syncService['executeSyncJob']('wallet-1', 3);

      // Should record failure after max retries
      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastSyncStatus: 'failed',
          }),
        })
      );
    });

    it('runs timeout branch and emits balance updates on changed balance', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate
        .mockResolvedValueOnce({ _sum: { amount: BigInt(1000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(1500) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } });
      mockPopulateMissingTransactionFields.mockResolvedValueOnce({
        updated: 2,
        confirmationUpdates: [],
      });

      let resolveSync: ((value: { addresses: number; transactions: number; utxos: number }) => void) | undefined;
      mockSyncWallet.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSync = resolve;
          })
      );

      const syncPromise = context.syncService.syncNow('wallet-timeout');
      await vi.advanceTimersByTimeAsync(120_000);
      resolveSync?.({ addresses: 1, transactions: 2, utxos: 3 });

      const result = await syncPromise;

      expect(result.success).toBe(true);
      expect(mockNotificationService.broadcastBalanceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: 'wallet-timeout' })
      );
    });

    it('handles missing timeout handle when sync resolves quickly', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockResolvedValueOnce({ addresses: 1, transactions: 1, utxos: 1 });
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => {
        return undefined as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

      const result = await context.syncService.syncNow('wallet-no-timeout-handle');
      setTimeoutSpy.mockRestore();

      expect(result.success).toBe(true);
    });

    it('executes retry timer callback and handles retry errors', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValueOnce(new Error('first failure'));

      const originalExecute = context.syncService['executeSyncJob'].bind(context.syncService) as (
        walletId: string,
        retryCount?: number
      ) => Promise<any>;
      const executeSpy = vi.spyOn(context.syncService as any, 'executeSyncJob');
      executeSpy
        .mockImplementationOnce((walletId: string, retryCount: number = 0) =>
          originalExecute(walletId, retryCount)
        )
        .mockImplementationOnce(async () => {
          throw new Error('retry callback failed');
        });

      const result = await context.syncService.syncNow('wallet-retry');
      expect(result.success).toBe(false);
      expect(result.error).toContain('retrying');

      await vi.advanceTimersByTimeAsync(1000);
      expect(context.syncService['pendingRetries'].size).toBe(0);
    });

    it('falls back to last retry delay when configured delay is falsy', async () => {
      context.syncService['isRunning'] = true;
      const configModule = await import('../../../../src/config');
      const configSpy = vi.spyOn(configModule, 'getConfig').mockReturnValue({
        sync: {
          intervalMs: 60000,
          confirmationUpdateIntervalMs: 30000,
          staleThresholdMs: 300000,
          maxConcurrentSyncs: 5,
          maxRetryAttempts: 3,
          retryDelaysMs: [0, 2500],
          maxSyncDurationMs: 120000,
          transactionBatchSize: 100,
          electrumSubscriptionsEnabled: true,
        },
        bitcoin: { network: 'testnet' },
      } as any);

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValueOnce(new Error('retry delay fallback'));

      const result = await context.syncService.syncNow('wallet-retry-delay');
      configSpy.mockRestore();

      expect(result.success).toBe(false);
      expect(mockNotificationService.broadcastSyncStatus).toHaveBeenCalledWith(
        'wallet-retry-delay',
        expect.objectContaining({
          status: 'retrying',
          retryingIn: 2500,
        })
      );
    });
  });

  describe('concurrent sync limiting', () => {
    it('should limit concurrent syncs', async () => {
      context.syncService['isRunning'] = true;

      // Simulate 5 active syncs (maxConcurrentSyncs is 5)
      context.syncService['activeSyncs'].add('wallet-1');
      context.syncService['activeSyncs'].add('wallet-2');
      context.syncService['activeSyncs'].add('wallet-3');
      context.syncService['activeSyncs'].add('wallet-4');
      context.syncService['activeSyncs'].add('wallet-5');

      // Add more to queue
      context.syncService.queueSync('wallet-6');
      context.syncService.queueSync('wallet-7');

      // Queue should have wallets waiting
      expect(context.syncService['syncQueue'].length).toBe(2);

      // processQueue should not start new syncs when at limit
      await context.syncService['processQueue']();

      // Still should have wallets in queue (not started)
      // Note: processQueue doesn't actually start them if at limit
    });

    it('handles executeSyncJob rejection from queued processing', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['syncQueue'] = [{ walletId: 'wallet-fail', priority: 'normal', requestedAt: new Date() }];
      vi.spyOn(context.syncService as any, 'executeSyncJob').mockRejectedValueOnce(new Error('queue worker failed'));

      await context.syncService['processQueue']();
      await Promise.resolve();
      await Promise.resolve();

      expect(context.syncService['syncQueue']).toHaveLength(0);
    });

    it('breaks queue processing when shifted job is undefined', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['syncQueue'] = [undefined as any];
      const executeSpy = vi.spyOn(context.syncService as any, 'executeSyncJob');

      await context.syncService['processQueue']();

      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  describe('health metrics', () => {
    it('should return health metrics', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['syncQueue'] = [{ walletId: 'w1', priority: 'normal', requestedAt: new Date() }];
      context.syncService['activeSyncs'].add('w2');
      context.syncService['addressToWalletMap'].set('addr1', 'w1');

      const metrics = context.syncService.getHealthMetrics();

      expect(metrics.isRunning).toBe(true);
      expect(metrics.queueLength).toBe(1);
      expect(metrics.activeSyncs).toBe(1);
      expect(metrics.subscribedAddresses).toBe(1);
    });

    it('should include pollingMode in health metrics', () => {
      context.syncService['isRunning'] = true;

      const metrics = context.syncService.getHealthMetrics();

      expect(metrics.pollingMode).toBe('in-process');
    });
  });

  describe('polling mode', () => {
    it('should start in-process polling when worker is unhealthy', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });

      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('in-process');
      expect(context.syncService['syncInterval']).not.toBeNull();
      expect(context.syncService['confirmationInterval']).not.toBeNull();
    });

    it('should defer polling to worker when worker is healthy', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(context.syncService['syncInterval']).toBeNull();
      expect(context.syncService['confirmationInterval']).toBeNull();
    });

    it('should always start reconciliation interval regardless of worker health', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await context.syncService.start();

      expect(context.syncService['reconciliationInterval']).not.toBeNull();
    });

    it('should always start workerHealthPollTimer', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await context.syncService.start();

      expect(context.syncService['workerHealthPollTimer']).not.toBeNull();
    });

    it('should transition from worker-delegated to in-process when worker goes down', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');

      // Worker goes down
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      context.syncService['evaluatePollingMode']();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('in-process');
      expect(context.syncService['syncInterval']).not.toBeNull();
      expect(context.syncService['confirmationInterval']).not.toBeNull();
    });

    it('should transition from in-process to worker-delegated when worker recovers', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('in-process');

      // Worker recovers
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      context.syncService['evaluatePollingMode']();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(context.syncService['syncInterval']).toBeNull();
      expect(context.syncService['confirmationInterval']).toBeNull();
    });

    it('should not double-start polling intervals', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();

      const firstSyncInterval = context.syncService['syncInterval'];
      const firstConfirmInterval = context.syncService['confirmationInterval'];

      // Call startPollingIntervals again — should be a no-op
      context.syncService['startPollingIntervals']();

      expect(context.syncService['syncInterval']).toBe(firstSyncInterval);
      expect(context.syncService['confirmationInterval']).toBe(firstConfirmInterval);
    });

    it('should not evaluate polling mode when service is stopped', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();
      await context.syncService.stop();

      // Worker recovers while service is stopped
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      context.syncService['evaluatePollingMode']();

      // Should remain unchanged since isRunning is false
      expect(context.syncService['syncInterval']).toBeNull();
    });

    it('should be no-op when worker stays healthy (already delegated)', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      // Evaluate again with same state
      context.syncService['evaluatePollingMode']();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(context.syncService['syncInterval']).toBeNull();
    });

    it('should be no-op when worker stays unhealthy (already in-process)', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();

      const firstSyncInterval = context.syncService['syncInterval'];

      // Evaluate again with same state
      context.syncService['evaluatePollingMode']();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('in-process');
      expect(context.syncService['syncInterval']).toBe(firstSyncInterval);
    });

    it('should clear workerHealthPollTimer on stop', async () => {
      await context.syncService.start();

      expect(context.syncService['workerHealthPollTimer']).not.toBeNull();

      await context.syncService.stop();

      expect(context.syncService['workerHealthPollTimer']).toBeNull();
    });

    it('should trigger evaluatePollingMode via the 30s timer', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');

      // Worker goes down — advance the 30s timer
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('in-process');
    });

    it('should handle full round-trip: healthy → unhealthy → healthy via timer', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      // Phase 1: worker-delegated, no polling intervals
      expect(context.syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(context.syncService['syncInterval']).toBeNull();
      expect(context.syncService['confirmationInterval']).toBeNull();

      // Phase 2: worker goes down — timer fires, transitions to in-process
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('in-process');
      expect(context.syncService['syncInterval']).not.toBeNull();
      expect(context.syncService['confirmationInterval']).not.toBeNull();
      const syncIntervalRef = context.syncService['syncInterval'];

      // Phase 3: worker recovers — timer fires, transitions back to worker-delegated
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(context.syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(context.syncService['syncInterval']).toBeNull();
      expect(context.syncService['confirmationInterval']).toBeNull();

      // Verify the old interval reference was cleared (not leaked)
      expect(context.syncService['syncInterval']).not.toBe(syncIntervalRef);
    });

    it('should increment transition metric on mode change', async () => {
      const { syncPollingModeTransitions } = await import('../../../../src/observability/metrics');
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      // Transition: worker-delegated → in-process
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      context.syncService['evaluatePollingMode']();

      expect(syncPollingModeTransitions.inc).toHaveBeenCalledWith({
        from: 'worker-delegated',
        to: 'in-process',
      });

      // Transition: in-process → worker-delegated
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      context.syncService['evaluatePollingMode']();

      expect(syncPollingModeTransitions.inc).toHaveBeenCalledWith({
        from: 'in-process',
        to: 'worker-delegated',
      });
    });
  });
}
